import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAdmin = () => readFile(new URL("../js/admin.js", import.meta.url), "utf8");

test("dashboard shows Zenamu-style finance metrics from recorded order totals", async () => {
  const script = await readAdmin();
  assert.match(script, /Revenue to date/);
  assert.match(script, /Billed this month/);
  assert.match(script, /Pending payments/);
  assert.match(script, /e\.total_paid_cents \?\? 0/);
});

test("dashboard shows operations metrics over the session calendar", async () => {
  const script = await readAdmin();
  assert.match(script, /Upcoming sessions \(14 days\)/);
  assert.match(script, /Sessions held/);
  assert.match(script, /new Date\(session\.class_date\) >= today/);
});

test("dashboard lists low-occupancy upcoming sessions as needs attention", async () => {
  const script = await readAdmin();
  assert.match(script, /Needs attention/);
  assert.match(script, /recorded bookings/);
  assert.match(script, /row\.booked \/ row\.seats < 0\.5/);
  assert.match(script, /Nothing needs attention right now\./);
});

test("dashboard quick links surface the newer sections", async () => {
  const script = await readAdmin();
  assert.match(script, /href="#payments"/);
  assert.match(script, /href="#broadcast"/);
});
