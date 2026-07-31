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
