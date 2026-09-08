import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAdmin = () => readFile(new URL("../js/admin.js", import.meta.url), "utf8");

test("calendar view is registered as the hub section in nav and router", async () => {
  const script = await readAdmin();
  assert.match(script, /\["dashboard", "Dashboard"\], \["calendar", "Calendar"\]/);
  assert.match(script, /id === "calendar"\) await calendar\(\)/);
});

test("calendar renders a Mon-Sun week grid with week navigation", async () => {
  const script = await readAdmin();
  assert.match(script, /grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(script, /"week-prev"/);
  assert.match(script, /"week-this"/);
  assert.match(script, /"week-next"/);
  assert.match(script, /function mondayOf\(/);
});

test("calendar color codes sessions per program and shows booked seats", async () => {
  const script = await readAdmin();
  assert.match(script, /const CALENDAR_COLORS = \[/);
  assert.match(script, /colorByProgram\.set\(program\.id, CALENDAR_COLORS\[index % CALENDAR_COLORS\.length\]\)/);
  assert.match(script, /\$\{booked\}\/\$\{seats\} booked/);
});

test("calendar toggles to a list view and can hide cancelled sessions", async () => {
  const script = await readAdmin();
  assert.match(script, /"view-calendar"/);
  assert.match(script, /"view-list"/);
  assert.match(script, /id="calendar-hide-cancelled"/);
});

test("calendar cards click through to the attendance sheet", async () => {
  const script = await readAdmin();
  assert.match(script, /data-action="attendance:\$\{esc\(session\.id\)\}"/);
  assert.match(script, /attendance\(action\.slice\("attendance:"\.length\)\)/);
});

test("calendar exports the visible week as CSV", async () => {
  const script = await readAdmin();
  assert.match(script, /export-calendar-csv/);
  assert.match(script, /olivista-schedule-/);
});
