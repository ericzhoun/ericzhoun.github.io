import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAdmin = () => readFile(new URL("../js/admin.js", import.meta.url), "utf8");

test("admin.js adds an Accounts nav entry", async () => {
  const script = await readAdmin();
  assert.match(script, /\["accounts", "Accounts"\]/);
});

test("admin.js routes the accounts section", async () => {
  const script = await readAdmin();
  assert.match(script, /id === "accounts"/);
});

test("admin.js calls admin-manage with the admin JWT via callFunction", async () => {
  const script = await readAdmin();
  assert.match(script, /callFunction\("admin-manage"/);
  assert.match(script, /getToken\(\)/);
});

test("admin.js has a create-account form calling the create-account action", async () => {
  const script = await readAdmin();
  assert.match(script, /list-accounts/);
  assert.match(script, /create-account/);
});

test("admin.js create-account error path checks error.code, not a message regex", async () => {
  const script = await readAdmin();
  assert.match(script, /error\.code === "EMAIL_EXISTS"/);
  assert.doesNotMatch(script, /EMAIL_EXISTS.*test\(error\.message\)/);
});

test("admin.js detail view wires all four parent actions", async () => {
  const script = await readAdmin();
  for (const action of ["add-student", "update-student", "create-enrollment", "set-credits"]) {
    assert.match(script, new RegExp(action));
  }
});

test("admin.js reads the parent's own students and enrollments by user_id", async () => {
  const script = await readAdmin();
  assert.match(script, /students\?user_id=eq\./);
  assert.match(script, /enrollments\?user_id=eq\./);
});

test("admin.js warns before setting credits below attended", async () => {
  const script = await readAdmin();
  assert.match(script, /below/i);
});
