import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readEnroll = () => readFile(new URL("../js/enroll.js", import.meta.url), "utf8");

test("enroll.js fetches camp bundle siblings for camp programs", async () => {
  const script = await readEnroll();
  assert.match(script, /campBundleQuery\(/);
  assert.match(script, /program_type === "camp"/);
  assert.match(script, /compareDayOfWeek/);
});

test("enroll.js shows the bundled day list and locks the class count for camps", async () => {
  const script = await readEnroll();
  assert.match(script, /state\.campDays\.join\(", "\)/);
  assert.match(script, /not adjustable/);
});

test("enroll.js pre-fills an editable Parent Name field from the account, not the Student Name field", async () => {
  const script = await readEnroll();
  assert.match(script, /parentName: ""/);
  assert.match(script, /state\.parentName = state\.user\.display_name \|\| state\.user\.email \|\| ""/);
  assert.match(script, /oninput = \(e\) => \(state\.parentName = e\.target\.value\)/);
  assert.doesNotMatch(script, /state\.studentName = state\.user\.display_name/);
});

test("enroll.js sends parent_name to both enroll-guard and guest-enroll", async () => {
  const script = await readEnroll();
  const matches = script.match(/parent_name: state\.parentName/g) || [];
  assert.equal(matches.length, 2);
});

test("enroll.js loads the account's students for logged-in parents", async () => {
  const script = await readEnroll();
  assert.match(script, /callFunction\("manage-students", \{ action: "list" \}, token\)/);
  assert.match(script, /state\.students = data\.students \|\| \[\]/);
});

test("enroll.js offers a student dropdown with an Other / New student fallback", async () => {
  const script = await readEnroll();
  assert.match(script, /Other \/ New student/);
  assert.match(script, /state\.studentId = null/);
  assert.match(script, /state\.students\.length > 0/);
});

test("enroll.js detects non-camp sibling schedules and defaults to only the clicked day selected", async () => {
  const script = await readEnroll();
  assert.match(script, /\} else if \(siblings\.length > 1\) \{/);
  assert.match(script, /state\.selectedScheduleIds = new Set\(\[scheduleId\]\)/);
  assert.match(script, /function getNumClasses\(\)/);
});

test("enroll.js prevents unchecking the only remaining selected day", async () => {
  const script = await readEnroll();
  assert.match(script, /cb\.disabled = cb\.checked && state\.selectedScheduleIds\.size === 1/);
});

test("enroll.js submits schedule_ids instead of schedule_id when multiple days are selected", async () => {
  const script = await readEnroll();
  assert.match(script, /schedule_ids: \[\.\.\.state\.selectedScheduleIds\]/);
});
