import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAdmin = () => readFile(new URL("../js/admin.js", import.meta.url), "utf8");

// The attendance sheet records per enrollment through record-session-status,
// which works with or without a pre-existing booking (comped and standalone
// enrollments often have none).
test("attendance sheet records status per enrollment via record-session-status", async () => {
  const script = await readAdmin();
  assert.match(script, /adminFn\("record-session-status", \{ enrollment_id: enrollmentId, session_id: sessionId, status \}/);
  assert.match(script, /`record:\$\{enrollmentId\}:attended`/);
  assert.match(script, /`record:\$\{enrollmentId\}:no_show`/);
});

test("attendance sheet offers an excused leave (请假) that preserves credits", async () => {
  const script = await readAdmin();
  assert.match(script, /请假 Leave/);
  assert.match(script, /`record:\$\{enrollmentId\}:skipped`/);
  assert.match(script, /keeps the student's credit/);
});

test("attendance sheet covers unbooked enrollments, not only bookings", async () => {
  const script = await readAdmin();
  assert.match(script, /Not booked/);
  assert.match(script, /field: "schedule_id", operator: "eq", value: session\.schedule_id/);
});

test("roster lists every recorded student, including those without a parent account", async () => {
  const script = await readAdmin();
  assert.match(script, /adminData\.read\("students", \{ order: \[\{ field: "created_at", direction: "desc" \}\] \}\)/);
  assert.match(script, /No account yet/);
  assert.match(script, /No parent account yet \(standalone\)/);
});

test("add-student omits user_id for standalone students and sends it for parented ones", async () => {
  const script = await readAdmin();
  assert.match(script, /\.\.\.\(data\.user_id \? \{ user_id: data\.user_id \} : \{\}\)/);
});

test("standalone student detail enrolls and edits credits without a parent", async () => {
  const script = await readAdmin();
  assert.match(script, /async function studentDetail\(/);
  assert.match(script, /field: "student_id", operator: "eq", value: student\.id/);
  assert.match(script, /adminFn\("create-enrollment", \{\s*student_id: student\.id/);
  assert.match(script, /adminFn\("set-credits", \{ enrollment_id/);
});

test("student detail links back to the parent account when one exists", async () => {
  const script = await readAdmin();
  assert.match(script, /open-parent-account/);
});
