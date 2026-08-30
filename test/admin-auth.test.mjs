import assert from "node:assert/strict";
import { test } from "node:test";

import { createAdminCaller } from "../js/admin-auth.js";

test("admin caller uses the current access token before attempting refresh", async () => {
  const calls = [];
  let refreshes = 0;
  const call = createAdminCaller({
    getToken: () => "current-token",
    refreshToken: async () => { refreshes += 1; throw new Error("refresh should not run"); },
    callFunction: async (...args) => { calls.push(args); return { accounts: [] }; },
  });

  const result = await call("list-accounts");

  assert.deepEqual(result, { accounts: [] });
  assert.equal(refreshes, 0);
  assert.equal(calls[0][2], "current-token");
});

test("admin caller refreshes once after an authenticated request is rejected", async () => {
  const tokens = ["expired-token", "refreshed-token"];
  const calls = [];
  const call = createAdminCaller({
    getToken: () => tokens[0],
    refreshToken: async () => tokens[1],
    callFunction: async (...args) => {
      calls.push(args);
      if (calls.length === 1) {
        const error = new Error("expired");
        error.status = 401;
        throw error;
      }
      return { accounts: [] };
    },
  });

  await call("list-accounts");

  assert.equal(calls.length, 2);
  assert.equal(calls[1][2], "refreshed-token");
});
