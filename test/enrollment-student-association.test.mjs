import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { handler } from "../backend/functions/manage-students.js";
import { calculateAge } from "../js/student-age.js";

function request(body) {
  return new Request("https://example.test/manage-students", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("a parent can associate an owned student with an existing enrollment", async () => {
  const queries = [];
  const ctx = {
    user: { id: "parent-1", email: "parent@example.com" },
    db: {
      async query(sql, values) {
        queries.push({ sql, values });
        return { rows: [{ id: "enrollment-1", student_id: "student-1" }], rowCount: 1 };
      },
    },
  };

  const response = await handler(request({
    action: "assign-enrollment",
    enrollment_id: "enrollment-1",
    student_id: "student-1",
  }), ctx);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enrollment: { id: "enrollment-1", student_id: "student-1" },
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /UPDATE enrollments SET student_id = \$1/);
  assert.match(queries[0].sql, /id = \$2 AND user_id = \$3/);
  assert.match(queries[0].sql, /EXISTS \(SELECT 1 FROM students/);
  assert.deepEqual(queries[0].values, ["student-1", "enrollment-1", "parent-1"]);
});

test("student creation derives age from date of birth instead of submitted age", async () => {
  const queries = [];
  const ctx = {
    user: { id: "parent-1", email: "parent@example.com" },
    db: {
      async query(sql, values) {
        queries.push({ sql, values });
        return { rows: [{ id: "student-1" }] };
      },
    },
  };

  const response = await handler(request({
    action: "add",
    name: "Ada",
    dob: "2015-10-20",
    age: "99",
  }), ctx);

  assert.equal(response.status, 200);
  assert.equal(queries[0].values.includes("99"), false);
  assert.equal(queries[0].values.includes(String(calculateAge("2015-10-20"))), true);
});

test("student creation rejects missing or invalid dates of birth", async () => {
  const ctx = {
    user: { id: "parent-1", email: "parent@example.com" },
    db: { async query() { throw new Error("should not query"); } },
  };

  for (const dob of [undefined, "2015-02-30", "2015-2-03", "9999-12-31"]) {
    const response = await handler(request({ action: "add", name: "Ada", dob }), ctx);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "A valid date of birth is required" });
  }
});

test("the deployed student API source is self-contained", async () => {
  const manageStudents = await readFile(
    new URL("../backend/functions/manage-students.js", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(manageStudents, /^import /m);
  assert.match(manageStudents, /function calculateStudentAge\(dob, today = new Date\(\)\)/);
});

test("student updates derive age from date of birth and reject invalid dates", async () => {
  const queries = [];
  const ctx = {
    user: { id: "parent-1", email: "parent@example.com" },
    db: {
      async query(sql, values) {
        queries.push({ sql, values });
        return { rows: [{ id: "student-1" }] };
      },
    },
  };

  const response = await handler(request({
    action: "update",
    id: "student-1",
    dob: "2015-10-20",
    age: "99",
  }), ctx);

  assert.equal(response.status, 200);
  assert.equal(queries[0].values.includes("99"), false);
  assert.equal(queries[0].values.includes(String(calculateAge("2015-10-20"))), true);

  const invalidResponse = await handler(request({
    action: "update",
    id: "student-1",
    dob: "2015-02-30",
  }), ctx);
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { error: "A valid date of birth is required" });
});

test("the enrollment card lets a parent assign it to one of their students", async () => {
  const account = await readFile(new URL("../js/account.js", import.meta.url), "utf8");

  assert.match(account, /Associate with student/);
  assert.match(account, /function renderEnrollmentStudentAssignment\(en\)/);
  assert.match(account, /action: "assign-enrollment", enrollment_id: en\.id, student_id: studentId/);
});

test("student form derives a read-only age from its date of birth", async () => {
  const account = await readFile(new URL("../js/account.js", import.meta.url), "utf8");
  assert.match(account, /import \{ calculateStudentAge \} from "\.\/student-age\.js"/);
  assert.doesNotMatch(account, /function calculateAge\(/);
  assert.match(account, /dobI\.type = "date"/);
  assert.match(account, /dobI\.max = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(account, /ageI\.readOnly = true/);
  assert.match(account, /dobI\.oninput/);
  assert.doesNotMatch(account, /action: "add", name, age, dob, notes/);
});

test("student form blocks saves with a missing or invalid date of birth", async () => {
  const account = await readFile(new URL("../js/account.js", import.meta.url), "utf8");

  assert.match(
    account,
    /if \(calculateStudentAge\(dob\) == null\) \{\s*state\.studentFormError = "A valid date of birth is required";\s*render\(\);\s*return;\s*\}/
  );
});
