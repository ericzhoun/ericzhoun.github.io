import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAccount = () => readFile(new URL("../js/account.js", import.meta.url), "utf8");

test("account.js groups enrollments by stripe_order_id before rendering cards", async () => {
  const account = await readAccount();
  assert.match(account, /import \{ groupEnrollmentsByOrder \} from "\.\/enrollment-grouping\.js"/);
  assert.match(account, /groupEnrollmentsByOrder\(state\.enrollments\)\.forEach\(\(rows\) => \{/);
  assert.match(account, /rows\.length > 1 \? renderEnrollmentGroupCard\(rows\) : renderEnrollmentCard\(rows\[0\]\)/);
});

test("account.js has a shared card header and a reusable per-row day-detail section", async () => {
  const account = await readAccount();
  assert.match(account, /function renderEnrollmentCardHeader\(rows, program\)/);
  assert.match(account, /function renderEnrollmentDayDetail\(en\)/);
  assert.match(account, /function renderEnrollmentGroupCard\(rows\)/);
});
