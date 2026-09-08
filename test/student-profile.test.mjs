import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAdmin = () => readFile(new URL("../js/admin.js", import.meta.url), "utf8");

test("student profile shows Zenamu-style stat cards", async () => {
  const script = await readAdmin();
  assert.match(script, /Total bookings/);
  assert.match(script, /Active bookings/);
  assert.match(script, /Classes attended/);
  assert.match(script, /Credits remaining/);
});

test("student profile includes a contact card fed from accounts and pending families", async () => {
  const script = await readAdmin();
  assert.match(script, /Emergency contact/);
  assert.match(script, /Allergies/);
  assert.match(script, /pendingFamily && pendingFamily\.student_phone/);
  assert.match(script, /Registered/);
});

test("student profile lists attendance history joined with session dates", async () => {
  const script = await readAdmin();
  assert.match(script, /Attendance history/);
  assert.match(script, /ATTENDANCE_LABELS\[booking\.status\]/);
  assert.match(script, /classDate: \(session && session\.class_date\) \|\| booking\.booked_at/);
});

test("student profile offers per-student deletion with an explicit confirmation", async () => {
  const script = await readAdmin();
  assert.match(script, /"delete-student"/);
  assert.match(script, /This cannot be undone/);
  assert.match(script, /adminFn\("delete-students", \{ student_ids: \[student\.id\] \}\)/);
});

test("student profile keeps an activity feed", async () => {
  const script = await readAdmin();
  assert.match(script, /Student added\./);
  assert.match(script, /Activity/);
});

test("student profile keeps the existing management actions", async () => {
  const script = await readAdmin();
  assert.match(script, /adminFn\("create-enrollment", \{/);
  assert.match(script, /adminFn\("set-credits", \{ enrollment_id/);
  assert.match(script, /adminFn\("update-student", \{ id: student\.id/);
  assert.match(script, /open-parent-account/);
});
