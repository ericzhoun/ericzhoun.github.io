import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/admin-manage.js";

const ADMIN_EMAIL = "herfield8@gmail.com";

// admin-manage is deployed with http auth "none" so ctx.db runs as
// butterbase_service. That matters because students and enrollments carry
// user-isolation RLS policies (USING and WITH CHECK on user_id =
// current_user_id()): under butterbase_user an admin can neither read other
// parents' rows nor insert rows owned by them, which is the whole feature.
// Passing the admin JWT in Authorization would bind the request to
// butterbase_user and re-enable RLS, so the token travels in X-Admin-Token and
// the function verifies it against /auth/{appId}/me itself. ctx.user is always
// null in production and must never be treated as proof of anything.
function request(body, { token = "admin-jwt" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Admin-Token"] = token;
  return {
    req: new Request("https://example.test/admin-manage", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    ctx: {
      user: null,
      env: { BUTTERBASE_APP_ID: "app_test", BUTTERBASE_API_URL: "https://api.test" },
      db: { async query() { return { rows: [] }; } },
    },
  };
}

// Answers the /me identity check; any other fetch (the signup call) is served
// from `responses` in order.
function stubFetch({ meEmail = ADMIN_EMAIL, meOk = true, responses = [] } = {}) {
  const original = global.fetch;
  let i = 0;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push(String(url));
    if (String(url).endsWith("/me")) {
      return {
        ok: meOk,
        status: meOk ? 200 : 401,
        json: async () => (meOk ? { user: { id: "admin-1", email: meEmail } } : { error: "invalid token" }),
      };
    }
    const entry = responses[i] ?? { ok: true, body: {} };
    i += 1;
    return {
      ok: entry.ok !== false,
      json: async () => entry.body,
      text: async () => JSON.stringify(entry.body),
    };
  };
  const restore = () => { global.fetch = original; };
  restore.seen = seen;
  return restore;
}

async function callHandler({ req, ctx }, stubOptions) {
  const restore = stubFetch(stubOptions);
  try {
    const res = await handler(req, ctx);
    res.fetched = restore.seen;
    return res;
  } finally { restore(); }
}

function requestWithDb(body, rowsPerCall, options) {
  const base = request(body, options);
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

// ---- authorization ----

test("admin-manage rejects a caller presenting no admin token", async () => {
  const res = await callHandler(request({ action: "list-accounts" }, { token: null }));
  assert.equal(res.status, 403);
});

test("admin-manage rejects a token whose verified email is not an admin", async () => {
  const res = await callHandler(request({ action: "list-accounts" }), { meEmail: "parent@example.com" });
  assert.equal(res.status, 403);
});

test("admin-manage rejects a token the auth service will not verify", async () => {
  const res = await callHandler(request({ action: "list-accounts" }), { meOk: false });
  assert.equal(res.status, 403);
});

// The endpoint is public (auth "none"), so ctx.user is not a credential. If a
// future runtime ever populated it, it still must not grant access on its own.
test("admin-manage does not treat ctx.user as proof of admin identity", async () => {
  const target = request({ action: "list-accounts" }, { token: null });
  target.ctx.user = { id: "admin-1", email: ADMIN_EMAIL };
  const res = await callHandler(target);
  assert.equal(res.status, 403);
});

test("admin-manage verifies the token against the auth service before acting", async () => {
  const res = await callHandler(request({ action: "list-accounts" }));
  assert.ok(res.fetched.some((url) => url.endsWith("/auth/app_test/me")));
});

test("admin-manage rejects an unknown action with 400", async () => {
  const res = await callHandler(request({ action: "nope" }));
  assert.equal(res.status, 400);
});

// ---- create-account ----

test("create-account returns the new account on success", async () => {
  const res = await callHandler(
    request({ action: "create-account", email: "New@Example.com ", display_name: "New Parent" }),
    { responses: [{ ok: true, body: { user: { id: "user-9" } } }] },
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.account, { user_id: "user-9", email: "new@example.com", name: "New Parent" });
});

test("create-account maps a duplicate email to EMAIL_EXISTS 409", async () => {
  const res = await callHandler(
    request({ action: "create-account", email: "dupe@example.com", display_name: "Dupe" }),
    { responses: [{ ok: false, body: { error: "User already exists" } }] },
  );
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.code, "EMAIL_EXISTS");
});

// ---- students ----

test("add-student inserts a student owned by the target user_id, not the admin", async () => {
  const target = requestWithDb(
    { action: "add-student", user_id: "parent-7", name: "Mia", dob: "2016-05-01" },
    [[{ id: "stu-1", user_id: "parent-7", name: "Mia" }]],
  );
  const res = await callHandler(target);
  assert.equal(res.status, 200);
  assert.ok(target.calls[0].values.includes("parent-7"));
  assert.ok(target.calls[0].values.includes("Mia"));
});

test("add-student rejects an invalid date of birth", async () => {
  const res = await callHandler(requestWithDb(
    { action: "add-student", user_id: "parent-7", name: "Mia", dob: "not-a-date" }, [],
  ));
  assert.equal(res.status, 400);
});

test("update-student returns 404 when no row matches", async () => {
  const res = await callHandler(requestWithDb(
    { action: "update-student", id: "missing", name: "X", dob: "2016-05-01" }, [[]],
  ));
  assert.equal(res.status, 404);
});

// ---- enrollments ----

test("create-enrollment writes a comped, confirmed row priced from the schedule", async () => {
  const target = requestWithDb(
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
  const res = await callHandler(target);
  assert.equal(res.status, 200);
  const insert = target.calls[2];
  assert.match(insert.sql, /INSERT INTO enrollments/);
  assert.ok(insert.values.includes("confirmed"));
  assert.ok(insert.values.includes(3500)); // price_per_class_cents from schedule
  assert.ok(insert.values.includes(0));    // total_paid_cents comped
});

test("create-enrollment rejects a student not owned by the parent", async () => {
  const res = await callHandler(requestWithDb(
    {
      action: "create-enrollment", user_id: "parent-7", student_id: "stu-x",
      schedule_id: "sched-1", num_classes_enrolled: 8, student_email: "p@e.com", parent_name: "P",
    },
    [[{ price_cents: 3500 }], []], // schedule ok, student ownership empty
  ));
  assert.equal(res.status, 400);
});

test("create-enrollment 404s on an inactive/unknown schedule", async () => {
  const res = await callHandler(requestWithDb(
    {
      action: "create-enrollment", user_id: "parent-7", student_id: "stu-1",
      schedule_id: "gone", num_classes_enrolled: 8, student_email: "p@e.com", parent_name: "P",
    },
    [[]],
  ));
  assert.equal(res.status, 404);
});

// ---- credits ----

test("set-credits updates num_classes_enrolled and returns the row", async () => {
  const target = requestWithDb(
    { action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: 12 },
    [[{ id: "enr-1", num_classes_enrolled: 12 }]],
  );
  const res = await callHandler(target);
  assert.equal(res.status, 200);
  assert.ok(target.calls[0].values.includes(12));
});

test("set-credits allows a below-attended (even zero) value", async () => {
  const res = await callHandler(requestWithDb(
    { action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: 0 },
    [[{ id: "enr-1", num_classes_enrolled: 0 }]],
  ));
  assert.equal(res.status, 200);
});

test("set-credits 404s for an unknown enrollment", async () => {
  const res = await callHandler(requestWithDb(
    { action: "set-credits", enrollment_id: "gone", num_classes_enrolled: 5 }, [[]],
  ));
  assert.equal(res.status, 404);
});

test("set-credits rejects a negative value", async () => {
  const res = await callHandler(requestWithDb(
    { action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: -3 }, [],
  ));
  assert.equal(res.status, 400);
});

test("set-credits rejects an invalid status", async () => {
  const res = await callHandler(requestWithDb(
    { action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: 5, status: "bogus" }, [],
  ));
  assert.equal(res.status, 400);
});

// ---- accounts listing ----

test("list-accounts returns derived parents with numeric counts", async () => {
  const res = await callHandler(requestWithDb(
    { action: "list-accounts" },
    [[
      { user_id: "p1", email: "a@e.com", name: "Alice", student_count: "2", enrollment_count: "3" },
      { user_id: "p2", email: "b@e.com", name: "Bob", student_count: "1", enrollment_count: "0" },
    ]],
  ));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.accounts.length, 2);
  assert.deepEqual(data.accounts[0], {
    user_id: "p1", email: "a@e.com", name: "Alice", student_count: 2, enrollment_count: 3,
  });
  assert.equal(data.accounts[1].enrollment_count, 0);
});
