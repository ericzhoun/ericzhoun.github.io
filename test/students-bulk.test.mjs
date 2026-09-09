import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAdmin = () => readFile(new URL("../js/admin.js", import.meta.url), "utf8");

test("roster has per-row checkboxes with select-all and a bulk action bar", async () => {
  const script = await readAdmin();
  assert.match(script, /id="roster-select-all"/);
  assert.match(script, /data-action="sel:\$\{esc\(row\.id\)\}"/);
  assert.match(script, /id="roster-bulk-bar"/);
  assert.match(script, /Delete selected/);
  assert.match(script, /Deselect all/);
});

test("roster passes the header array to table() instead of pre-rendered th cells", async () => {
  const script = await readAdmin();
  assert.match(script, /table\(headers, bodyRows\)/);
  assert.doesNotMatch(script, /<th>\$\{label\}<\/th>/);
});

test("roster delete confirms the consequences before calling delete-students", async () => {
  const script = await readAdmin();
  assert.match(script, /This cannot be undone/);
  assert.match(script, /artwork photos are permanently removed/);
  assert.match(script, /adminFn\("delete-students", \{ student_ids: ids \}\)/);
});

test("roster rows expose a three-dot menu with profile and edit actions", async () => {
  const script = await readAdmin();
  assert.match(script, /View profile/);
  assert.match(script, /data-action="edit-student:\$\{esc\(row\.id\)\}"/);
  // The row menu opens the same shared full-profile editor as the detail page.
  assert.match(script, /openStudentEditForm\(student, \{ onSaved: \(\) => students\(\) \}\)/);
  assert.match(script, /adminFn\("update-student", payload\)/);
});

test("roster supports client-side search and column sorting", async () => {
  const script = await readAdmin();
  assert.match(script, /id="roster-search"/);
  assert.match(script, /data-action="sort:\$\{column\.field\}"/);
});

test("roster exports the roster as CSV", async () => {
  const script = await readAdmin();
  assert.match(script, /export-roster-csv/);
  assert.match(script, /olivista-students-/);
});
