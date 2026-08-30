import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { ADMIN_EMAILS } from "../js/auth.js";

// backend/admin-emails.json is the single source of truth. deploy.sh injects it
// into the three functions that enforce admin access, so those carry no copy.
// The browser cannot read it at load time without making isAdmin() async, so
// js/auth.js mirrors it - and these tests keep the mirror honest.
const canonical = JSON.parse(
  readFileSync(new URL("../backend/admin-emails.json", import.meta.url), "utf8"),
);

test("the canonical allowlist is a non-empty list of addresses", () => {
  assert.ok(Array.isArray(canonical));
  assert.ok(canonical.length > 0);
  for (const entry of canonical) {
    assert.equal(typeof entry, "string");
    assert.match(entry, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    assert.equal(entry, entry.toLowerCase(), `${entry} must be lowercase`);
  }
});

test("the canonical allowlist has no duplicates", () => {
  assert.equal(new Set(canonical).size, canonical.length);
});

test("the browser allowlist mirrors the canonical one exactly", () => {
  assert.deepEqual(
    [...ADMIN_EMAILS].sort(),
    [...canonical].sort(),
    "js/auth.js ADMIN_EMAILS has drifted from backend/admin-emails.json",
  );
});

// The whole point of the consolidation: no function may reintroduce a literal.
test("no backend function hardcodes an admin address", () => {
  const functions = ["admin-manage", "manage-students", "manage-artwork"];
  for (const name of functions) {
    const source = readFileSync(
      new URL(`../backend/functions/${name}.js`, import.meta.url),
      "utf8",
    );
    for (const address of canonical) {
      assert.ok(
        !source.includes(address),
        `${name}.js hardcodes ${address}; it must read ctx.env.ADMIN_EMAILS`,
      );
    }
    assert.match(
      source,
      /ctx\.env\.ADMIN_EMAILS/,
      `${name}.js must read the injected allowlist`,
    );
  }
});

// nav.js used to keep its own copy; it must now import the shared one.
test("nav.js imports the shared allowlist rather than repeating it", () => {
  const source = readFileSync(new URL("../js/nav.js", import.meta.url), "utf8");
  assert.match(source, /import \{ ADMIN_EMAILS \} from '\.\/auth\.js'/);
  for (const address of canonical) {
    assert.ok(!source.includes(address), `nav.js still hardcodes ${address}`);
  }
});
