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
