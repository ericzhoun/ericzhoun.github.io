import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAdmin = () => readFile(new URL("../js/admin.js", import.meta.url), "utf8");

test("broadcast view is registered in the admin nav and router", async () => {
  const script = await readAdmin();
  assert.match(script, /\["broadcast", "Broadcast"\]/);
  assert.match(script, /id === "broadcast"\) await broadcast\(\)/);
});

test("broadcast shows client-side audience estimates, and recipients resolve server-side", async () => {
  const script = await readAdmin();
  assert.match(script, /All families \(about \$\{counts\.all\}\)/);
  assert.match(script, /estimates for the preview only/);
  assert.match(script, /adminFn\("send-broadcast", \{ \.\.\.draft/);
});

test("broadcast can send a test copy to the admin's own account", async () => {
  const script = await readAdmin();
  assert.match(script, /Send test to my account/);
  assert.match(script, /audience: "test"/);
});

test("broadcast requires an explicit review step before sending", async () => {
  const script = await readAdmin();
  assert.match(script, /Review and send/);
  assert.match(script, /Review before sending/);
  assert.match(script, /"broadcast-confirm"/);
});

test("broadcast reports per-recipient failures in the result notice", async () => {
  const script = await readAdmin();
  assert.match(script, /Sent to \$\{payload\.sent\} of \$\{payload\.total\}/);
  assert.match(script, /Failed: /);
});
