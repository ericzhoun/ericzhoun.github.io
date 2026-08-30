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

test("enroll.js detects non-camp sibling schedules via a loose (time-independent) query and defaults to only the clicked day selected", async () => {
  const script = await readEnroll();
  assert.match(script, /looseBundleQuery\(state\.schedule\)/);
  assert.match(script, /if \(siblings\.length > 1\) \{/);
  assert.match(script, /state\.selectedScheduleIds = new Set\(\[scheduleId\]\)/);
  assert.match(script, /function getNumClasses\(\)/);
});

test("enroll.js marks a sibling day's time when it differs from the clicked schedule's time, or when it is the clicked schedule itself", async () => {
  const script = await readEnroll();
  assert.match(script, /function formatDayLabel\(sibling\)/);
  assert.match(script, /sibling\.id === scheduleId/);
  assert.match(script, /sibling\.start_time !== base\.start_time \|\| sibling\.end_time !== base\.end_time/);
  assert.match(script, /formatDayLabel\(sib\)/);
});

test("enroll.js prevents unchecking the only remaining selected day", async () => {
  const script = await readEnroll();
  assert.match(script, /cb\.disabled = cb\.checked && state\.selectedScheduleIds\.size === 1/);
});

test("enroll.js submits schedule_ids instead of schedule_id when multiple days are selected", async () => {
  const script = await readEnroll();
  assert.match(script, /schedule_ids: \[\.\.\.state\.selectedScheduleIds\]/);
});

test("enroll.js defaults the class count to 15 and getNumClasses always returns it directly", async () => {
  const script = await readEnroll();
  assert.match(script, /numClasses: 15,/);
  assert.match(script, /function getNumClasses\(\) \{\s*return state\.numClasses;\s*\}/);
});

test("enroll.js caps the class count at max(program.num_classes, 15) with a minimum of 10", async () => {
  const script = await readEnroll();
  assert.match(script, /const maxClasses = program \? Math\.max\(program\.num_classes \|\| 15, 15\) : 15;/);
  assert.match(script, /const minClasses = 10;/);
});

test("enroll.js sends num_classes_enrolled in both single-schedule and multi-day submissions", async () => {
  const script = await readEnroll();
  const matches = script.match(/num_classes_enrolled: state\.numClasses/g) || [];
  assert.equal(matches.length, 1); // one shared expression covering both branches
});

test("enroll.js relabels the single-match Time detail row to Class Time", async () => {
  const script = await readEnroll();
  assert.match(script, /rowTime\.appendChild\(el\("span", "detail-label", "Class Time"\)\)/);
  assert.doesNotMatch(script, /el\("span", "detail-label", "Time"\)/);
});

test("enroll.js shows Class Time day checkboxes in their own pricing row, separate from Number of Classes", async () => {
  const script = await readEnroll();
  assert.match(script, /el\("label", "", "Class Time"\)/);
  assert.match(script, /el\("label", "", "Number of Classes"\)/);
});

test("enroll.js shows the Number of Classes stepper for both single-schedule and multi-day non-camp modes", async () => {
  const script = await readEnroll();
  assert.match(script, /state\.numClasses <= minClasses \|\| isFull/);
  assert.match(script, /state\.numClasses >= maxClasses \|\| isFull/);
  assert.doesNotMatch(script, /state\.numClasses <= 1 \|\| isFull/);
});
