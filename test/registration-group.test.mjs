import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readRegistration = () => readFile(new URL("../js/registration.js", import.meta.url), "utf8");

test("registration.js loads every enrollment sharing the same stripe_order_id as one group", async () => {
  const script = await readRegistration();
  assert.match(script, /import \{ apiGet, apiGetByIds, callFunction, formatPrice, formatTime, getQueryParam, compareDayOfWeek \} from "\.\/api\.js"/);
  assert.match(script, /state\.group = en\.stripe_order_id/);
  assert.match(script, /enrollments\?stripe_order_id=eq\.\$\{en\.stripe_order_id\}&order=created_at\.asc/);
  assert.match(script, /apiGetByIds\("class_schedules", scheduleIds\)/);
});

test("registration.js shows a combined day list and totals across the group", async () => {
  const script = await readRegistration();
  assert.match(script, /state\.schedules\.map\(\(s\) => s\.day_of_week\)\.sort\(compareDayOfWeek\)\.join\(", "\)/);
  assert.match(script, /state\.group\.reduce\(\(sum, row\) => sum \+ \(row\.num_classes_enrolled \|\| 0\), 0\)/);
  assert.match(script, /state\.group\.reduce\(\(sum, row\) => sum \+ \(row\.total_paid_cents \|\| 0\), 0\)/);
});
