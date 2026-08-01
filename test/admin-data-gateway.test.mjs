import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

import { handler } from "../backend/functions/admin-manage.js";
import { createAdminDataClient } from "../js/admin-data.js";

const ADMIN_EMAIL = "herfield8@gmail.com";
const UUID = "11111111-1111-4111-8111-111111111111";

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
      user: { id: "admin-1" },
      env: {
        BUTTERBASE_APP_ID: "app_test",
        BUTTERBASE_API_URL: "https://api.test",
        SERVICE_KEY: "service-key-fixture",
        SITE_URL: "https://olivistart.test",
        INVITATION_GMAIL_USER_ID: "sender-user-1",
      },
    },
  };
}

async function callHandler(body, { meEmail = ADMIN_EMAIL } = {}) {
  const target = request(body);
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const call = {
      url: String(url),
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null,
    };
    calls.push(call);
    if (call.url.endsWith("/me")) {
      return new Response(JSON.stringify({ user: { id: "admin-1", email: meEmail } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify([{ id: UUID }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await handler(target.req, target.ctx);
    return { response, calls };
  } finally {
    global.fetch = originalFetch;
  }
}

test("admin data reads use the server gateway and return rows", async () => {
  const { response, calls } = await callHandler({
    action: "admin-data",
    operation: "read",
    resource: "programs",
    query: {
      select: ["id", "name"],
      order: [{ field: "sort_order", direction: "asc" }],
      filters: [{ field: "active", operator: "eq", value: true }],
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rows: [{ id: UUID }] });
  const dataCall = calls.find((call) => call.url.includes("/v1/app_test/programs?"));
  assert.ok(dataCall);
  assert.equal(dataCall.method, "GET");
  assert.equal(dataCall.headers.Authorization, "Bearer service-key-fixture");
  assert.equal(
    dataCall.url,
    "https://api.test/v1/app_test/programs?select=id%2Cname&order=sort_order.asc&active=eq.true",
  );
});

test("admin data reads project the full resource allowlist when query is omitted", async () => {
  const { response, calls } = await callHandler({
    action: "admin-data",
    operation: "read",
    resource: "programs",
  });

  assert.equal(response.status, 200);
  assert.equal(
    calls.find((call) => call.url.includes("/v1/app_test/programs")).url,
    "https://api.test/v1/app_test/programs?select=id%2Cname%2Cslug%2Cdescription%2Cimage_url%2Csort_order%2Cnum_classes%2Cactive%2Cprogram_type%2Ccreated_at%2Cupdated_at",
  );
});

test("admin data reads project the full resource allowlist when select is omitted", async () => {
  const { response, calls } = await callHandler({
    action: "admin-data",
    operation: "read",
    resource: "programs",
    query: { order: [{ field: "sort_order", direction: "asc" }] },
  });

  assert.equal(response.status, 200);
  assert.equal(
    calls.find((call) => call.url.includes("/v1/app_test/programs")).url,
    "https://api.test/v1/app_test/programs?select=id%2Cname%2Cslug%2Cdescription%2Cimage_url%2Csort_order%2Cnum_classes%2Cactive%2Cprogram_type%2Ccreated_at%2Cupdated_at&order=sort_order.asc",
  );
});

test("admin data writes allow only declared resource fields", async () => {
  const allowed = await callHandler({
    action: "admin-data",
    operation: "update",
    resource: "enrollments",
    id: UUID,
    fields: { status: "confirmed" },
  });
  assert.equal(allowed.response.status, 200);
  const dataCall = allowed.calls.find((call) => call.url.endsWith(`/enrollments/${UUID}`));
  assert.equal(dataCall.method, "PATCH");
  assert.deepEqual(dataCall.body, { status: "confirmed" });

  const rejected = await callHandler({
    action: "admin-data",
    operation: "update",
    resource: "enrollments",
    id: UUID,
    fields: { user_id: UUID },
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.calls.some((call) => call.url.includes("/enrollments/")), false);
});

test("admin data writes normalize blank nullable text fields to null", async () => {
  const program = await callHandler({
    action: "admin-data",
    operation: "create",
    resource: "programs",
    fields: { description: "", image_url: " \t " },
  });
  assert.equal(program.response.status, 200);
  assert.deepEqual(
    program.calls.find((call) => call.url.endsWith("/programs") && call.method === "POST").body,
    { description: null, image_url: null },
  );

  const schedule = await callHandler({
    action: "admin-data",
    operation: "update",
    resource: "class_schedules",
    id: UUID,
    fields: { notes: "   " },
  });
  assert.equal(schedule.response.status, 200);
  assert.deepEqual(
    schedule.calls.find((call) => call.url.endsWith(`/class_schedules/${UUID}`)).body,
    { notes: null },
  );
});

test("admin data gateway rejects disallowed resources, operations, identifiers, and queries", async () => {
  const cases = [
    { operation: "read", resource: "app_users" },
    { operation: "put", resource: "programs", id: UUID, fields: {} },
    { operation: "delete", resource: "programs", id: `${UUID}/parent_profiles` },
    { operation: "read", resource: "programs", query: { filters: [{ field: "secret", operator: "eq", value: "x" }] } },
    { operation: "read", resource: "programs", query: { filters: [{ field: "id", operator: "contains", value: UUID }] } },
    { operation: "create", resource: "bookings", fields: { status: "attended" } },
  ];

  for (const candidate of cases) {
    const { response, calls } = await callHandler({ action: "admin-data", ...candidate });
    assert.equal(response.status, 400, JSON.stringify(candidate));
    assert.equal(calls.filter((call) => call.url.includes("/v1/app_test/")).length, 0);
  }
});

test("admin data gateway rejects non-admin callers before service access", async () => {
  const { response, calls } = await callHandler({
    action: "admin-data",
    operation: "read",
    resource: "programs",
  }, { meEmail: "parent@example.com" });

  assert.equal(response.status, 403);
  assert.equal(calls.filter((call) => call.url.includes("/v1/app_test/")).length, 0);
});

test("admin browser client sends structured gateway requests", async () => {
  const invocations = [];
  const client = createAdminDataClient(async (action, body) => {
    invocations.push({ action, body });
    return body.operation === "delete" ? { deleted: true } : { rows: [{ id: UUID }] };
  });

  assert.deepEqual(await client.read("programs", { select: ["id"] }), [{ id: UUID }]);
  assert.deepEqual(await client.update("programs", UUID, { active: false }), [{ id: UUID }]);
  assert.equal(await client.remove("programs", UUID), true);
  assert.deepEqual(invocations, [
    { action: "admin-data", body: { operation: "read", resource: "programs", query: { select: ["id"] } } },
    { action: "admin-data", body: { operation: "update", resource: "programs", id: UUID, fields: { active: false } } },
    { action: "admin-data", body: { operation: "delete", resource: "programs", id: UUID } },
  ]);
});

test("schedule publishing and attendance use explicit admin actions", async () => {
  const publish = await callHandler({ action: "publish-schedule" });
  assert.equal(publish.response.status, 200);
  const publishCall = publish.calls.find((call) => call.url.endsWith("/fn/trigger-schedule-bake"));
  assert.equal(publishCall.method, "POST");
  assert.equal(publishCall.headers.Authorization, "Bearer service-key-fixture");
  assert.deepEqual(publishCall.body, {});

  const attendance = await callHandler({
    action: "mark-attendance",
    booking_id: UUID,
    status: "no_show",
  });
  assert.equal(attendance.response.status, 200);
  const attendanceCall = attendance.calls.find((call) => call.url.endsWith("/fn/mark-attendance"));
  assert.equal(attendanceCall.method, "POST");
  assert.equal(attendanceCall.headers.Authorization, "Bearer service-key-fixture");
  assert.deepEqual(attendanceCall.body, { booking_id: UUID, status: "no_show" });
});

test("explicit admin function actions reject unexpected input", async () => {
  const cases = [
    { action: "publish-schedule", path: "fn/delete-everything" },
    { action: "mark-attendance", booking_id: `${UUID}/other`, status: "attended" },
    { action: "mark-attendance", booking_id: UUID, status: "cancelled" },
  ];
  for (const body of cases) {
    const { response, calls } = await callHandler(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(calls.some((call) => call.url.includes("/fn/")), false);
  }
});

test("served browser source contains no service credential or direct admin API", async () => {
  const jsDir = new URL("../js/", import.meta.url);
  const files = (await readdir(jsDir)).filter((file) => file.endsWith(".js"));
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, jsDir), "utf8")))).join("\n");

  assert.doesNotMatch(source, /bb_sk_[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(source, /\bADMIN_KEY\b/);
  assert.doesNotMatch(source, /\badminApi\b/);
});

test("tracked executable source contains no embedded Butterbase service credential", async () => {
  const functionsDir = new URL("../backend/functions/", import.meta.url);
  const files = (await readdir(functionsDir, { recursive: true }))
    .filter((file) => file.endsWith(".js"));
  const source = (await Promise.all(
    files.map((file) => readFile(new URL(file, functionsDir), "utf8")),
  )).join("\n");

  assert.equal(/bb_sk_[A-Za-z0-9]{20,}/.test(source), false);
});
