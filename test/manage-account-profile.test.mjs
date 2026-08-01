import assert from "node:assert/strict";
import { test } from "node:test";

import { handler } from "../backend/functions/manage-account.js";

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
    user: { id: "parent-1" },
    env: {
      BUTTERBASE_API_URL: "https://api.test",
      BUTTERBASE_APP_ID: "app_test",
    },
    db: { query },
  };
}

function mockCurrentUser(t, user, onRequest = () => {}) {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options) => {
    onRequest(url, options);
    return {
      ok: true,
      json: async () => ({ user }),
    };
  };
}

test("update-contact creates a durable profile from verified auth identity", async (t) => {
  const calls = [];
  const ctx = accountContext(async (sql, values) => {
    calls.push({ sql, values });
    return {
      rows: [{
        user_id: "parent-1",
        email: "parent@example.com",
        parent_name: "Updated Parent",
        student_phone: "555-0100",
        emergency_contact: null,
        allergies: null,
        updated_at: "2026-07-31T12:00:00.000Z",
        updated_enrollments: 2,
      }],
      rowCount: 1,
    };
  });
  mockCurrentUser(t, {
    id: "parent-1",
    email: "parent@example.com",
    display_name: "Old Parent",
  });
  const req = accountRequest({
    action: "update-contact",
    parent_name: "Updated Parent",
    student_phone: "555-0100",
  });

  const res = await handler(req, ctx);

  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO parent_profiles/);
  assert.match(calls[0].sql, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(calls[0].sql, /UPDATE enrollments SET/);
  assert.deepEqual(calls[0].values, [
    "parent-1",
    "parent@example.com",
    "Updated Parent",
    "555-0100",
    null,
    null,
  ]);
  assert.deepEqual(await res.json(), {
    profile: {
      user_id: "parent-1",
      email: "parent@example.com",
      parent_name: "Updated Parent",
      student_phone: "555-0100",
      emergency_contact: null,
      allergies: null,
      updated_at: "2026-07-31T12:00:00.000Z",
    },
    updated_enrollments: 2,
  });
});

test("update-contact rejects a request without a bearer token", async () => {
  const ctx = accountContext(async () => {
    assert.fail("database must not be called before identity verification");
  });
  const req = accountRequest({
    action: "update-contact",
    parent_name: "Updated Parent",
  }, null);

  const res = await handler(req, ctx);

  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "Could not verify identity" });
});

test("update-contact rejects a verified user whose id differs from the function identity", async (t) => {
  const ctx = accountContext(async () => {
    assert.fail("database must not be called for a mismatched identity");
  });
  mockCurrentUser(t, {
    id: "different-parent",
    email: "parent@example.com",
    display_name: "Updated Parent",
  });

  const res = await handler(accountRequest({
    action: "update-contact",
    parent_name: "Updated Parent",
  }), ctx);

  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "Could not verify identity" });
});

test("update-contact ignores forged identity fields and clears empty optional fields", async (t) => {
  const calls = [];
  const ctx = accountContext(async (sql, values) => {
    calls.push({ sql, values });
    return {
      rows: [{
        user_id: "parent-1",
        email: "verified@example.com",
        parent_name: "Verified Parent",
        student_phone: null,
        emergency_contact: null,
        allergies: "Pollen",
        updated_enrollments: 0,
      }],
    };
  });
  const authRequests = [];
  mockCurrentUser(t, {
    id: "parent-1",
    email: "verified@example.com",
    display_name: "Verified Parent",
  }, (url, options) => authRequests.push({ url, options }));

  const res = await handler(accountRequest({
    action: "update-contact",
    user_id: "attacker-9",
    email: "attacker@example.com",
    parent_name: "Verified Parent",
    student_phone: "",
    emergency_contact: "   ",
    allergies: " Pollen ",
  }), ctx);

  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [
    "parent-1",
    "verified@example.com",
    "Verified Parent",
    null,
    null,
    "Pollen",
  ]);
  assert.deepEqual(authRequests, [{
    url: "https://api.test/auth/app_test/me",
    options: { headers: { Authorization: "Bearer parent-jwt" } },
  }]);
});

test("update-contact falls back to the verified display name for legacy accounts", async (t) => {
  const calls = [];
  const ctx = accountContext(async (sql, values) => {
    calls.push({ sql, values });
    return {
      rows: [{
        user_id: "parent-1",
        email: "parent@example.com",
        parent_name: "Legacy Parent",
        student_phone: null,
        emergency_contact: null,
        allergies: null,
        updated_enrollments: 1,
      }],
    };
  });
  mockCurrentUser(t, {
    id: "parent-1",
    email: "parent@example.com",
    display_name: " Legacy Parent ",
  });

  const res = await handler(accountRequest({ action: "update-contact" }), ctx);

  assert.equal(res.status, 200);
  assert.equal(calls[0].values[2], "Legacy Parent");
});

test("update-contact falls back to verified email when no parent name is available", async (t) => {
  const calls = [];
  const ctx = accountContext(async (sql, values) => {
    calls.push({ sql, values });
    return {
      rows: [{
        user_id: "parent-1",
        email: "parent@example.com",
        parent_name: "parent@example.com",
        student_phone: null,
        emergency_contact: null,
        allergies: null,
        updated_enrollments: 1,
      }],
    };
  });
  mockCurrentUser(t, {
    id: "parent-1",
    email: "parent@example.com",
    display_name: "",
  });

  const res = await handler(accountRequest({
    action: "update-contact",
    parent_name: "   ",
  }), ctx);

  assert.equal(res.status, 200);
  assert.equal(calls[0].values[2], "parent@example.com");
});
