import assert from "node:assert/strict";
import { test } from "node:test";
import { handler as completeRegistration } from "../backend/functions/complete-registration.js";

function request(body) {
  return new Request("https://example.test/complete-registration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("complete-registration applies the form to every enrollment sharing the same stripe_order_id", async () => {
  const queries = [];
  const response = await completeRegistration(request({
    enrollment_id: "enrollment-1",
    child_name: "Student Example",
    child_dob: "2015-10-20",
    parent_name: "Grace Hopper",
  }), {
    user: { id: "parent-1" },
    db: {
      async query(sql, values) {
        queries.push({ sql, values });
        return { rows: [{ id: "enrollment-1" }, { id: "enrollment-2" }] };
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /WHERE user_id = \$\d+/);
  assert.match(
    queries[0].sql,
    /OR stripe_order_id = \(SELECT stripe_order_id FROM enrollments WHERE id = \$\d+ AND user_id = \$\d+\)/
  );
  assert.deepEqual(await response.json(), { id: "enrollment-1" });
});
