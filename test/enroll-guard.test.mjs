import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/enroll-guard.js";

function request(body) {
  return new Request("https://example.test/enroll-guard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx(queryResults, user = { id: "parent-1", email: "parent@example.com" }) {
  const queries = [];
  let i = 0;
  return {
    ctx: {
      user,
      env: { SERVICE_KEY: "sk_test", BUTTERBASE_APP_ID: "app_test", SITE_URL: "https://example.test" },
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

test("enroll-guard persists parent_name and a verified student_id", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", program_name: "Ballet", program_num_classes: 8, price_cents: 3000, max_seats: 10 }] },
    { rows: [{ held: "2" }] },
    { rows: [{ id: "student-1" }] },
    { rows: [{ id: "enrollment-1" }] },
    { rows: [] },
  ]);
  const originalFetch = global.fetch;
  global.fetch = stubFetch([
    { id: "product-1" },
    { orderId: "order-1", url: "https://stripe.test/checkout" },
  ]);

  try {
    const response = await handler(request({
      schedule_id: "sched-1",
      student_name: "Ada",
      student_phone: "555-1234",
      parent_name: "Grace Hopper",
      student_id: "student-1",
      num_classes_enrolled: 4,
    }), ctx);

    assert.equal(response.status, 200);
    const insertQuery = queries.find((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.match(insertQuery.sql, /parent_name/);
    assert.match(insertQuery.sql, /student_id/);
    assert.deepEqual(insertQuery.values.slice(-2), ["Grace Hopper", "student-1"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("enroll-guard rejects a student_id that does not belong to the caller", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", program_name: "Ballet", program_num_classes: 8, price_cents: 3000, max_seats: 10 }] },
    { rows: [{ held: "2" }] },
    { rows: [] },
  ]);

  const response = await handler(request({
    schedule_id: "sched-1",
    student_name: "Ada",
    student_id: "someone-elses-student",
  }), ctx);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Student not found" });
  assert.equal(queries.some((q) => /INSERT INTO enrollments/.test(q.sql)), false);
});
