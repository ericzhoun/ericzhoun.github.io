import assert from "node:assert/strict";
import { test } from "node:test";
import { groupEnrollmentsByOrder } from "../js/enrollment-grouping.js";

test("groups rows sharing a stripe_order_id together, preserving first-seen order", () => {
  const rows = [
    { id: "e1", stripe_order_id: "order-1" },
    { id: "e2", stripe_order_id: "order-2" },
    { id: "e3", stripe_order_id: "order-1" },
  ];
  assert.deepEqual(groupEnrollmentsByOrder(rows), [
    [{ id: "e1", stripe_order_id: "order-1" }, { id: "e3", stripe_order_id: "order-1" }],
    [{ id: "e2", stripe_order_id: "order-2" }],
  ]);
});

test("rows without a stripe_order_id each form their own single-row group", () => {
  const rows = [
    { id: "e1", stripe_order_id: null },
    { id: "e2", stripe_order_id: null },
  ];
  assert.deepEqual(groupEnrollmentsByOrder(rows), [
    [{ id: "e1", stripe_order_id: null }],
    [{ id: "e2", stripe_order_id: null }],
  ]);
});
