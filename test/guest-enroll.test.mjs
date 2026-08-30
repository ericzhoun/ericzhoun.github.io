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

// The early-bird discount is date-gated, so the clock is pinned before
// EARLY_BIRD_DEADLINE. Without this the test asserts a discount that stopped
// applying on 2026-08-15 and fails on every later day.
test("guest-enroll floors an out-of-range low num_classes_enrolled to the 15 default", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-01T00:00:00Z") });
  const { ctx } = makeCtx([
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
      num_classes_enrolled: 4,
    }), ctx);

    assert.equal(response.status, 200);
    // Same early-bird interaction as the enroll-guard test above: 15 classes
    // clears the >= 15 threshold, so this is 3000 x 15 with 10% off.
    assert.equal((await response.json()).total_cents, 40500);
  } finally {
    global.fetch = originalFetch;
  }
});

// The early-bird discount is date-gated, so the clock is pinned before
// EARLY_BIRD_DEADLINE. Without this the test asserts a discount that stopped
// applying on 2026-08-15 and fails on every later day.
test("guest-enroll caps num_classes_enrolled at max(program.num_classes, 15)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-01T00:00:00Z") });
  const { ctx } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", program_name: "Ballet", program_num_classes: 20, price_cents: 3000, max_seats: 10 }] },
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
      num_classes_enrolled: 99,
    }), ctx);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).total_cents, 54000);
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

test("guest-enroll splits an explicit num_classes_enrolled evenly across selected days under one guest account", async () => {
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
      num_classes_enrolled: 12,
    }), ctx);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      enrollment_id: "enrollment-1",
      checkout_url: "https://stripe.test/checkout",
      total_cents: 36000, // 12 classes x 3000, no early-bird (12 < 15)
    });

    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts.length, 2);
    assert.equal(inserts[0].values[1], "guest-user-1");
    assert.match(inserts[0].sql, /'pending', \$6,/); // num_classes_enrolled is now a bound param, not a literal 1
    assert.equal(inserts[0].values[5], 6);
    assert.equal(inserts[1].values[5], 6);

    const updateOrder = queries.find((q) => /UPDATE enrollments SET stripe_order_id/.test(q.sql));
    assert.deepEqual(updateOrder.values, ["order-1", ["enrollment-1", "enrollment-2"]]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("guest-enroll gives the remainder of an uneven split to the lowest-id schedule(s)", async () => {
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
      num_classes_enrolled: 11,
    }), ctx);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).total_cents, 33000);

    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts[0].values[5], 6);
    assert.equal(inserts[1].values[5], 5);
    assert.equal(inserts[0].values[8] + inserts[1].values[8], 33000);
  } finally {
    global.fetch = originalFetch;
  }
});

test("guest-enroll accepts schedule_ids on different days that run at different times", async () => {
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
    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
