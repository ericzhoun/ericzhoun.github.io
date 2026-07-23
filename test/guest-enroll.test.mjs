import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/guest-enroll.js";

function request(body) {
  return new Request("https://example.test/guest-enroll", {
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

test("guest-enroll persists parent_name onto the created enrollment", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", program_name: "Ballet", program_num_classes: 8, price_cents: 3000, max_seats: 10 }] },
    { rows: [{ held: "2" }] },
    { rows: [{ id: "enrollment-1" }] },
    { rows: [] },
  ]);
  const originalFetch = global.fetch;
  global.fetch = stubFetch([
    { user: { id: "guest-user-1" } },
    { access_token: "guest-token" },
    { id: "product-1" },
    { orderId: "order-1", url: "https://stripe.test/checkout" },
  ]);

  try {
    const response = await handler(request({
      schedule_id: "sched-1",
      student_name: "Ada",
      student_email: "ada@example.com",
      parent_name: "Grace Hopper",
    }), ctx);

    assert.equal(response.status, 200);
    const insertQuery = queries.find((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.match(insertQuery.sql, /parent_name/);
    assert.equal(insertQuery.values.at(-1), "Grace Hopper");
  } finally {
    global.fetch = originalFetch;
  }
});

test("guest-enroll rejects schedule_ids that don't share one bundle signature", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", semester_id: "sem-1", session_type: "standard", start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3000, max_seats: 10, day_of_week: "Monday" }] },
    { rows: [{ id: "sched-2", program_id: "prog-1", semester_id: "sem-1", session_type: "standard", start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3500, max_seats: 10, day_of_week: "Wednesday" }] },
  ]);

  const response = await handler(request({
    schedule_ids: ["sched-1", "sched-2"],
    student_name: "Ada",
    student_email: "ada@example.com",
  }), ctx);

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /same class bundle/);
  assert.equal(queries.length, 2);
});

test("guest-enroll creates one enrollment row per selected day under one guest account, sharing one stripe_order_id", async () => {
  const bundleRow = (id, day) => ({
    id, program_id: "prog-1", semester_id: "sem-1", session_type: "standard",
    start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3000, max_seats: 10,
    day_of_week: day, program_name: "Ballet", program_num_classes: 8,
  });
  const { ctx, queries } = makeCtx([
    { rows: [bundleRow("sched-1", "Monday")] },
    { rows: [bundleRow("sched-2", "Wednesday")] },
    { rows: [{ held: "2" }] },
    { rows: [{ held: "2" }] },
    { rows: [{ id: "enrollment-1" }] },
    { rows: [{ id: "enrollment-2" }] },
    { rows: [] },
  ]);
  const originalFetch = global.fetch;
  global.fetch = stubFetch([
    { user: { id: "guest-user-1" } },
    { access_token: "guest-token" },
    { id: "product-1" },
    { orderId: "order-1", url: "https://stripe.test/checkout" },
  ]);

  try {
    const response = await handler(request({
      schedule_ids: ["sched-1", "sched-2"],
      student_name: "Ada",
      student_email: "ada@example.com",
      parent_name: "Grace Hopper",
    }), ctx);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      enrollment_id: "enrollment-1",
      checkout_url: "https://stripe.test/checkout",
      total_cents: 6000,
    });

    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts.length, 2);
    assert.equal(inserts[0].values[1], "guest-user-1");

    const updateOrder = queries.find((q) => /UPDATE enrollments SET stripe_order_id/.test(q.sql));
    assert.deepEqual(updateOrder.values, ["order-1", ["enrollment-1", "enrollment-2"]]);
  } finally {
    global.fetch = originalFetch;
  }
});
