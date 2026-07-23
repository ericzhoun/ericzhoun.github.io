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
