import assert from "node:assert/strict";
import { test } from "node:test";

import { handler } from "../backend/functions/manage-account.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function accountRequest(body, authorization = "Bearer parent-jwt") {
  const headers = { "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  return new Request("https://example.test/manage-account", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function accountContext(query) {
  return {
    user: { id: USER_ID },
    env: {
      BUTTERBASE_API_URL: "https://api.test",
      BUTTERBASE_APP_ID: "app_test",
      SERVICE_KEY: "service-key-fixture",
    },
    db: { query },
  };
}

function stubFetch(t, { user, profileExists = true, savedProfile } = {}) {
  const originalFetch = global.fetch;
  const calls = [];
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options = {}) => {
    const call = {
      url: String(url),
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null,
    };
    calls.push(call);
    if (call.url.endsWith("/me")) {
      return new Response(JSON.stringify({ user }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (call.method === "GET" && call.url.includes("/parent_profiles/")) {
      return new Response(JSON.stringify(profileExists ? { user_id: USER_ID } : { error: "not found" }), {
        status: profileExists ? 200 : 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(savedProfile || call.body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

test("update-contact saves the authoritative profile with service access after identity verification", async (t) => {
  const databaseCalls = [];
  const ctx = accountContext(async (sql, values) => {
    databaseCalls.push({ sql, values });
    return { rows: [{ id: "enrollment-1" }, { id: "enrollment-2" }], rowCount: 2 };
  });
  const savedProfile = {
    user_id: USER_ID,
    email: "parent@example.com",
    parent_name: "Updated Parent",
    student_phone: "555-0100",
    emergency_contact: null,
    allergies: null,
    updated_at: "2026-07-31T12:00:00.000Z",
  };
  const fetchCalls = stubFetch(t, {
    user: { id: USER_ID, email: " Parent@Example.COM ", display_name: "Old Parent" },
    savedProfile,
  });

  const res = await handler(accountRequest({
    action: "update-contact",
    parent_name: " Updated Parent ",
    student_phone: "555-0100",
  }), ctx);

  assert.equal(res.status, 200);
  assert.equal(fetchCalls[0].url, "https://api.test/auth/app_test/me");
  assert.equal(fetchCalls[0].headers.Authorization, "Bearer parent-jwt");
  const profileRead = fetchCalls[1];
  const profileWrite = fetchCalls[2];
  assert.equal(profileRead.url, `https://api.test/v1/app_test/parent_profiles/${USER_ID}`);
  assert.equal(profileRead.headers.Authorization, "Bearer service-key-fixture");
  assert.equal(profileWrite.method, "PATCH");
  assert.equal(profileWrite.url, `https://api.test/v1/app_test/parent_profiles/${USER_ID}`);
  assert.equal(profileWrite.headers.Authorization, "Bearer service-key-fixture");
  const { updated_at: updatedAt, ...profileFields } = profileWrite.body;
  assert.equal(Number.isNaN(Date.parse(updatedAt)), false);
  assert.deepEqual(profileFields, {
    email: "parent@example.com",
    parent_name: "Updated Parent",
    student_phone: "555-0100",
    emergency_contact: null,
    allergies: null,
  });
  assert.equal(databaseCalls.length, 1);
  assert.doesNotMatch(databaseCalls[0].sql, /parent_profiles/i);
  assert.match(databaseCalls[0].sql, /UPDATE enrollments SET/);
  assert.deepEqual(databaseCalls[0].values, [
    USER_ID,
    "Updated Parent",
    "555-0100",
    null,
    null,
  ]);
  assert.deepEqual(await res.json(), { profile: savedProfile, updated_enrollments: 2 });
});

test("update-contact creates a missing legacy profile with server-owned identity fields", async (t) => {
  const ctx = accountContext(async () => ({ rows: [], rowCount: 0 }));
  const fetchCalls = stubFetch(t, {
    user: { id: USER_ID, email: "legacy@example.com", display_name: "Legacy Parent" },
    profileExists: false,
  });

  const res = await handler(accountRequest({
    action: "update-contact",
    user_id: "22222222-2222-4222-8222-222222222222",
    email: "attacker@example.com",
    parent_name: "Legacy Parent",
  }), ctx);

  assert.equal(res.status, 200);
  const profileCreate = fetchCalls.find((call) => call.method === "POST" && call.url.endsWith("/parent_profiles"));
  assert.ok(profileCreate);
  assert.equal(profileCreate.headers.Authorization, "Bearer service-key-fixture");
  const { updated_at: updatedAt, ...profileFields } = profileCreate.body;
  assert.equal(Number.isNaN(Date.parse(updatedAt)), false);
  assert.deepEqual(profileFields, {
    user_id: USER_ID,
    email: "legacy@example.com",
    parent_name: "Legacy Parent",
    student_phone: null,
    emergency_contact: null,
    allergies: null,
  });
});

test("update-contact ignores forged identity fields and clears empty optional values", async (t) => {
  const ctx = accountContext(async () => ({ rows: [], rowCount: 0 }));
  const fetchCalls = stubFetch(t, {
    user: { id: USER_ID, email: "verified@example.com", display_name: "Verified Parent" },
  });

  const res = await handler(accountRequest({
    action: "update-contact",
    user_id: "22222222-2222-4222-8222-222222222222",
    email: "attacker@example.com",
    parent_name: "Verified Parent",
    student_phone: "",
    emergency_contact: "   ",
    allergies: " Pollen ",
  }), ctx);

  assert.equal(res.status, 200);
  const profileWrite = fetchCalls.find((call) => call.method === "PATCH");
  assert.equal(profileWrite.body.email, "verified@example.com");
  assert.equal(Object.hasOwn(profileWrite.body, "user_id"), false);
  const { updated_at: updatedAt, ...profileFields } = profileWrite.body;
  assert.equal(Number.isNaN(Date.parse(updatedAt)), false);
  assert.deepEqual(profileFields, {
    email: "verified@example.com",
    parent_name: "Verified Parent",
    student_phone: null,
    emergency_contact: null,
    allergies: "Pollen",
  });
});

test("update-contact rejects missing, mismatched, or invalid verified identity before profile access", async (t) => {
  const cases = [
    { name: "no bearer token", authorization: null },
    { name: "mismatched user", user: { id: "22222222-2222-4222-8222-222222222222", email: "parent@example.com" } },
    { name: "invalid email", user: { id: USER_ID, email: "not-an-email" } },
    { name: "empty email", user: { id: USER_ID, email: "   " } },
  ];

  for (const scenario of cases) {
    const ctx = accountContext(async () => assert.fail("database must not be called"));
    const calls = stubFetch(t, { user: scenario.user });
    const res = await handler(accountRequest({ action: "update-contact" }, scenario.authorization), ctx);
    assert.equal(res.status, 403, scenario.name);
    assert.deepEqual(await res.json(), { error: "Could not verify identity" }, scenario.name);
    assert.equal(calls.some((call) => call.url.includes("/parent_profiles")), false, scenario.name);
  }
});

test("update-contact falls back to verified display name and then verified email", async (t) => {
  const names = [];
  const ctx = accountContext(async (_sql, values) => {
    names.push(values[1]);
    return { rows: [], rowCount: 0 };
  });
  const calls = stubFetch(t, {
    user: { id: USER_ID, email: "parent@example.com", display_name: " Legacy Parent " },
  });

  const first = await handler(accountRequest({ action: "update-contact" }), ctx);
  assert.equal(first.status, 200);
  assert.equal(calls.find((call) => call.method === "PATCH").body.parent_name, "Legacy Parent");
  assert.equal(names[0], "Legacy Parent");
});
