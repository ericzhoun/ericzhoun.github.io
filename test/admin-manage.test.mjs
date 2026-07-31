import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/admin-manage.js";

function request(body, { email = "herfield8@gmail.com" } = {}) {
  return {
    req: new Request("https://example.test/admin-manage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer admin-token" },
      body: JSON.stringify(body),
    }),
    ctx: {
      user: { id: "admin-1", email },
      env: { BUTTERBASE_APP_ID: "app_test", BUTTERBASE_API_URL: "https://api.test" },
      db: { async query() { return { rows: [] }; } },
    },
  };
}

test("admin-manage rejects a non-admin caller with 403", async () => {
  const { req, ctx } = request({ action: "list-accounts" }, { email: "parent@example.com" });
  const res = await handler(req, ctx);
  assert.equal(res.status, 403);
});

test("admin-manage rejects an unknown action with 400", async () => {
  const { req, ctx } = request({ action: "nope" });
  const res = await handler(req, ctx);
  assert.equal(res.status, 400);
});

function stubFetch(response, ok = true) {
  const original = global.fetch;
  global.fetch = async () => ({ ok, json: async () => response, text: async () => JSON.stringify(response) });
  return () => { global.fetch = original; };
}

test("create-account returns the new account on success", async () => {
  const { req, ctx } = request({ action: "create-account", email: "New@Example.com ", display_name: "New Parent" });
  const restore = stubFetch({ user: { id: "user-9" } });
  try {
    const res = await handler(req, ctx);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.account, { user_id: "user-9", email: "new@example.com", name: "New Parent" });
  } finally { restore(); }
});

test("create-account maps a duplicate email to EMAIL_EXISTS 409", async () => {
  const { req, ctx } = request({ action: "create-account", email: "dupe@example.com", display_name: "Dupe" });
  const restore = stubFetch({ error: "User already exists" }, false);
  try {
    const res = await handler(req, ctx);
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.code, "EMAIL_EXISTS");
  } finally { restore(); }
});

function requestWithDb(body, rowsPerCall) {
  const base = request(body);
  const calls = [];
  let i = 0;
  base.ctx.db = {
    async query(sql, values) {
      calls.push({ sql, values });
      const rows = rowsPerCall[i] ?? [];
      i += 1;
      return { rows, rowCount: rows.length };
    },
  };
  base.calls = calls;
  return base;
}

test("add-student inserts a student owned by the target user_id, not the admin", async () => {
  const { req, ctx, calls } = requestWithDb(
    { action: "add-student", user_id: "parent-7", name: "Mia", dob: "2016-05-01" },
    [[{ id: "stu-1", user_id: "parent-7", name: "Mia" }]],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 200);
  assert.ok(calls[0].values.includes("parent-7"));
  assert.ok(calls[0].values.includes("Mia"));
});

test("add-student rejects an invalid date of birth", async () => {
  const { req, ctx } = requestWithDb(
    { action: "add-student", user_id: "parent-7", name: "Mia", dob: "not-a-date" }, [],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 400);
});

test("update-student returns 404 when no row matches", async () => {
  const { req, ctx } = requestWithDb(
    { action: "update-student", id: "missing", name: "X", dob: "2016-05-01" }, [[]],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 404);
});
