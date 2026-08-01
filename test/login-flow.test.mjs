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

test("safeNextPath allows only same-site relative destinations", () => {
  assert.equal(safeNextPath("registration.html?id=1", "account.html"), "registration.html?id=1");
  assert.equal(safeNextPath("https://evil.test", "account.html"), "account.html");
  assert.equal(safeNextPath("//evil.test", "account.html"), "account.html");
});
