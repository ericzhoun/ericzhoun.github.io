import assert from "node:assert/strict";
import { test } from "node:test";
import { handler, recoveryKey } from "../backend/functions/admin-manage.js";

const ADMIN_EMAIL = "herfield8@gmail.com";
const RECOVERY_USER_ID = "11111111-1111-4111-8111-111111111111";
const RECOVERY_EMAIL = "parent@example.com";
// Derived from the implementation rather than written out, so the fixture
// cannot drift from the real key format the way it did when the raw address
// was embedded here.
const RECOVERY_KEY = recoveryKey(RECOVERY_EMAIL);

function createMemoryKv(initial = [], failures = {}) {
  const values = new Map(initial);
  const calls = [];
  return {
    values,
    calls,
    async get(key) {
      calls.push({ operation: "get", key });
      if (failures.get) throw failures.get;
      return values.get(key) ?? null;
    },
    async set(key, value, options) {
      calls.push({ operation: "set", key, value, options });
      if (failures.set) throw failures.set;
      values.set(key, value);
    },
    async del(key) {
      calls.push({ operation: "del", key });
      if (failures.del) throw failures.del;
      values.delete(key);
    },
  };
}

function pendingRecovery(overrides = {}) {
  return {
    user_id: RECOVERY_USER_ID,
    email: RECOVERY_EMAIL,
    parent_name: "Parent Name",
    ...overrides,
  };
}

// The function is deployed with http auth "required", so the admin's JWT
// arrives in Authorization (the only cross-origin header Butterbase's CORS
// allowlist permits besides Content-Type). It is re-verified against
// /auth/{appId}/me rather than trusted via ctx.user.
//
// Data access goes through the REST data API with SERVICE_KEY, not ctx.db:
// students and enrollments carry user-isolation RLS, and a JWT-invoked
// function binds butterbase_user, which cannot touch another parent's rows.
function request(body, { token = "admin-jwt", kv = createMemoryKv() } = {}) {
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
        INVITATION_GMAIL_USER_ID: "sender-user-1",
        // deploy.sh injects this from backend/admin-emails.json.
        ADMIN_EMAILS: JSON.stringify([ADMIN_EMAIL]),
        SITE_URL: "https://olivistart.test",
      },
      kv,
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
    if (result.reject) throw result.reject;
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
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const res = await handler(target.req, target.ctx);
    res.calls = restore.calls;
    res.logs = logs;
    return res;
  } finally {
    console.error = originalConsoleError;
    restore();
  }
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

test("create-account persists the profile before sending the branded welcome email", async () => {
  const res = await callHandler(
    request({ action: "create-account", email: "New@Example.com ", display_name: "New Parent" }),
    {
      respond: (url) => {
        if (url.includes("/signup")) return { body: { user: { id: "user-9" } } };
        if (url.includes("/integrations/execute")) return { body: { successful: true } };
        return { body: { user_id: "user-9" } };
      },
    },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.welcome_sent, true);
  const profile = res.calls.find((call) => call.url.endsWith("/parent_profiles"));
  const welcome = res.calls.find((call) => call.url.endsWith("/integrations/execute"));
  assert.ok(res.calls.indexOf(profile) < res.calls.indexOf(welcome));
  assert.deepEqual(profile.body, {
    user_id: "user-9", email: "new@example.com", parent_name: "New Parent",
  });
  assert.equal(welcome.body.toolName, "GMAIL_SEND_EMAIL");
  assert.equal(welcome.body.userId, "sender-user-1");
  assert.equal(welcome.body.params.to, "new@example.com");
  assert.equal(welcome.body.params.subject, "Welcome to OliVista Art Studio");
  assert.match(welcome.body.params.body, /admin of OliVista Art Studio has created an account for you/);
  assert.match(welcome.body.params.body, /separate security email/);
  // Signup verification codes are valid for 24 hours, not the 15 minutes the
  // email used to claim - parents were being rushed for no reason.
  assert.match(welcome.body.params.body, /expire after 24 hours/);
  assert.doesNotMatch(welcome.body.params.body, /15 minutes/);
  assert.match(welcome.body.params.body, /Thank you!\nOlivia Liu$/);
  const welcomeUrl = welcome.body.params.body
    .split("\n")
    .find((line) => line.startsWith("https://olivistart.test/"));
  assert.equal(
    welcomeUrl,
    "https://olivistart.test/login.html?mode=magic-verify&email=new%40example.com&next=account.html",
  );
});

test("create-account clears pending recovery after profile persistence succeeds", async () => {
  const kv = createMemoryKv();
  const res = await callHandler(request({
    action: "create-account", email: RECOVERY_EMAIL, display_name: "Parent Name",
  }, { kv }), {
    respond: (url) => (url.includes("/signup")
      ? { body: { user: { id: RECOVERY_USER_ID } } }
      : { body: { successful: true } }),
  });

  assert.equal(res.status, 200);
  assert.equal(kv.values.has(RECOVERY_KEY), false);
  assert.deepEqual(kv.calls.map((call) => call.operation), ["get", "set", "del"]);
  assert.equal((await res.json()).recovery_persisted, false);
});

test("create-account returns the durable account when welcome delivery fails", async () => {
  const res = await callHandler(request({
    action: "create-account", email: "parent@example.com", display_name: "Parent",
  }), {
    respond: (url) => {
      if (url.includes("/signup")) return { body: { user: { id: "parent-1" } } };
      if (url.includes("/integrations/execute")) return { ok: false, status: 502, body: { error: "gmail down" } };
      return { body: { user_id: "parent-1" } };
    },
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).welcome_sent, false);
  assert.ok(res.calls.some((call) => call.url.endsWith("/parent_profiles")));
});

test("create-account returns structured recovery state when profile persistence is rejected", async () => {
  const kv = createMemoryKv();
  const res = await callHandler(request({
    action: "create-account", email: "parent@example.com", display_name: "Parent",
  }, { kv }), {
    respond: (url) => {
      if (url.includes("/signup")) return { body: { user: { id: RECOVERY_USER_ID } } };
      if (url.endsWith("/parent_profiles")) return { ok: false, status: 503, body: { error: "data unavailable" } };
      if (url.includes("/integrations/execute")) return { body: { successful: true } };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    account_exists: true,
    account: { user_id: RECOVERY_USER_ID, email: "parent@example.com", name: "Parent" },
    profile_saved: false,
    code_sent: true,
    welcome_sent: true,
    recovery_persisted: true,
    recovery_required: true,
  });
  assert.deepEqual(kv.values.get(RECOVERY_KEY), {
    user_id: RECOVERY_USER_ID,
    email: RECOVERY_EMAIL,
    parent_name: "Parent",
  });
  assert.deepEqual(
    kv.calls.find((call) => call.operation === "set").options,
    { ttl: 2_592_000 },
  );
  assert.equal(res.calls.some((call) => call.url.endsWith("/integrations/execute")), true);
});

test("create-account reload retry resolves durable recovery without a second signup", async () => {
  const kv = createMemoryKv();
  const first = await callHandler(request({
    action: "create-account", email: "Parent@Example.com", display_name: "Parent Name",
  }, { kv }), {
    respond: (url) => {
      if (url.includes("/signup")) return { body: { user: { id: RECOVERY_USER_ID } } };
      if (url.endsWith("/parent_profiles")) return { ok: false, status: 503, body: { error: "data unavailable" } };
      if (url.includes("/integrations/execute")) return { body: { successful: true } };
      return { body: [] };
    },
  });
  assert.equal(first.status, 200);

  const retry = await callHandler(request({
    action: "create-account", email: " parent@example.com ", display_name: "Tampered Name",
  }, { kv }), {
    respond: (url) => (url.includes("/signup")
      ? { body: { user: { id: "22222222-2222-4222-8222-222222222222" } } }
      : { body: [] }),
  });

  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), {
    account_exists: true,
    account: { user_id: RECOVERY_USER_ID, email: RECOVERY_EMAIL, name: "Parent Name" },
    profile_saved: false,
    code_sent: false,
    welcome_sent: false,
    recovery_persisted: true,
    recovery_required: true,
  });
  assert.equal(retry.calls.some((call) => call.url.endsWith("/signup")), false);
  assert.equal(retry.calls.some((call) => call.url.includes("/v1/app_test/")), false);
});

test("lookup-account-recovery resolves pending state without signup", async () => {
  const kv = createMemoryKv([[RECOVERY_KEY, pendingRecovery()]]);
  const res = await callHandler(request({
    action: "lookup-account-recovery",
    email: " Parent@Example.com ",
  }, { kv }));

  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).account, {
    user_id: RECOVERY_USER_ID,
    email: RECOVERY_EMAIL,
    name: "Parent Name",
  });
  assert.equal(res.calls.some((call) => call.url.endsWith("/signup")), false);
});

test("create-account fails closed before signup when recovery KV lookup fails", async () => {
  const kv = createMemoryKv([], { get: new Error("kv unavailable") });
  const res = await callHandler(request({
    action: "create-account", email: RECOVERY_EMAIL, display_name: "Parent Name",
  }, { kv }));

  assert.equal(res.status, 503);
  assert.equal(res.calls.some((call) => call.url.endsWith("/signup")), false);
  assert.equal((await res.json()).recovery_state_unavailable, true);
});

test("create-account reports when profile and durable recovery persistence both fail", async () => {
  const kv = createMemoryKv([], { set: new Error("kv unavailable") });
  const res = await callHandler(request({
    action: "create-account", email: RECOVERY_EMAIL, display_name: "Parent Name",
  }, { kv }), {
    respond: (url) => {
      if (url.includes("/signup")) return { body: { user: { id: RECOVERY_USER_ID } } };
      if (url.endsWith("/parent_profiles")) return { ok: false, status: 503, body: { error: "data unavailable" } };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.account_exists, true);
  assert.equal(body.profile_saved, false);
  assert.equal(body.recovery_persisted, false);
  assert.equal(body.recovery_required, true);
});

test("create-account catches a rejected Gmail request after signup", async () => {
  const res = await callHandler(request({
    action: "create-account", email: "parent@example.com", display_name: "Parent",
  }), {
    respond: (url) => {
      if (url.includes("/signup")) return { body: { user: { id: RECOVERY_USER_ID } } };
      if (url.includes("/integrations/execute")) return { reject: new Error("network unavailable") };
      return { body: { user_id: RECOVERY_USER_ID } };
    },
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.account_exists, true);
  assert.equal(body.profile_saved, true);
  assert.equal(body.welcome_sent, false);
  assert.equal(body.recovery_required, true);
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

// ---- resend onboarding ----

test("resend-invitation uses the stored profile email for both messages", async () => {
  const res = await callHandler(request({
    action: "resend-invitation", user_id: "parent-7", email: "attacker@example.com",
  }), {
    respond: (url) => {
      if (url.includes("parent_profiles?")) return { body: [{ email: "real@example.com", parent_name: "Real Parent" }] };
      if (url.includes("/magic-link")) return { body: { message: "sent" } };
      if (url.includes("/integrations/execute")) return { body: { successful: true } };
      return { body: [] };
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { code_sent: true, welcome_sent: true });
  const magic = res.calls.find((call) => call.url.endsWith("/magic-link"));
  const gmail = res.calls.find((call) => call.url.endsWith("/integrations/execute"));
  assert.equal(magic.body.email, "real@example.com");
  assert.equal(gmail.body.params.to, "real@example.com");
});

test("resend-invitation reports each independent delivery outcome", async () => {
  const cases = [
    { name: "magic success and welcome failure", magic: { body: { message: "sent" } }, gmail: { body: { successful: false } }, want: { code_sent: true, welcome_sent: false } },
    { name: "magic failure and welcome success", magic: { ok: false, status: 502, body: { error: "unavailable" } }, gmail: { body: { successful: true } }, want: { code_sent: false, welcome_sent: true } },
    { name: "both deliveries fail", magic: { ok: false, status: 502, body: { error: "unavailable" } }, gmail: { body: { successful: false } }, want: { code_sent: false, welcome_sent: false } },
  ];

  for (const scenario of cases) {
    const res = await callHandler(request({ action: "resend-invitation", user_id: "parent-7" }), {
      respond: (url) => {
        if (url.includes("parent_profiles?")) return { body: [{ email: "real@example.com", parent_name: "Real Parent" }] };
        if (url.includes("/magic-link")) return scenario.magic;
        if (url.includes("/integrations/execute")) return scenario.gmail;
        return { body: [] };
      },
    });
    assert.equal(res.status, 200, scenario.name);
    assert.deepEqual(await res.json(), scenario.want, scenario.name);
  }
});

test("resend-invitation returns 404 when the parent profile is absent", async () => {
  const res = await callHandler(request({ action: "resend-invitation", user_id: "parent-7" }), {
    respond: () => ({ body: [] }),
  });
  assert.equal(res.status, 404);
  assert.equal(res.calls.some((call) => call.url.endsWith("/magic-link")), false);
  assert.equal(res.calls.some((call) => call.url.endsWith("/integrations/execute")), false);
});

// ---- account recovery ----

test("recover-account creates a missing profile and resends both onboarding messages", async () => {
  const kv = createMemoryKv([[RECOVERY_KEY, pendingRecovery()]]);
  const res = await callHandler(request({
    action: "recover-account",
    user_id: RECOVERY_USER_ID,
    email: " Parent@Example.com ",
    parent_name: " Parent Name ",
  }, { kv }), {
    respond: (url, call) => {
      if (url.includes("parent_profiles?")) return { body: [] };
      if (url.endsWith("/parent_profiles") && call.method === "POST") return { body: call.body };
      if (url.endsWith("/magic-link")) return { body: { message: "sent" } };
      if (url.endsWith("/integrations/execute")) return { body: { successful: true } };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    account_exists: true,
    account: { user_id: RECOVERY_USER_ID, email: "parent@example.com", name: "Parent Name" },
    profile_saved: true,
    code_sent: true,
    welcome_sent: true,
    recovery_persisted: false,
    recovery_required: false,
  });
  const create = res.calls.find((call) => call.url.endsWith("/parent_profiles") && call.method === "POST");
  assert.deepEqual(create.body, {
    user_id: RECOVERY_USER_ID,
    email: "parent@example.com",
    parent_name: "Parent Name",
  });
  assert.equal(kv.values.has(RECOVERY_KEY), false);
  assert.equal(kv.calls.at(-1).operation, "del");
});

test("recover-account is idempotent when the profile already exists", async () => {
  const kv = createMemoryKv([[RECOVERY_KEY, pendingRecovery()]]);
  const res = await callHandler(request({
    action: "recover-account",
    user_id: RECOVERY_USER_ID,
    email: "parent@example.com",
    parent_name: "Parent Name",
  }, { kv }), {
    respond: (url, call) => {
      if (url.includes("parent_profiles?")) {
        return { body: [{ user_id: RECOVERY_USER_ID, email: "parent@example.com", parent_name: "Parent Name" }] };
      }
      if (url.endsWith(`/parent_profiles/${RECOVERY_USER_ID}`) && call.method === "PATCH") return { body: call.body };
      if (url.endsWith("/magic-link")) return { body: { message: "sent" } };
      if (url.endsWith("/integrations/execute")) return { body: { successful: true } };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.calls.filter((call) => call.url.endsWith("/parent_profiles") && call.method === "POST").length, 0);
  assert.equal(res.calls.filter((call) => call.url.endsWith(`/parent_profiles/${RECOVERY_USER_ID}`) && call.method === "PATCH").length, 1);
  assert.equal(res.calls.filter((call) => call.url.endsWith("/magic-link")).length, 1);
  assert.equal(res.calls.filter((call) => call.url.endsWith("/integrations/execute")).length, 1);
  assert.equal(kv.values.has(RECOVERY_KEY), false);
});

test("recover-account reports profile and delivery failures without hiding the existing account", async () => {
  const kv = createMemoryKv([[RECOVERY_KEY, pendingRecovery()]]);
  const res = await callHandler(request({
    action: "recover-account",
    user_id: RECOVERY_USER_ID,
    email: "parent@example.com",
    parent_name: "Parent Name",
  }, { kv }), {
    respond: (url) => {
      if (url.includes("parent_profiles?")) return { body: [] };
      if (url.endsWith("/parent_profiles")) return { ok: false, status: 503, body: { error: "data unavailable" } };
      if (url.endsWith("/magic-link")) return { ok: false, status: 503, body: { error: "auth unavailable" } };
      if (url.endsWith("/integrations/execute")) return { reject: new Error("gmail unavailable") };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    account_exists: true,
    account: { user_id: RECOVERY_USER_ID, email: "parent@example.com", name: "Parent Name" },
    profile_saved: false,
    code_sent: false,
    welcome_sent: false,
    recovery_persisted: true,
    recovery_required: true,
  });
  assert.deepEqual(kv.values.get(RECOVERY_KEY), pendingRecovery());
});

test("recover-account rejects tampered user or email against the pending record", async () => {
  const cases = [
    {
      body: { user_id: "22222222-2222-4222-8222-222222222222", email: RECOVERY_EMAIL, parent_name: "Parent Name" },
      kv: createMemoryKv([[RECOVERY_KEY, pendingRecovery()]]),
    },
    {
      body: { user_id: RECOVERY_USER_ID, email: "other@example.com", parent_name: "Parent Name" },
      kv: createMemoryKv([[RECOVERY_KEY, pendingRecovery()]]),
    },
  ];

  for (const scenario of cases) {
    const res = await callHandler(request({ action: "recover-account", ...scenario.body }, { kv: scenario.kv }));
    assert.equal(res.status, scenario.body.email === RECOVERY_EMAIL ? 400 : 404);
    assert.equal(dataCalls(res).length, 0);
    assert.equal(scenario.kv.values.has(RECOVERY_KEY), true);
  }
});

test("recover-account preserves pending state when KV deletion fails after profile save", async () => {
  const kv = createMemoryKv([[RECOVERY_KEY, pendingRecovery()]], { del: new Error("kv unavailable") });
  const res = await callHandler(request({
    action: "recover-account",
    user_id: RECOVERY_USER_ID,
    email: RECOVERY_EMAIL,
    parent_name: "Parent Name",
  }, { kv }), {
    respond: (url, call) => {
      if (url.includes("parent_profiles?")) return { body: [] };
      if (url.endsWith("/parent_profiles") && call.method === "POST") return { body: call.body };
      if (url.endsWith("/magic-link")) return { body: { message: "sent" } };
      if (url.endsWith("/integrations/execute")) return { body: { successful: true } };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile_saved, true);
  assert.equal(body.recovery_persisted, true);
  assert.equal(kv.values.has(RECOVERY_KEY), true);
});

test("recover-account validates the recovery identity before any write", async () => {
  const cases = [
    { user_id: `${RECOVERY_USER_ID}/other`, email: "parent@example.com", parent_name: "Parent" },
    { user_id: RECOVERY_USER_ID, email: "not-an-email", parent_name: "Parent" },
    { user_id: RECOVERY_USER_ID, email: "parent@example.com", parent_name: "" },
  ];
  for (const candidate of cases) {
    const res = await callHandler(request({ action: "recover-account", ...candidate }));
    assert.equal(res.status, 400, JSON.stringify(candidate));
    assert.equal(dataCalls(res).length, 0);
  }
});

// ---- accounts listing ----

test("list-accounts aggregates parents across students and enrollments", async () => {
  const res = await callHandler(request({ action: "list-accounts" }), {
    respond: (url) => {
      if (url.includes("parent_profiles?")) {
        return { body: [
          { user_id: "p1", email: "profile@e.com", parent_name: "Profile Alice" },
          { user_id: "p4", email: "fresh@e.com", parent_name: "Fresh Parent" },
        ] };
      }
      if (url.includes("students?")) {
        return { body: [{ user_id: "p1" }, { user_id: "p1" }, { user_id: "p2" }] };
      }
      return {
        body: [
          { user_id: "p1", student_email: "a@e.com", parent_name: "Updated Alice", created_at: "2026-07-31T12:00:00Z" },
          { user_id: "p1", student_email: "a@e.com", parent_name: "Old Alice", created_at: "2026-07-01T12:00:00Z" },
          { user_id: "p3", student_email: "c@e.com", parent_name: "Cara", created_at: "2026-07-02T12:00:00Z" },
        ],
      };
    },
  });
  assert.equal(res.status, 200);
  assert.ok(dataCalls(res).some((call) => call.url.includes("order=created_at.desc")));
  const { accounts } = await res.json();
  const byId = Object.fromEntries(accounts.map((a) => [a.user_id, a]));

  // p1 has both students and enrollments
  assert.deepEqual(byId.p1, {
    user_id: "p1", email: "profile@e.com", name: "Profile Alice", student_count: 2, enrollment_count: 2,
  });
  // p2 has only students - still listed, with no email or name to show
  assert.deepEqual(byId.p2, {
    user_id: "p2", email: null, name: null, student_count: 1, enrollment_count: 0,
  });
  // p3 has only enrollments
  assert.deepEqual(byId.p3, {
    user_id: "p3", email: "c@e.com", name: "Cara", student_count: 0, enrollment_count: 1,
  });
  // p4 has an account profile but has not added students or enrolled yet.
  assert.deepEqual(byId.p4, {
    user_id: "p4", email: "fresh@e.com", name: "Fresh Parent", student_count: 0, enrollment_count: 0,
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

// The KV store rejects "@" in keys with 400 key_invalid. Embedding the raw
// address made every create-account fail its recovery lookup and return 503,
// so the encoding is pinned here rather than left implicit.
test("recoveryKey never emits a character the KV store rejects", () => {
  const addresses = [
    "parent@example.com",
    "parent+tag@sub.domain.co.uk",
    "UPPER.Case@Example.COM",
    "dashed-name@example-domain.org",
  ];
  for (const address of addresses) {
    const key = recoveryKey(address);
    assert.ok(key.startsWith("admin-account-recovery:"), `prefix missing for ${address}`);
    const suffix = key.slice("admin-account-recovery:".length);
    assert.match(suffix, /^[A-Za-z0-9_-]+$/, `unsafe characters for ${address}`);
    assert.ok(!key.includes("@"), `"@" leaked into the key for ${address}`);
  }
});

test("recoveryKey maps distinct addresses to distinct keys", () => {
  const keys = new Set(
    ["a@example.com", "b@example.com", "a@example.org", "A@example.com"].map(recoveryKey),
  );
  assert.equal(keys.size, 4);
});

// The allowlist is now configuration rather than a literal, so a deploy that
// omits it must deny everyone rather than admit everyone.
test("admin-manage denies access when the injected allowlist is missing", async () => {
  const target = request({ action: "list-accounts" });
  delete target.ctx.env.ADMIN_EMAILS;
  const res = await callHandler(target);
  assert.equal(res.status, 403);
  assert.equal(dataCalls(res).length, 0);
});

test("admin-manage denies access when the injected allowlist is malformed", async () => {
  for (const value of ["not json", "{}", '"a string"', "[]"]) {
    const target = request({ action: "list-accounts" });
    target.ctx.env.ADMIN_EMAILS = value;
    const res = await callHandler(target);
    assert.equal(res.status, 403, `value ${value} should deny`);
  }
});

// ---- standalone students (no parent account yet) ----

// The admin records the student before the family ever signs up. The insert
// must omit user_id entirely (requires the students.user_id nullable
// migration) so RLS keeps the row invisible to end users until a parent is
// attached.
test("add-student records a standalone student when no parent account exists", async () => {
  const res = await callHandler(
    request({ action: "add-student", name: "Leo", dob: "2018-03-15", notes: "Trial first" }),
    { respond: () => ({ body: { id: "stu-2", user_id: null, name: "Leo" } }) },
  );
  assert.equal(res.status, 200);
  const insert = dataCalls(res).find((call) => call.method === "POST");
  assert.match(insert.url, /\/students$/);
  assert.equal(insert.body.user_id, undefined);
  assert.equal(insert.body.name, "Leo");
  assert.equal(insert.body.age, "8");
});

test("add-student still requires a name and a valid date of birth without a parent", async () => {
  const missingName = await callHandler(request({ action: "add-student", dob: "2018-03-15" }));
  assert.equal(missingName.status, 400);
  const badDob = await callHandler(request({ action: "add-student", name: "Leo", dob: "15/03/2018" }));
  assert.equal(badDob.status, 400);
  assert.equal(dataCalls(missingName).concat(dataCalls(badDob)).filter((call) => call.method === "POST").length, 0);
});

test("create-enrollment records a standalone enrollment with user_id omitted", async () => {
  const res = await callHandler(
    request({
      action: "create-enrollment", student_id: "stu-2", schedule_id: "sched-1",
      num_classes_enrolled: 8,
    }),
    {
      respond: (url, call) => {
        if (url.includes("class_schedules")) return { body: [{ price_cents: 4200 }] };
        if (url.includes("students?")) return { body: [{ name: "Leo" }] };
        if (call.method === "POST") return { body: { id: "enr-9" } };
        return { body: [] };
      },
    },
  );
  assert.equal(res.status, 200);
  const insert = dataCalls(res).find((call) => call.method === "POST");
  assert.match(insert.url, /\/enrollments$/);
  assert.equal(insert.body.user_id, undefined);
  assert.equal(insert.body.student_id, "stu-2");
  assert.equal(insert.body.status, "confirmed");
  assert.equal(insert.body.price_per_class_cents, 4200); // still priced from the schedule
  assert.equal(insert.body.total_paid_cents, 0);
});

test("create-enrollment without a parent 404s cleanly when the student is unknown", async () => {
  const res = await callHandler(
    request({ action: "create-enrollment", student_id: "stu-x", schedule_id: "sched-1", num_classes_enrolled: 8 }),
    {
      respond: (url) => {
        if (url.includes("class_schedules")) return { body: [{ price_cents: 4200 }] };
        return { body: [] };
      },
    },
  );
  assert.equal(res.status, 400);
  assert.equal(dataCalls(res).filter((call) => call.method === "POST").length, 0);
});

// ---- record-session-status (attendance, no-show, and 请假 leave) ----

const ENROLLMENT_UUID = "22222222-2222-4222-8222-222222222222";
const SESSION_UUID = "33333333-3333-4333-8333-333333333333";
const OTHER_SCHEDULE_UUID = "44444444-4444-4444-8444-444444444444";
const BOOKING_UUID = "55555555-5555-4555-8555-555555555555";

function recordRequest(status) {
  return request({
    action: "record-session-status",
    enrollment_id: ENROLLMENT_UUID,
    session_id: SESSION_UUID,
    status,
  });
}

// Responds schedule lookups: the enrollment and the session share a schedule.
function recordRespond(bookings = []) {
  return (url, call) => {
    if (url.includes("/enrollments?")) return { body: [{ schedule_id: "sched-1" }] };
    if (url.includes("/class_sessions?")) return { body: [{ schedule_id: "sched-1" }] };
    if (url.match(/\/bookings\?/)) return { body: bookings };
    if (url.match(/\/bookings\//) && call.method === "PATCH") return { body: { id: BOOKING_UUID, status: "skipped" } };
    if (call.method === "POST") return { body: { id: BOOKING_UUID, status: "attended" } };
    return { body: [] };
  };
}

test("record-session-status marks an excused leave on the existing booking", async () => {
  const res = await callHandler(recordRequest("skipped"), { respond: recordRespond([{ id: BOOKING_UUID, status: "scheduled" }]) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { booking_id: BOOKING_UUID, status: "skipped" });
  const patch = dataCalls(res).find((call) => call.method === "PATCH");
  assert.match(patch.url, new RegExp(`/bookings/${BOOKING_UUID}$`));
  assert.equal(patch.body.status, "skipped");
  assert.ok(patch.body.marked_at);
});

test("record-session-status creates a home booking when none exists", async () => {
  const res = await callHandler(recordRequest("attended"), { respond: recordRespond([]) });
  assert.equal(res.status, 200);
  const insert = dataCalls(res).find((call) => call.method === "POST");
  assert.match(insert.url, /\/bookings$/);
  assert.equal(insert.body.type, "home");
  assert.equal(insert.body.enrollment_id, ENROLLMENT_UUID);
  assert.equal(insert.body.session_id, SESSION_UUID);
  assert.equal(insert.body.status, "attended");
});

test("record-session-status treats a cancelled make-up as absent and mints a fresh booking", async () => {
  const res = await callHandler(recordRequest("no_show"), { respond: recordRespond([{ id: BOOKING_UUID, status: "cancelled" }]) });
  assert.equal(res.status, 200);
  assert.equal(dataCalls(res).filter((call) => call.method === "PATCH").length, 0);
  const insert = dataCalls(res).find((call) => call.method === "POST");
  assert.match(insert.url, /\/bookings$/);
  assert.equal(insert.body.status, "no_show");
});

test("record-session-status validates input before touching data", async () => {
  const badStatus = await callHandler(recordRequest("cancelled"));
  assert.equal(badStatus.status, 400);
  const badUuid = await callHandler(request({
    action: "record-session-status", enrollment_id: "enr-1", session_id: SESSION_UUID, status: "attended",
  }));
  assert.equal(badUuid.status, 400);
  const extraField = await callHandler(request({
    action: "record-session-status", enrollment_id: ENROLLMENT_UUID, session_id: SESSION_UUID,
    status: "attended", booking_id: BOOKING_UUID,
  }));
  assert.equal(extraField.status, 400);
  for (const res of [badStatus, badUuid, extraField]) {
    assert.equal(dataCalls(res).length, 0);
  }
});

test("record-session-status 404s on an unknown enrollment or session", async () => {
  const missingEnrollment = await callHandler(recordRequest("attended"), {
    respond: (url) => (url.includes("/enrollments?") ? { body: [] } : { body: [{ schedule_id: "sched-1" }] }),
  });
  assert.equal(missingEnrollment.status, 404);
  const missingSession = await callHandler(recordRequest("attended"), {
    respond: (url) => (url.includes("/class_sessions?") ? { body: [] } : { body: [{ schedule_id: "sched-1" }] }),
  });
  assert.equal(missingSession.status, 404);
});

test("record-session-status refuses a session from another schedule", async () => {
  const res = await callHandler(recordRequest("attended"), {
    respond: (url) => {
      if (url.includes("/enrollments?")) return { body: [{ schedule_id: "sched-1" }] };
      return { body: [{ schedule_id: OTHER_SCHEDULE_UUID }] };
    },
  });
  assert.equal(res.status, 400);
  assert.equal(dataCalls(res).filter((call) => call.method === "PATCH" || call.method === "POST").length, 0);
});

// ---- admin-data surface for the roster and attendance sheet ----

test("admin-data exposes the fields the roster and attendance sheet need", async () => {
  const res = await callHandler(request({
    action: "admin-data",
    operation: "read",
    resource: "enrollments",
    query: {
      select: ["id", "enrollment_type", "num_classes_enrolled"],
      filters: [{ field: "schedule_id", operator: "eq", value: OTHER_SCHEDULE_UUID }],
    },
  }));
  assert.equal(res.status, 200);
  const read = dataCalls(res).find((call) => call.url.includes("/enrollments?"));
  assert.match(read.url, /enrollment_type/);
  assert.match(read.url, /schedule_id=eq\./);
});

test("admin-data allows parent_profiles reads for the roster and blocks writes", async () => {
  const read = await callHandler(request({ action: "admin-data", operation: "read", resource: "parent_profiles" }));
  assert.equal(read.status, 200);
  const write = await callHandler(request({
    action: "admin-data", operation: "create", resource: "parent_profiles",
    fields: { email: "p@e.com", parent_name: "P" },
  }));
  assert.equal(write.status, 400);
});

// ---- pending parents ----

test("create-pending-parent inserts a placeholder with a normalized email", async () => {
  const res = await callHandler(request({
    action: "create-pending-parent",
    parent_name: "Wei Chen",
    email: "  Wei.Chen@Example.COM ",
    student_phone: "555-0100",
  }), {
    respond: (url) => {
      if (url.includes("parent_profiles")) return { body: [] };
      if (url.includes("pending_parents")) return { body: [{ id: "pending-1", parent_name: "Wei Chen", email: "wei.chen@example.com" }] };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  assert.equal((await res.json()).pending_parent.id, "pending-1");
  const insert = dataCalls(res).find((call) => call.method === "POST" && call.url.includes("pending_parents"));
  assert.equal(insert.body.email, "wei.chen@example.com");
  assert.equal(insert.body.parent_name, "Wei Chen");
});

test("create-pending-parent accepts a placeholder with no email at all", async () => {
  const res = await callHandler(request({
    action: "create-pending-parent",
    parent_name: "Name Only",
  }), {
    respond: (url) => url.includes("pending_parents")
      ? { body: [{ id: "pending-2", parent_name: "Name Only", email: null }] }
      : { body: [] },
  });

  assert.equal(res.status, 200);
  const insert = dataCalls(res).find((call) => call.method === "POST");
  assert.equal(insert.body.email, undefined);
  // A name-only placeholder must not trigger the shadowing lookup.
  assert.equal(dataCalls(res).some((call) => call.url.includes("parent_profiles")), false);
});

test("create-pending-parent requires a parent name", async () => {
  const res = await callHandler(request({ action: "create-pending-parent", email: "a@example.com" }));
  assert.equal(res.status, 400);
});

test("create-pending-parent refuses an email that already has a real account", async () => {
  const res = await callHandler(request({
    action: "create-pending-parent",
    parent_name: "Duplicate",
    email: "taken@example.com",
  }), {
    respond: (url) => url.includes("parent_profiles")
      ? { body: [{ user_id: "user-9", email: "taken@example.com", parent_name: "Real Parent" }] }
      : { body: [] },
  });

  assert.equal(res.status, 409);
  const payload = await res.json();
  assert.equal(payload.code, "ACCOUNT_EXISTS");
  assert.equal(payload.user_id, "user-9");
  assert.equal(dataCalls(res).some((call) => call.method === "POST" && call.url.includes("pending_parents")), false);
});

test("update-pending-parent patches the requested fields", async () => {
  const res = await callHandler(request({
    action: "update-pending-parent",
    id: "pending-1",
    parent_name: "Wei Chen",
    student_phone: "555-0199",
  }), {
    respond: (url) => url.includes("pending_parents")
      ? { body: [{ id: "pending-1", parent_name: "Wei Chen", student_phone: "555-0199" }] }
      : { body: [] },
  });

  assert.equal(res.status, 200);
  const patch = dataCalls(res).find((call) => call.method === "PATCH");
  assert.ok(patch.url.includes("pending_parents/pending-1"));
  assert.equal(patch.body.student_phone, "555-0199");
  assert.ok(patch.body.updated_at);
});

test("update-pending-parent refuses an email that already has a real account", async () => {
  const res = await callHandler(request({
    action: "update-pending-parent",
    id: "pending-1",
    email: "taken@example.com",
  }), {
    respond: (url) => url.includes("parent_profiles")
      ? { body: [{ user_id: "user-9", email: "taken@example.com" }] }
      : { body: [] },
  });

  assert.equal(res.status, 409);
  assert.equal(dataCalls(res).some((call) => call.method === "PATCH"), false);
});

test("update-pending-parent requires an id", async () => {
  const res = await callHandler(request({ action: "update-pending-parent", parent_name: "No Id" }));
  assert.equal(res.status, 400);
});
