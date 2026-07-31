import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/admin-manage.js";

const ADMIN_EMAIL = "herfield8@gmail.com";

// The function is deployed with http auth "required", so the admin's JWT
// arrives in Authorization (the only cross-origin header Butterbase's CORS
// allowlist permits besides Content-Type). It is re-verified against
// /auth/{appId}/me rather than trusted via ctx.user.
//
// Data access goes through the REST data API with SERVICE_KEY, not ctx.db:
// students and enrollments carry user-isolation RLS, and a JWT-invoked
// function binds butterbase_user, which cannot touch another parent's rows.
function request(body, { token = "admin-jwt" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return {
    req: new Request("https://example.test/admin-manage", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    ctx: {
      user: null,
      env: {
        BUTTERBASE_APP_ID: "app_test",
        BUTTERBASE_API_URL: "https://api.test",
        SERVICE_KEY: "bb_sk_test",
      },
    },
  };
}

// `respond(url, call)` returns { ok?, status?, body? } for any non-/me fetch.
function stubFetch({ meEmail = ADMIN_EMAIL, meOk = true, respond = () => ({ body: [] }) } = {}) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    const call = {
      url: target,
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null,
    };
    calls.push(call);
    if (target.endsWith("/me")) {
      return {
        ok: meOk,
        status: meOk ? 200 : 401,
        json: async () => (meOk ? { user: { id: "admin-1", email: meEmail } } : { error: "invalid" }),
      };
    }
    const result = respond(target, call) || {};
    const ok = result.ok !== false;
    return {
      ok,
      status: result.status || (ok ? 200 : 400),
      json: async () => (result.body === undefined ? [] : result.body),
      text: async () => JSON.stringify(result.body === undefined ? [] : result.body),
    };
  };
  const restore = () => { global.fetch = original; };
  restore.calls = calls;
  return restore;
}

async function callHandler(target, stubOptions) {
  const restore = stubFetch(stubOptions);
  try {
    const res = await handler(target.req, target.ctx);
    res.calls = restore.calls;
    return res;
  } finally { restore(); }
}

const dataCalls = (res) => res.calls.filter((call) => call.url.includes("/v1/app_test/"));

// ---- authorization ----

test("admin-manage rejects a caller presenting no token", async () => {
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

test("admin-manage does not treat ctx.user as proof of admin identity", async () => {
  const target = request({ action: "list-accounts" }, { token: null });
  target.ctx.user = { id: "admin-1", email: ADMIN_EMAIL };
  const res = await callHandler(target);
  assert.equal(res.status, 403);
});

test("admin-manage touches no data before the identity check passes", async () => {
  const res = await callHandler(request({ action: "list-accounts" }), { meEmail: "parent@example.com" });
  assert.equal(res.status, 403);
  assert.equal(dataCalls(res).length, 0);
});

test("admin-manage rejects an unknown action with 400", async () => {
  const res = await callHandler(request({ action: "nope" }));
  assert.equal(res.status, 400);
});

// ---- service-key data access ----

// The whole point of the REST layer: without the service key these reads and
// writes run as butterbase_user and RLS hides every other parent's rows.
test("data access carries the service key, not the admin's token", async () => {
  const res = await callHandler(request({ action: "list-accounts" }), {
    respond: () => ({ body: [] }),
  });
  assert.equal(res.status, 200);
  const reads = dataCalls(res);
  assert.ok(reads.length > 0);
  for (const call of reads) {
    assert.equal(call.headers.Authorization, "Bearer bb_sk_test");
  }
});

// ---- create-account ----

test("create-account returns the new account on success", async () => {
  const res = await callHandler(
    request({ action: "create-account", email: "New@Example.com ", display_name: "New Parent" }),
    { respond: (url) => (url.includes("/signup") ? { body: { user: { id: "user-9" } } } : { body: [] }) },
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.account, { user_id: "user-9", email: "new@example.com", name: "New Parent" });
});

test("create-account maps a duplicate email to EMAIL_EXISTS 409", async () => {
  const res = await callHandler(
    request({ action: "create-account", email: "dupe@example.com", display_name: "Dupe" }),
    { respond: () => ({ ok: false, status: 409, body: { error: "User already exists" } }) },
  );
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.code, "EMAIL_EXISTS");
});

// ---- students ----

test("add-student creates a student owned by the target user_id, not the admin", async () => {
  const res = await callHandler(
    request({ action: "add-student", user_id: "parent-7", name: "Mia", dob: "2016-05-01" }),
    { respond: () => ({ body: { id: "stu-1", user_id: "parent-7", name: "Mia" } }) },
  );
  assert.equal(res.status, 200);
  const insert = dataCalls(res).find((call) => call.method === "POST");
  assert.match(insert.url, /\/students$/);
  assert.equal(insert.body.user_id, "parent-7");
  assert.equal(insert.body.name, "Mia");
  assert.equal(insert.body.age, "10");
});

test("add-student rejects an invalid date of birth", async () => {
  const res = await callHandler(
    request({ action: "add-student", user_id: "parent-7", name: "Mia", dob: "not-a-date" }),
  );
  assert.equal(res.status, 400);
});

test("update-student returns 404 when the row does not exist", async () => {
  const res = await callHandler(
    request({ action: "update-student", id: "missing", name: "X", dob: "2016-05-01" }),
    { respond: () => ({ ok: false, status: 404, body: { error: { message: "Not found" } } }) },
  );
  assert.equal(res.status, 404);
});

// ---- enrollments ----

test("create-enrollment writes a comped, confirmed row priced from the schedule", async () => {
  const res = await callHandler(
    request({
      action: "create-enrollment", user_id: "parent-7", student_id: "stu-1",
      schedule_id: "sched-1", num_classes_enrolled: 8,
      student_email: "parent@example.com", parent_name: "Pat Parent",
    }),
    {
      respond: (url, call) => {
        if (url.includes("class_schedules")) return { body: [{ price_cents: 3500 }] };
        if (url.includes("students?")) return { body: [{ name: "Mia" }] };
        if (call.method === "POST") return { body: { id: "enr-1" } };
        return { body: [] };
      },
    },
  );
  assert.equal(res.status, 200);
  const insert = dataCalls(res).find((call) => call.method === "POST");
  assert.match(insert.url, /\/enrollments$/);
  assert.equal(insert.body.status, "confirmed");
  assert.equal(insert.body.price_per_class_cents, 3500); // from the schedule, not the client
  assert.equal(insert.body.total_paid_cents, 0);         // comped
  assert.equal(insert.body.discount_pct, 0);
  assert.equal(insert.body.num_classes_enrolled, 8);
  assert.equal(insert.body.student_name, "Mia");
});

test("create-enrollment rejects a student not owned by the parent", async () => {
  const res = await callHandler(
    request({
      action: "create-enrollment", user_id: "parent-7", student_id: "stu-x",
      schedule_id: "sched-1", num_classes_enrolled: 8, student_email: "p@e.com", parent_name: "P",
    }),
    {
      respond: (url) => {
        if (url.includes("class_schedules")) return { body: [{ price_cents: 3500 }] };
        return { body: [] }; // student lookup finds nothing
      },
    },
  );
  assert.equal(res.status, 400);
  assert.equal(dataCalls(res).filter((call) => call.method === "POST").length, 0);
});

test("create-enrollment 404s on an inactive or unknown schedule", async () => {
  const res = await callHandler(
    request({
      action: "create-enrollment", user_id: "parent-7", student_id: "stu-1",
      schedule_id: "gone", num_classes_enrolled: 8, student_email: "p@e.com", parent_name: "P",
    }),
    { respond: () => ({ body: [] }) },
  );
  assert.equal(res.status, 404);
});

test("create-enrollment requires at least one class", async () => {
  const res = await callHandler(
    request({
      action: "create-enrollment", user_id: "parent-7", student_id: "stu-1",
      schedule_id: "sched-1", num_classes_enrolled: 0,
    }),
  );
  assert.equal(res.status, 400);
});

// ---- credits ----

test("set-credits updates num_classes_enrolled and returns the row", async () => {
  const res = await callHandler(
    request({ action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: 12 }),
    { respond: () => ({ body: { id: "enr-1", num_classes_enrolled: 12 } }) },
  );
  assert.equal(res.status, 200);
  const patch = dataCalls(res).find((call) => call.method === "PATCH");
  assert.match(patch.url, /\/enrollments\/enr-1$/);
  assert.equal(patch.body.num_classes_enrolled, 12);
});

test("set-credits allows a below-attended (even zero) value", async () => {
  const res = await callHandler(
    request({ action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: 0 }),
    { respond: () => ({ body: { id: "enr-1", num_classes_enrolled: 0 } }) },
  );
  assert.equal(res.status, 200);
});

test("set-credits 404s for an unknown enrollment", async () => {
  const res = await callHandler(
    request({ action: "set-credits", enrollment_id: "gone", num_classes_enrolled: 5 }),
    { respond: () => ({ ok: false, status: 404, body: { error: { message: "Not found" } } }) },
  );
  assert.equal(res.status, 404);
});

test("set-credits rejects a negative value", async () => {
  const res = await callHandler(
    request({ action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: -3 }),
  );
  assert.equal(res.status, 400);
});

test("set-credits rejects an invalid status", async () => {
  const res = await callHandler(
    request({ action: "set-credits", enrollment_id: "enr-1", num_classes_enrolled: 5, status: "bogus" }),
  );
  assert.equal(res.status, 400);
});

// ---- accounts listing ----

test("list-accounts aggregates parents across students and enrollments", async () => {
  const res = await callHandler(request({ action: "list-accounts" }), {
    respond: (url) => {
      if (url.includes("students?")) {
        return { body: [{ user_id: "p1" }, { user_id: "p1" }, { user_id: "p2" }] };
      }
      return {
        body: [
          { user_id: "p1", student_email: "a@e.com", parent_name: "Alice" },
          { user_id: "p1", student_email: "a@e.com", parent_name: "Alice" },
          { user_id: "p3", student_email: "c@e.com", parent_name: "Cara" },
        ],
      };
    },
  });
  assert.equal(res.status, 200);
  const { accounts } = await res.json();
  const byId = Object.fromEntries(accounts.map((a) => [a.user_id, a]));

  // p1 has both students and enrollments
  assert.deepEqual(byId.p1, {
    user_id: "p1", email: "a@e.com", name: "Alice", student_count: 2, enrollment_count: 2,
  });
  // p2 has only students - still listed, with no email or name to show
  assert.deepEqual(byId.p2, {
    user_id: "p2", email: null, name: null, student_count: 1, enrollment_count: 0,
  });
  // p3 has only enrollments
  assert.deepEqual(byId.p3, {
    user_id: "p3", email: "c@e.com", name: "Cara", student_count: 0, enrollment_count: 1,
  });
});

test("list-accounts ignores rows with no owner", async () => {
  const res = await callHandler(request({ action: "list-accounts" }), {
    respond: (url) => (url.includes("students?")
      ? { body: [{ user_id: null }] }
      : { body: [{ user_id: null, student_email: "x@e.com" }] }),
  });
  assert.equal(res.status, 200);
  const { accounts } = await res.json();
  assert.deepEqual(accounts, []);
});
