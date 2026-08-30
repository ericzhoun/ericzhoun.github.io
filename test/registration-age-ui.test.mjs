import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("registration labels the student and derives age from date of birth", async () => {
  const registration = await readFile(new URL("../js/registration.js", import.meta.url), "utf8");

  assert.match(registration, /"Student Name \*"/);
  assert.match(registration, /calculateAge\(state\.form\.child_dob\)/);
  assert.match(registration, /readOnly: true/);
  assert.match(registration, /makeField\("student_phone", "Phone", \{ type: "tel", value: state\.form\.student_phone \}\)/);
  assert.doesNotMatch(registration, /"Child's Name \*"/);
});
