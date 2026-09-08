import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Node's global localStorage needs --experimental-webstorage plus a backing
// file to actually work; stub a plain in-memory version instead so this
// suite runs under the repo's standard `node --test` invocation (same as
// auth.test.mjs).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

import {
  applyOAuthRedirect,
  getRefreshToken,
  getUser,
  isLoggedIn,
} from "../js/auth.js";
import {
  googleOAuthUrl,
  oauthCallbackUrl,
  oauthCallbackParams,
  oauthErrorMessage,
  resolveOAuthNext,
} from "../js/oauth-flow.js";

test("oauth start URL targets Butterbase's managed Google flow with the encoded callback page", () => {
  assert.equal(
    googleOAuthUrl("https://api.butterbase.ai/auth/app_test", "https://olivistart.com"),
    "https://api.butterbase.ai/auth/app_test/oauth/google?redirect_to=" +
      encodeURIComponent("https://olivistart.com/auth-callback.html"),
  );
  // Trailing slashes on either base must not double up.
  assert.equal(
    oauthCallbackUrl("https://olivistart.com/"),
    "https://olivistart.com/auth-callback.html",
  );
});

test("oauth callback parsing accepts a full token set", () => {
  const parsed = oauthCallbackParams("?access_token=at&refresh_token=rt&expires_in=900");
  assert.deepEqual(parsed, {
    error: null,
    errorDescription: "",
    accessToken: "at",
    refreshToken: "rt",
  });
});

test("oauth callback parsing maps provider errors with friendly copy", () => {
  const parsed = oauthCallbackParams("?error=access_denied&error_description=User+cancelled");
  assert.equal(parsed.error, "access_denied");
  assert.equal(parsed.errorDescription, "User cancelled");
  assert.equal(oauthErrorMessage(parsed), "Google sign-in was cancelled.");

  const generic = oauthCallbackParams("?error=server_error");
  assert.equal(oauthErrorMessage(generic), "Google sign-in failed. Please try again.");
});

test("oauth callback parsing treats absent or partial tokens as no callback", () => {
  assert.equal(oauthCallbackParams(""), null);
  assert.equal(oauthCallbackParams("?next=/account.html"), null);
  assert.equal(oauthCallbackParams("?access_token=only"), null);
  assert.equal(oauthCallbackParams("?refresh_token=only"), null);
});

test("resolveOAuthNext reuses safeNextPath and defaults to the account page", () => {
  assert.equal(resolveOAuthNext("registration.html?enrollment=e1"), "registration.html?enrollment=e1");
  assert.equal(resolveOAuthNext(null), "account.html");
  assert.equal(resolveOAuthNext("https://evil.test/path"), "account.html");
  assert.equal(resolveOAuthNext("javascript:alert(1)"), "account.html");
  assert.equal(resolveOAuthNext("//evil.test/path"), "account.html");
});

test("applyOAuthRedirect returns null without OAuth parameters and never fetches", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error("must not fetch"); };
  assert.equal(await applyOAuthRedirect("?unrelated=1"), null);
});

test("applyOAuthRedirect stores the session and the /me profile", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url) => {
    assert.equal(url, "https://api.butterbase.ai/auth/app_0otd4vmczvu8/me");
    return {
      ok: true,
      json: async () => ({
        user: { id: "u1", email: "parent@example.com", display_name: "Google Parent" },
      }),
    };
  };

  const user = await applyOAuthRedirect("?access_token=at&refresh_token=rt");

  assert.equal(user.email, "parent@example.com");
  assert.equal(isLoggedIn(), true);
  assert.equal(getUser().display_name, "Google Parent");
  assert.equal(getRefreshToken(), "rt");
});

test("applyOAuthRedirect accepts a bare profile body without a user wrapper", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ id: "u2", email: "bare@example.com", display_name: "Bare" }),
  });

  const user = await applyOAuthRedirect("?access_token=at&refresh_token=rt");
  assert.equal(user.email, "bare@example.com");
  assert.equal(getUser().display_name, "Bare");
});

test("applyOAuthRedirect clears the session when the profile cannot be loaded", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => ({ ok: false, json: async () => ({}) });

  await assert.rejects(
    () => applyOAuthRedirect("?access_token=at&refresh_token=rt"),
    /could not be completed/,
  );
  assert.equal(isLoggedIn(), false);
});

test("applyOAuthRedirect surfaces provider cancellation as friendly copy", async () => {
  await assert.rejects(() => applyOAuthRedirect("?error=access_denied"), /was cancelled/);
  assert.equal(isLoggedIn(), false);
});

test("login page offers Google sign-in wired to the OAuth flow", async () => {
  const html = await readFile(new URL("../login.html", import.meta.url), "utf8");
  assert.match(html, /id="google-signin"/);
  assert.match(html, /class="btn btn-google"/);
  assert.match(html, /Sign in with Google/);
  assert.match(html, /auth-divider/);
});

test("signup page offers Google sign-up wired to the OAuth flow", async () => {
  const html = await readFile(new URL("../signup.html", import.meta.url), "utf8");
  assert.match(html, /id="google-signup"/);
  assert.match(html, /Sign up with Google/);
  assert.match(html, /auth-divider/);
});

test("login.js and signup.js route the buttons through beginGoogleSignIn with the return path", async () => {
  const login = await readFile(new URL("../js/login.js", import.meta.url), "utf8");
  assert.match(login, /beginGoogleSignIn\(getQueryParam\("next"\)\)/);

  const signup = await readFile(new URL("../js/signup.js", import.meta.url), "utf8");
  assert.match(signup, /beginGoogleSignIn\(getQueryParam\("next"\)\)/);
});

test("auth-callback stores tokens, claims enrollments, and redirects to the saved destination", async () => {
  const script = await readFile(new URL("../js/auth-callback.js", import.meta.url), "utf8");
  assert.match(script, /applyOAuthRedirect\(window\.location\.search\)/);
  assert.match(script, /claimEnrollments\(\)/);
  assert.match(script, /canonicalSiteUrl\(consumeOAuthNext\(\), SITE_URL\)/);
  // Direct visits without OAuth parameters bounce to login.
  assert.match(script, /window\.location\.replace\("login\.html"\)/);
});

test("auth-callback page exists and is wired to its script", async () => {
  const html = await readFile(new URL("../auth-callback.html", import.meta.url), "utf8");
  assert.match(html, /js\/auth-callback\.js/);
  assert.match(html, /id="oauth-error"/);
  assert.match(html, /noindex/);
});
