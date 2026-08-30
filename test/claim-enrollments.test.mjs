import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/claim-enrollments.js";

const USER = { id: "user-1", email: "wei@example.com" };

function makeCtx(queryResults) {
  const queries = [];
  let i = 0;
  return {
    ctx: {
      user: USER,
      env: { BUTTERBASE_APP_ID: "app_test", BUTTERBASE_API_URL: "https://api.test" },
      db: {
        async query(sql, values) {
          queries.push({ sql, values });
          const result = queryResults[i] ?? { rows: [] };
          i += 1;
          return result;
        },
      },
    },
    queries,
  };
}

function request() {
  return new Request("https://example.test/claim-enrollments", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt" },
  });
}

function stubMe({ email = USER.email, verified = true } = {}) {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ user: { id: USER.id, email, email_verified: verified } }),
  });
  return () => { global.fetch = original; };
}

test("claim-enrollments claims a pending parent's students and deletes the placeholder", async () => {
  const restore = stubMe();
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "enrollment-1" }] },                       // enrollment claim
    { rows: [{ id: "pending-1", parent_name: "Wei Chen", email: "wei@example.com", student_phone: "555-0100", emergency_contact: null, allergies: null }] },
    { rows: [] },                                             // profile upsert
    { rows: [{ id: "student-1" }, { id: "student-2" }] },     // repoint students
    { rows: [] },                                             // delete placeholder
  ]);

  try {
    const res = await handler(request(), ctx);
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.deepEqual(payload.claimed, ["enrollment-1"]);
    assert.deepEqual(payload.claimed_students, ["student-1", "student-2"]);

    const lookup = queries[1];
    assert.match(lookup.sql, /pending_parents/);
    assert.match(lookup.sql, /lower\(email\)/);
    assert.deepEqual(lookup.values, [USER.email]);

    const repoint = queries[3];
    assert.match(repoint.sql, /UPDATE students/);
    assert.match(repoint.sql, /pending_parent_id = NULL/);

    assert.match(queries[4].sql, /DELETE FROM pending_parents/);
  } finally {
    restore();
  }
});

test("claim-enrollments leaves everything alone when no placeholder matches", async () => {
  const restore = stubMe();
  const { ctx, queries } = makeCtx([
    { rows: [] },
    { rows: [] },
  ]);

  try {
    const res = await handler(request(), ctx);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).claimed_students, []);
    // Enrollment claim plus the placeholder lookup, and nothing further.
    assert.equal(queries.length, 2);
  } finally {
    restore();
  }
});

test("claim-enrollments refuses an unverified email", async () => {
  const restore = stubMe({ verified: false });
  const { ctx, queries } = makeCtx([]);

  try {
    const res = await handler(request(), ctx);
    assert.equal(res.status, 403);
    assert.equal(queries.length, 0);
  } finally {
    restore();
  }
});
