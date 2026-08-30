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

test("admin.js routes admin-manage through the guarded JWT caller", async () => {
  const script = await readAdmin();
  assert.match(script, /createAdminCaller/);
  assert.match(script, /getToken/);
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
  assert.match(script, /adminData\.read\("students", \{/);
  assert.match(script, /adminData\.read\("enrollments", \{/);
  assert.match(script, /field: "user_id", operator: "eq", value: userId/);
});

test("admin.js warns before setting credits below attended", async () => {
  const script = await readAdmin();
  assert.match(script, /below/i);
});

test("admin.js create-account success path routes into accountDetail using the returned account", async () => {
  const script = await readAdmin();
  assert.match(script, /res\.account\.user_id/);
});

test("admin.js keeps incomplete account setup visible and wires explicit recovery", async () => {
  const script = await readAdmin();
  assert.match(script, /getAccountCreationMessage\(res\)/);
  assert.match(script, /Complete setup and resend onboarding/);
  assert.match(script, /adminFn\("recover-account"/);
  assert.match(script, /accountDetail\(res\.account\.user_id, res\.account\.email, res\.account\.name, res\)/);
});

// A stored access token may still be valid. The admin caller should use it
// first, then refresh only when the authenticated request is rejected.
test("admin.js uses the guarded admin caller for admin-manage", async () => {
  const script = await readAdmin();
  assert.match(script, /refreshToken/);
  assert.match(script, /createAdminCaller/);
});

// Butterbase's CORS allowlist permits only Content-Type and Authorization (plus
// its own X-Butterbase-* headers) cross-origin, so a custom auth header makes
// the browser fail the preflight with "Failed to fetch". The admin token has to
// ride Authorization.
test("admin.js sends the admin token as a bearer token, not a custom header", async () => {
  const script = await readAdmin();
  assert.doesNotMatch(script, /X-Admin-Token/);
  assert.match(script, /createAdminCaller\(\{ getToken, refreshToken, callFunction \}\)/);
});

test("admin.js renders pending families in the accounts list", async () => {
  const script = await readAdmin();
  assert.match(script, /a\.kind === "pending"/);
  assert.match(script, /No account yet/);
});

test("admin.js routes a pending family to its own detail view", async () => {
  const script = await readAdmin();
  assert.match(script, /pending:\$\{esc\(a\.pending_parent_id\)\}/);
  assert.match(script, /action\.startsWith\("pending:"\)/);
});

test("admin.js has a create-pending-parent form that does not require an email", async () => {
  const script = await readAdmin();
  assert.match(script, /create-pending-parent/);
  assert.match(script, /<label>Email \(optional\)<input name="email" type="email"><\/label>/);
});
