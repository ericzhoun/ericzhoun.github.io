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

test("enroll-guard rejects schedule_ids that don't share one bundle signature", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", semester_id: "sem-1", session_type: "standard", start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3000, max_seats: 10, day_of_week: "Monday" }] },
    { rows: [{ id: "sched-2", program_id: "prog-1", semester_id: "sem-1", session_type: "standard", start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3500, max_seats: 10, day_of_week: "Wednesday" }] },
  ]);

  const response = await handler(request({
    schedule_ids: ["sched-1", "sched-2"],
    student_name: "Ada",
  }), ctx);

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /same class bundle/);
  assert.equal(queries.length, 2);
});

test("enroll-guard rejects the whole multi-day request when any selected day is full", async () => {
  const bundleRow = (id, day) => ({
    id, program_id: "prog-1", semester_id: "sem-1", session_type: "standard",
    start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3000, max_seats: 10,
    day_of_week: day, program_name: "Ballet", program_num_classes: 8,
  });
  const { ctx, queries } = makeCtx([
    { rows: [bundleRow("sched-1", "Monday")] },
    { rows: [bundleRow("sched-2", "Wednesday")] },
    { rows: [{ held: "3" }] },
    { rows: [{ held: "10" }] },
  ]);

  const response = await handler(request({
    schedule_ids: ["sched-1", "sched-2"],
    student_name: "Ada",
  }), ctx);

  assert.equal(response.status, 409);
  assert.equal(queries.some((q) => /INSERT INTO enrollments/.test(q.sql)), false);
});

test("enroll-guard (multi-day) rejects a student_id that does not belong to the caller", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [] },
  ]);

  const response = await handler(request({
    schedule_ids: ["sched-1", "sched-2"],
    student_name: "Ada",
    student_id: "someone-elses-student",
  }), ctx);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Student not found" });
  assert.equal(queries.some((q) => /INSERT INTO enrollments/.test(q.sql)), false);
});

test("enroll-guard (multi-day) accepts and persists a verified student_id", async () => {
  const bundleRow = (id, day) => ({
    id, program_id: "prog-1", semester_id: "sem-1", session_type: "standard",
    start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3000, max_seats: 10,
    day_of_week: day, program_name: "Ballet", program_num_classes: 8,
  });
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "student-1" }] },
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
    { id: "product-1" },
    { orderId: "order-1", url: "https://stripe.test/checkout" },
  ]);

  try {
    const response = await handler(request({
      schedule_ids: ["sched-1", "sched-2"],
      student_name: "Ada",
      parent_name: "Grace Hopper",
      student_id: "student-1",
    }), ctx);

    assert.equal(response.status, 200);

    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts.length, 2);
    assert.match(inserts[0].sql, /student_id/);
    assert.equal(inserts[0].values.at(-1), "student-1");
    assert.equal(inserts[1].values.at(-1), "student-1");
  } finally {
    global.fetch = originalFetch;
  }
});

test("enroll-guard creates one enrollment row per selected day, all sharing one stripe_order_id", async () => {
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
    { id: "product-1" },
    { orderId: "order-1", url: "https://stripe.test/checkout" },
  ]);

  try {
    const response = await handler(request({
      schedule_ids: ["sched-1", "sched-2"],
      student_name: "Ada",
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
    assert.match(inserts[0].sql, /'pending', 1,/);
    assert.equal(inserts[0].values[5], 3000); // price_per_class_cents
    assert.equal(inserts[0].values[7], 3000); // this row's total_paid_cents share

    const updateOrder = queries.find((q) => /UPDATE enrollments SET stripe_order_id/.test(q.sql));
    assert.match(updateOrder.sql, /WHERE id = ANY\(\$2\)/);
    assert.deepEqual(updateOrder.values, ["order-1", ["enrollment-1", "enrollment-2"]]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("enroll-guard accepts schedule_ids on different days that run at different times", async () => {
  const bundleRow = (id, day, start, end) => ({
    id, program_id: "prog-1", semester_id: "sem-1", session_type: "standard",
    start_time: start, end_time: end, age_group: "7-12", price_cents: 3000, max_seats: 10,
    day_of_week: day, program_name: "Ballet", program_num_classes: 8,
  });
  const { ctx, queries } = makeCtx([
    { rows: [bundleRow("sched-1", "Monday", "16:00", "17:00")] },
    { rows: [bundleRow("sched-2", "Wednesday", "17:00", "18:00")] },
    { rows: [{ held: "2" }] },
    { rows: [{ held: "2" }] },
    { rows: [{ id: "enrollment-1" }] },
    { rows: [{ id: "enrollment-2" }] },
    { rows: [] },
  ]);
  const originalFetch = global.fetch;
  global.fetch = stubFetch([
    { id: "product-1" },
    { orderId: "order-1", url: "https://stripe.test/checkout" },
  ]);

  try {
    const response = await handler(request({
      schedule_ids: ["sched-1", "sched-2"],
      student_name: "Ada",
      parent_name: "Grace Hopper",
    }), ctx);

    assert.equal(response.status, 200);
    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
