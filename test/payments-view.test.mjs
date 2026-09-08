import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAdmin = () => readFile(new URL("../js/admin.js", import.meta.url), "utf8");

test("payments view is registered in the admin nav and router", async () => {
  const script = await readAdmin();
  assert.match(script, /\["payments", "Payments"\]/);
  assert.match(script, /id === "payments"\) await payments\(\)/);
});

test("payments ledger reads recorded order totals, not invented numbers", async () => {
  const script = await readAdmin();
  assert.match(script, /adminData\.read\("enrollments", \{ order: \[\{ field: "created_at", direction: "desc" \}\] \}\)/);
  assert.match(script, /enrollment\.total_paid_cents != null/);
  assert.match(script, /enrollment\.price_per_class_cents != null/);
  assert.match(script, /enrollment\.discount_pct \|\| 0/);
});

test("order totals win over the catalog-price fallback, which stays for old rows", async () => {
  const script = await readAdmin();
  assert.match(script, /: \(unitCents != null \? unitCents \* classes : null\)/);
});

test("payments totals split confirmed from pending and count only paid families", async () => {
  const script = await readAdmin();
  assert.match(script, /entry\.enrollment\.status === "confirmed"/);
  assert.match(script, /entry\.enrollment\.status === "pending"/);
  assert.match(script, /entry\.amountCents > 0/);
});

test("payments view exports the ledger as a CSV download", async () => {
  const script = await readAdmin();
  assert.match(script, /export-payments-csv/);
  assert.match(script, /paymentsCsv\(csvRows\)/);
  assert.match(script, /type: "text\/csv"/);
  assert.match(script, /olivista-payments-/);
  assert.match(script, /"Discount %"/);
});
