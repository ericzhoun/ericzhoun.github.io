import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readSignup = () => readFile(new URL("../js/signup.js", import.meta.url), "utf8");

test("signup.js reads the typed Full Name and threads it through the magic-link flow", async () => {
  const script = await readSignup();
  assert.match(script, /const name = document\.getElementById\("name"\)\.value\.trim\(\)/);
  assert.match(script, /savedName = name/);
  assert.match(script, /sendMagicLink\(email, name\)/);
  assert.match(script, /verifyMagicLink\(savedEmail, code, savedName\)/);
});

test("signup.js re-sends the saved name on resend", async () => {
  const script = await readSignup();
  assert.match(script, /sendMagicLink\(savedEmail, savedName\)/);
});
