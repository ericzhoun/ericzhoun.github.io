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

test("create-enrollment writes a comped, confirmed row priced from the schedule", async () => {
  const { req, ctx, calls } = requestWithDb(
    {
      action: "create-enrollment", user_id: "parent-7", student_id: "stu-1",
      schedule_id: "sched-1", num_classes_enrolled: 8,
      student_email: "parent@example.com", parent_name: "Pat Parent",
    },
    [
      [{ price_cents: 3500 }],            // schedule lookup
      [{ name: "Mia" }],                  // student ownership lookup
      [{ id: "enr-1" }],                  // insert returning id
    ],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 200);
  const insert = calls[2];
  assert.match(insert.sql, /INSERT INTO enrollments/);
  assert.ok(insert.values.includes("confirmed"));
  assert.ok(insert.values.includes(3500)); // price_per_class_cents from schedule
  assert.ok(insert.values.includes(0));    // total_paid_cents comped
});

test("create-enrollment rejects a student not owned by the parent", async () => {
  const { req, ctx } = requestWithDb(
    {
      action: "create-enrollment", user_id: "parent-7", student_id: "stu-x",
      schedule_id: "sched-1", num_classes_enrolled: 8, student_email: "p@e.com", parent_name: "P",
    },
    [[{ price_cents: 3500 }], []], // schedule ok, student ownership empty
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 400);
});

test("create-enrollment 404s on an inactive/unknown schedule", async () => {
  const { req, ctx } = requestWithDb(
    {
      action: "create-enrollment", user_id: "parent-7", student_id: "stu-1",
      schedule_id: "gone", num_classes_enrolled: 8, student_email: "p@e.com", parent_name: "P",
    },
    [[]],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 404);
});

test("set-credits updates num_classes_enrolled and returns the row", async () => {
  const { req, ctx, calls } = requestWithDb(
    { action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: 12 },
    [[{ id: "enr-1", num_classes_enrolled: 12 }]],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 200);
  assert.ok(calls[0].values.includes(12));
});

test("set-credits allows a below-attended (even zero) value", async () => {
  const { req, ctx } = requestWithDb(
    { action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: 0 },
    [[{ id: "enr-1", num_classes_enrolled: 0 }]],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 200);
});

test("set-credits 404s for an unknown enrollment", async () => {
  const { req, ctx } = requestWithDb(
    { action: "set-credits", enrollment_id: "gone", num_classes_enrolled: 5 }, [[]],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 404);
});

test("set-credits rejects a negative value", async () => {
  const { req, ctx } = requestWithDb(
    { action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: -3 }, [],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 400);
});

test("set-credits rejects an invalid status", async () => {
  const { req, ctx } = requestWithDb(
    { action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: 5, status: "bogus" }, [],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 400);
});

test("list-accounts returns derived parents with numeric counts", async () => {
  const { req, ctx } = requestWithDb(
    { action: "list-accounts" },
    [[
      { user_id: "p1", email: "a@e.com", name: "Alice", student_count: "2", enrollment_count: "3" },
      { user_id: "p2", email: "b@e.com", name: "Bob", student_count: "1", enrollment_count: "0" },
    ]],
  );
  const res = await handler(req, ctx);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.accounts.length, 2);
  assert.deepEqual(data.accounts[0], {
    user_id: "p1", email: "a@e.com", name: "Alice", student_count: 2, enrollment_count: 3,
  });
  assert.equal(data.accounts[1].enrollment_count, 0);
});
