import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAccount = () => readFile(new URL("../js/account.js", import.meta.url), "utf8");

test("password reset renders a six-box code control with paste and backspace handling", async () => {
  const script = await readAccount();

  assert.match(script, /function createPasswordCodeInputs\(\)/);
  assert.match(script, /Array\.from\(\{ length: 6 \}/);
  assert.match(script, /addEventListener\("paste"/);
  assert.match(script, /event\.key === "Backspace"/);
  assert.match(script, /readCode\(\)/);
});
