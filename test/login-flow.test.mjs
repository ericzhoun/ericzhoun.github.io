import assert from "node:assert/strict";
import { test } from "node:test";

import { getInitialLoginState, getLoginFocusTarget, safeNextPath } from "../js/login-flow.js";

test("welcome links open code verification with a normalized prefilled email", () => {
  assert.deepEqual(
    getInitialLoginState("?mode=magic-verify&email=Parent%40Example.com"),
    { mode: "magic-verify", email: "parent@example.com" },
  );
});

test("unknown modes fall back to password login", () => {
  assert.deepEqual(getInitialLoginState("?mode=unknown&email=x%40e.com"), {
    mode: "password",
    email: "x@e.com",
  });
});

test("welcome verification directs keyboard focus to the sign-in code", () => {
  assert.equal(getLoginFocusTarget("magic-verify"), "code");
});

test("safeNextPath returns normalized site-relative path components", () => {
  const cases = [
    ["registration.html?id=1#form", "registration.html?id=1#form"],
    ["/account.html?tab=profile#contact", "/account.html?tab=profile#contact"],
    ["./account.html", "account.html"],
    ["classes/../account.html", "account.html"],
    ["  account.html?next=https%3A%2F%2Fevil.test  ", "account.html?next=https%3A%2F%2Fevil.test"],
  ];
  for (const [candidate, expected] of cases) {
    assert.equal(safeNextPath(candidate, "fallback.html"), expected, candidate);
  }
});

test("safeNextPath rejects schemes, authorities, backslashes, and empty destinations", () => {
  const rejected = [
    null,
    "",
    "   ",
    "https://evil.test/path",
    "https://olivistart.local/account.html",
    "javascript:alert(1)",
    "data:text/html,test",
    "//evil.test/path",
    "///evil.test/path",
    "\\\\evil.test\\path",
    "/\\evil.test/path",
    "account.html\\evil",
    "/foo//bar",
    "account.html\u0000",
  ];
  for (const candidate of rejected) {
    assert.equal(safeNextPath(candidate, "fallback.html"), "fallback.html", String(candidate));
  }
});

test("safeNextPath rejects encoded and malformed slash bypasses", () => {
  const rejected = [
    "%2f%2fevil.test/path",
    "/%2F/evil.test/path",
    "%5cevil.test/path",
    "%255c%255cevil.test/path",
    "/%252f%252fevil.test/path",
    "account%2fsettings.html",
    "account%5csettings.html",
    "%",
    "%2",
    "%GG",
  ];
  for (const candidate of rejected) {
    assert.equal(safeNextPath(candidate, "fallback.html"), "fallback.html", candidate);
  }
});
