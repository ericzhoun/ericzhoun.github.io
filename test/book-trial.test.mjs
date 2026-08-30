import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/book-trial.js";

function request(body) {
  return new Request("https://example.test/book-trial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx(queryResults) {
  const queries = [];
  let i = 0;
  return {
    ctx: {
      env: {
        BUTTERBASE_APP_ID: "app_test",
        SITE_URL: "https://example.test",
        BUTTERBASE_API_URL: "https://api.butterbase.ai",
      },
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

function stubFetch(responses) {
  let i = 0;
  return async () => {
    const body = responses[i];
    i += 1;
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
  };
}

const baseBody = {
  schedule_id: "sched-1",
  class_date: "2026-09-01",
  student_name: "Ada",
  student_email: "ada@example.com",
  parent_name: "Grace",
};

test("books a free trial: enrollment + booking + provisional account", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", max_seats: 10, program_name: "Art" }] },
    { rows: [{ id: "sess-1" }] },
    { rows: [{ taken: "2" }] },
    { rows: [] }, // no prior trial
    { rows: [{ id: "enroll-1" }] },
    { rows: [] }, // booking insert
  ]);
  const originalFetch = global.fetch;
  global.fetch = stubFetch([{ user: { id: "guest-1" } }]);

  try {
    const res = await handler(request(baseBody), ctx);
    assert.equal(res.status, 200);
    const insertEnroll = queries.find((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.match(insertEnroll.sql, /enrollment_type/);
    assert.match(insertEnroll.sql, /'trial'/);
    const insertBooking = queries.find((q) => /INSERT INTO bookings/.test(q.sql));
    assert.match(insertBooking.sql, /'trial'/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("409 when the dated session is full", async () => {
  const { ctx } = makeCtx([
    { rows: [{ id: "sched-1", max_seats: 10, program_name: "Art" }] },
    { rows: [{ id: "sess-1" }] },
    { rows: [{ taken: "10" }] },
  ]);
  const res = await handler(request(baseBody), ctx);
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.code, "CLASS_FULL");
});

test("409 when email already used its free trial", async () => {
  const { ctx } = makeCtx([
    { rows: [{ id: "sched-1", max_seats: 10, program_name: "Art" }] },
    { rows: [{ id: "sess-1" }] },
    { rows: [{ taken: "2" }] },
    { rows: [{ id: "prior" }] }, // existing trial
  ]);
  const res = await handler(request(baseBody), ctx);
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.code, "TRIAL_ALREADY_CLAIMED");
});

test("400 on invalid email and missing class_date", async () => {
  const { ctx } = makeCtx([]);
  const badEmail = await handler(request({ ...baseBody, student_email: "not-an-email" }), ctx);
  assert.equal(badEmail.status, 400);
  const missingDate = await handler(request({ schedule_id: "sched-1", student_name: "Ada", student_email: "a@b.com" }), ctx);
  assert.equal(missingDate.status, 400);
});

test("rejects a past class_date (session query guards on CURRENT_DATE)", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", max_seats: 10, program_name: "Art" }] },
    { rows: [] }, // no matching future session → 400
  ]);
  const res = await handler(request({ ...baseBody, class_date: "2020-01-01" }), ctx);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, "That class date is not available");
  // Guard must live in the SQL, not just the UI hiding past dates. Pinned to UTC
  // to match the rest of the codebase.
  assert.match(queries[1].sql, /CURRENT_TIMESTAMP AT TIME ZONE 'UTC'/);
});
