import assert from "node:assert/strict";
import { test } from "node:test";
import { planCampBundleSync } from "../js/api.js";

const bundleField = {
  program_id: "camp-1", semester_id: "sem-1", session_type: "full",
  start_time: "09:30", end_time: "11:30", age_group: "7-12",
  price_cents: 7000, max_seats: 6,
};
const row = (day, active, id) => ({ id: id || `row-${day}`, day_of_week: day, active, ...bundleField });

test("planCampBundleSync deactivates an active day that isn't in targetDays", () => {
  const rows = [row("Monday", true), row("Tuesday", true), row("Saturday", true)];
  const [plan] = planCampBundleSync(rows, ["Monday", "Tuesday"]);
  assert.deepEqual(plan.deactivateIds, ["row-Saturday"]);
  assert.deepEqual(plan.reactivateIds, []);
  assert.deepEqual(plan.createRows, []);
});

test("planCampBundleSync reactivates an existing inactive row instead of creating a duplicate", () => {
  const rows = [row("Monday", true), row("Friday", false)];
  const [plan] = planCampBundleSync(rows, ["Monday", "Friday"]);
  assert.deepEqual(plan.reactivateIds, ["row-Friday"]);
  assert.deepEqual(plan.createRows, []);
  assert.deepEqual(plan.deactivateIds, []);
});

test("planCampBundleSync creates a new row cloning bundle fields for a day with no existing row", () => {
  const rows = [row("Monday", true)];
  const [plan] = planCampBundleSync(rows, ["Monday", "Wednesday"]);
  assert.deepEqual(plan.deactivateIds, []);
  assert.deepEqual(plan.reactivateIds, []);
  assert.equal(plan.createRows.length, 1);
  assert.deepEqual(plan.createRows[0], { ...bundleField, day_of_week: "Wednesday", active: true });
});

test("planCampBundleSync skips a bundle group with no active rows", () => {
  const rows = [row("Monday", false), row("Tuesday", false)];
  const plans = planCampBundleSync(rows, ["Monday", "Tuesday", "Wednesday"]);
  assert.deepEqual(plans, []);
});

test("planCampBundleSync leaves a day that's already active and checked untouched", () => {
  const rows = [row("Monday", true)];
  const [plan] = planCampBundleSync(rows, ["Monday"]);
  assert.deepEqual(plan.deactivateIds, []);
  assert.deepEqual(plan.reactivateIds, []);
  assert.deepEqual(plan.createRows, []);
});

test("planCampBundleSync resyncs each bundle instance independently to the same targetDays", () => {
  const otherBundle = { ...bundleField, semester_id: "sem-2" };
  const rows = [
    row("Monday", true),
    row("Tuesday", true),
    { id: "row2-Monday", day_of_week: "Monday", active: true, ...otherBundle },
  ];
  const plans = planCampBundleSync(rows, ["Monday"]);
  assert.equal(plans.length, 2);
  const semester1Plan = plans.find((p) => p.deactivateIds.includes("row-Tuesday"));
  const semester2Plan = plans.find((p) => p !== semester1Plan);
  assert.deepEqual(semester1Plan.deactivateIds, ["row-Tuesday"]);
  assert.deepEqual(semester2Plan.deactivateIds, []);
  assert.deepEqual(semester2Plan.createRows, []);
});
