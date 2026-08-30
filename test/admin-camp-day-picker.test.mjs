import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAdmin = () => readFile(new URL("../js/admin.js", import.meta.url), "utf8");

test("admin.js defines a programForm builder", async () => {
  const script = await readAdmin();
  assert.match(script, /function programForm\(/);
});

test("admin.js programForm renders a camp day-checkbox fieldset alongside the number-of-classes field", async () => {
  const script = await readAdmin();
  assert.match(script, /name="camp_days"/);
  assert.match(script, /name="num_classes"/);
});

test("admin.js wires a change listener on the program type select to toggle the two fields", async () => {
  const script = await readAdmin();
  assert.match(script, /program-type/);
  assert.match(script, /addEventListener\("change"/);
});

test("admin.js programs submit path derives num_classes from checked camp_days", async () => {
  const script = await readAdmin();
  assert.match(script, /getAll\("camp_days"\)/);
  assert.match(script, /num_classes\s*=\s*.*\.length/);
});

test("admin.js imports planCampBundleSync from api.js and uses it on program edit", async () => {
  const script = await readAdmin();
  assert.match(script, /import\s*\{[^}]*planCampBundleSync[^}]*\}\s*from\s*"\.\/api\.js"/);
  assert.match(script, /planCampBundleSync\(/);
});
