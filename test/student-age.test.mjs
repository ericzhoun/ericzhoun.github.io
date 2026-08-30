import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateAge, calculateStudentAge } from "../js/student-age.js";
import { handler as completeRegistration } from "../backend/functions/complete-registration.js";
import { handler as syncStudentAges } from "../backend/functions/sync-student-ages.js";

test("calculateAge accounts for whether the birthday has occurred this year", () => {
  assert.equal(calculateAge("2015-10-20", new Date("2026-10-19T12:00:00Z")), 10);
  assert.equal(calculateAge("2015-10-20", new Date("2026-10-20T12:00:00Z")), 11);
});

test("calculateAge accepts leap-day birthdays and rejects invalid dates", () => {
  assert.equal(calculateAge("2020-02-29", new Date("2025-02-28T12:00:00Z")), 4);
  assert.equal(calculateAge("2020-02-29", new Date("2025-03-01T12:00:00Z")), 5);
  assert.equal(calculateAge("2020-02-30", new Date("2026-07-16T12:00:00Z")), null);
});

test("calculateStudentAge rejects future and malformed non-ISO dates without changing checkout age calculation", () => {
  const today = new Date("2026-07-17T23:59:59Z");

  assert.equal(calculateStudentAge("2026-07-18", today), null);
  assert.equal(calculateStudentAge("2015-2-03", today), null);
  assert.equal(calculateAge("2026-07-18", today), -1);
});

test("registration saves an age derived from date of birth, not a submitted age", async () => {
  const queries = [];
  const response = await completeRegistration(new Request("https://example.test/complete-registration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enrollment_id: "enrollment-1",
      child_name: "Student Example",
      child_age: "99",
      child_dob: "2015-10-20",
      student_phone: "555-0100",
    }),
  }), {
    user: { id: "parent-1" },
    db: {
      async query(sql, values) {
        queries.push({ sql, values });
        return { rows: [{ id: "enrollment-1" }] };
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].values.includes("99"), false);
  assert.equal(queries[0].values.includes(String(calculateAge("2015-10-20"))), true);
  assert.equal(queries[0].values.includes("555-0100"), true);
});

test("daily age sync recalculates enrollment and student ages", async () => {
  const queries = [];
  const response = await syncStudentAges(new Request("https://example.test/sync-student-ages"), {
    db: {
      async query(sql) {
        queries.push(sql);
        if (/UPDATE enrollments/.test(sql)) {
          return { rows: [{ id: "enrollment-1" }, { id: "enrollment-2" }] };
        }
        if (/UPDATE students/.test(sql)) {
          return { rows: [{ id: "student-1" }, { id: "student-2" }, { id: "student-3" }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { updated: 5 });
  assert.equal(queries.length, 2);
  assert.match(queries[0], /UPDATE enrollments/);
  assert.match(queries[0], /CURRENT_TIMESTAMP AT TIME ZONE 'UTC'/);
  assert.match(queries[1], /UPDATE students/);
  assert.match(queries[1], /SET age =/);
  assert.match(queries[1], /CURRENT_TIMESTAMP AT TIME ZONE 'UTC'/);
});

test("daily age sync only calculates ages for calendar-valid ISO dates", async () => {
  const queries = [];
  await syncStudentAges(new Request("https://example.test/sync-student-ages"), {
    db: {
      async query(sql) {
        queries.push(sql);
        return { rows: [] };
      },
    },
  });

  assert.equal(queries.length, 2);
  for (const [query, column] of [[queries[0], "child_dob"], [queries[1], "dob"]]) {
    assert.match(query, new RegExp(`to_date\\(${column}, 'FXYYYY-MM-DD'\\)`));
    assert.match(query, new RegExp(`to_char\\(to_date\\(${column}, 'FXYYYY-MM-DD'\\), 'YYYY-MM-DD'\\) = ${column}`));
    assert.doesNotMatch(query, new RegExp(`${column}::date`));
  }
});

test("daily age sync anchors all refresh calculations to the UTC calendar date", async () => {
  const queries = [];
  await syncStudentAges(new Request("https://example.test/sync-student-ages"), {
    db: {
      async query(sql) {
        queries.push(sql);
        return { rows: [] };
      },
    },
  });

  for (const query of queries) {
    assert.match(query, /\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)::date/);
    assert.doesNotMatch(query, /CURRENT_DATE/);
  }
});
