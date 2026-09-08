// Google OAuth flow helpers for the Butterbase managed sign-in. Pure string
// functions only - pages and auth.js handle the sessionStorage/localStorage
// and fetch wiring around these.
//
// Flow (Butterbase docs, core-concepts/authentication):
//   1. Send the browser to GET /auth/{app_id}/oauth/google?redirect_to=<url>.
//   2. Butterbase runs the Google round-trip and bounces the browser to
//      redirect_to with the session tokens appended as query parameters
//      (?access_token=...&refresh_token=...&expires_in=...).
//   3. auth-callback.html stores the tokens and moves on to the saved
//      destination.
import { safeNextPath } from "./login-flow.js";

const OAUTH_CALLBACK_PAGE = "auth-callback.html";

/** Absolute URL of the OAuth landing page on the static site. Kept free of
 *  query parameters so Butterbase can append tokens with a bare "?". The
 *  post-login destination travels in sessionStorage instead. */
export function oauthCallbackUrl(siteUrl) {
  return new URL(OAUTH_CALLBACK_PAGE, `${siteUrl.replace(/\/+$/, "")}/`).toString();
}

/** Full Butterbase OAuth start URL for Google. */
export function googleOAuthUrl(authBase, siteUrl) {
  const redirect = oauthCallbackUrl(siteUrl);
  return `${authBase.replace(/\/+$/, "")}/oauth/google?redirect_to=${encodeURIComponent(redirect)}`;
}

/**
 * Read the parameters Butterbase appends to the callback page URL.
 * Returns null when the page was opened without an OAuth payload, so the
 * caller can bounce to login instead of rendering a blank state. A partial
 * token set (one token missing) counts as absent - storing it would strand
 * the user with a session that can neither refresh nor logout cleanly.
 */
export function oauthCallbackParams(search) {
  const params = new URLSearchParams(search || "");
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (params.get("error")) {
    return {
      error: params.get("error"),
      errorDescription: params.get("error_description") || "",
      accessToken: null,
      refreshToken: null,
    };
  }
  if (!accessToken || !refreshToken) return null;
  return { error: null, errorDescription: "", accessToken, refreshToken };
}

/** Resolve the post-login destination stored before the OAuth redirect.
 *  Reuses safeNextPath so off-site and malformed targets fall back to the
 *  account page, exactly like the rest of the auth flows. */
export function resolveOAuthNext(candidate) {
  return safeNextPath(candidate, "account.html");
}

/** Friendly copy for provider error responses. */
export function oauthErrorMessage(parsed) {
  if (parsed.error === "access_denied") return "Google sign-in was cancelled.";
  return parsed.errorDescription || "Google sign-in failed. Please try again.";
}
