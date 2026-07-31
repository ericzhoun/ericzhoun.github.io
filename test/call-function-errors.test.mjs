import assert from "node:assert/strict";
import { test } from "node:test";
import { callFunction } from "../js/api.js";

// Butterbase distinguishes two error shapes: functions written in this repo
// return a flat { error: "message" }, while the platform edge (auth, routing,
// validation) returns a nested { error: { code, message, remediation } }.
// Stringifying the nested shape is what produced the useless "[object Object]"
// the admin CMS displayed instead of "session expired".
function stubFetch(body, ok) {
  const original = global.fetch;
  global.fetch = async () => ({ ok, status: ok ? 200 : 401, json: async () => body });
  return () => { global.fetch = original; };
}

test("callFunction surfaces the message from a nested platform error", async () => {
  const restore = stubFetch({
    error: {
      code: "AUTH_REQUIRED",
      message: "This app requires authentication. Anonymous access is disabled.",
      remediation: "Send a valid end-user JWT in the Authorization header.",
    },
  }, false);
  try {
    await assert.rejects(
      () => callFunction("admin-manage", { action: "list-accounts" }, "stale-token"),
      (error) => {
        assert.doesNotMatch(error.message, /\[object Object\]/);
        assert.match(error.message, /requires authentication/);
        assert.equal(error.code, "AUTH_REQUIRED");
        return true;
      },
    );
  } finally { restore(); }
});

test("callFunction still surfaces a flat error string from our own functions", async () => {
  const restore = stubFetch({ error: "Admin access required" }, false);
  try {
    await assert.rejects(
      () => callFunction("admin-manage", { action: "list-accounts" }, "token"),
      (error) => {
        assert.equal(error.message, "Admin access required");
        return true;
      },
    );
  } finally { restore(); }
});

test("callFunction preserves a flat error code for EMAIL_EXISTS branching", async () => {
  const restore = stubFetch({ error: "An account with this email already exists.", code: "EMAIL_EXISTS" }, false);
  try {
    await assert.rejects(
      () => callFunction("admin-manage", { action: "create-account" }, "token"),
      (error) => {
        assert.equal(error.code, "EMAIL_EXISTS");
        return true;
      },
    );
  } finally { restore(); }
});

test("callFunction returns parsed data on success", async () => {
  const restore = stubFetch({ accounts: [{ user_id: "p1" }] }, true);
  try {
    const data = await callFunction("admin-manage", { action: "list-accounts" }, "token");
    assert.deepEqual(data.accounts, [{ user_id: "p1" }]);
  } finally { restore(); }
});
