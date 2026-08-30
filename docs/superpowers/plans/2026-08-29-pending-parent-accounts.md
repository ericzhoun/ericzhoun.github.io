# Pending Parent Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin create, edit, and later promote a family that has no account yet, and edit the profile of an account a parent never logged into.

**Architecture:** A new `pending_parents` table holds placeholder families; `students.pending_parent_id` links a standalone student to one. New `admin-manage` actions create, edit, and promote placeholders and edit real profiles. A single shared merge routine folds a placeholder into a real account, called both by the admin's `promote-pending-parent` and by `claim-enrollments` when the family signs up on its own with a verified email.

**Tech Stack:** Butterbase (Postgres + RLS + auth), serverless functions as single-file ES modules in `backend/functions/`, vanilla ES module frontend in `js/`, `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-08-29-pending-parent-accounts-design.md`

## Global Constraints

- **No em dashes anywhere.** Use a plain `-`. This applies to code comments, commit messages, spec text, and UI copy.
- **Run tests with `node --test 'test/*.test.mjs'`** - quote the glob. Bare `node --test test/` does not expand on Windows and reports a single bogus failure.
- **Never commit `.env` or any `bb_sk_` value.** `.env` is gitignored as of commit `ba175ac`.
- **Functions are single-file.** A helper needed by `backend/functions/X.js` must live inside that file, even if it duplicates one in another function. `calculateStudentAge` is duplicated this way on purpose; follow the pattern and note it in a comment.
- **Admin data access uses the REST data API with `SERVICE_KEY`, never `ctx.db`,** inside `admin-manage.js`. `ctx.db` binds `butterbase_user` whenever a JWT is present, which cannot see another parent's rows. `claim-enrollments.js` is the opposite - it runs as the end user and uses `ctx.db`.
- **Schema changes go through declarative `POST /schema/apply`** with the complete schema from `GET /schema` (omitted tables are treated as drops), and are recorded in `backend/schema-notes.md`.
- **Email comparison is always case-insensitive**, stored lowercase via the existing `normalizeEmail`.

---

### Task 1: Repair the time-dependent enrollment pricing tests

Four tests fail on any date after 2026-08-15. They assert a 10% early-bird total, but `EARLY_BIRD_DEADLINE` has passed, so the discount no longer applies and the real totals are the undiscounted ones. The production code is correct; the tests rot with the calendar. Fix them to control the clock so they keep covering the discount. This is pre-existing debt unrelated to the feature, done first so the suite is green before anything is added to it.

**Files:**
- Modify: `test/guest-enroll.test.mjs` (the two `num_classes_enrolled` tests)
- Modify: `test/enroll-guard.test.mjs` (the two `num_classes_enrolled` tests)

**Interfaces:**
- Consumes: nothing.
- Produces: a green baseline suite. No exported symbols.

- [ ] **Step 1: Confirm the four failures and their cause**

Run: `node --test 'test/*.test.mjs' 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `tests 242`, `pass 238`, `fail 4`. The four names all contain `num_classes_enrolled`, and each diff shows an undiscounted actual against a discounted expected (for example `60000 !== 54000`).

- [ ] **Step 2: Pin the clock inside the failing guest-enroll tests**

`node:test` mock timers can fake `Date`. Enter the test body with the clock set before the deadline so `isEarlyBird` is true and the asserted discounted totals are correct again.

Change the test signature to take the test context, and enable fake time as the first statement. In `test/guest-enroll.test.mjs`, for `guest-enroll caps num_classes_enrolled at max(program.num_classes, 15)`:

```javascript
// The early-bird discount is date-gated, so the clock is pinned before
// EARLY_BIRD_DEADLINE. Without this the test asserts a discount that stopped
// applying on 2026-08-15 and fails on every later day.
test("guest-enroll caps num_classes_enrolled at max(program.num_classes, 15)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-01T00:00:00Z") });
  const { ctx } = makeCtx([
```

Apply the same two lines to `guest-enroll floors an out-of-range low num_classes_enrolled to the 15 default`. Leave every assertion untouched.

- [ ] **Step 3: Pin the clock inside the failing enroll-guard tests**

Apply the identical change to the two matching tests in `test/enroll-guard.test.mjs`:

```javascript
test("enroll-guard caps num_classes_enrolled at max(program.num_classes, 15)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-01T00:00:00Z") });
```

and

```javascript
test("enroll-guard floors an out-of-range low num_classes_enrolled to the 15 default", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-01T00:00:00Z") });
```

- [ ] **Step 4: Run the suite and verify it is fully green**

Run: `node --test 'test/*.test.mjs' 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `tests 242`, `pass 242`, `fail 0`.

If a test now fails with a timeout, the mock clock is also freezing timers the code awaits: narrow it with `apis: ["Date"]` only, which is what the snippets above already do.

- [ ] **Step 5: Commit**

```bash
git add test/guest-enroll.test.mjs test/enroll-guard.test.mjs
git commit -m "test: pin the clock in early-bird pricing tests

The four num_classes_enrolled tests asserted a 10% early-bird total. That
discount is gated on EARLY_BIRD_DEADLINE (2026-08-15), so every run after
that date got the undiscounted total and failed. Pinning the clock before
the deadline keeps the discount covered instead of rewriting the
expectations to match a post-deadline world."
```

---

### Task 2: Add the `pending_parents` table and `students.pending_parent_id`

**Files:**
- Create: `backend/migrations/2026-08-29-pending-parents.sql` (documentation of intent, mirroring the existing migration files; the change is applied declaratively)
- Modify: `backend/schema-notes.md` (prepend a new dated section)

**Interfaces:**
- Consumes: nothing.
- Produces: table `pending_parents(id, parent_name, email, student_phone, emergency_contact, allergies, created_at, updated_at)` and column `students.pending_parent_id`. Every later task depends on these existing.

- [ ] **Step 1: Write the migration file documenting the change**

Create `backend/migrations/2026-08-29-pending-parents.sql`:

```sql
-- Migration: placeholder families ("pending parents") the admin can record and
-- edit before the family owns an account. A standalone student links to one
-- through students.pending_parent_id instead of a user_id.
--
-- Column names mirror parent_profiles so promotion is a straight field copy.
-- email is nullable because the admin often has only a name at first; it stays
-- UNIQUE, and Postgres permits many NULLs under a unique constraint.
--
-- RLS: enabled with NO end-user policies, plus a service-key bypass. These rows
-- are admin-only and must never be readable from a parent session.
--
-- ENV-GATED: applied declaratively via POST /schema/apply with the full schema
-- from GET /schema. This file records intent; it is not executed directly.

CREATE TABLE pending_parents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_name       text NOT NULL,
  email             text UNIQUE,
  student_phone     text,
  emergency_contact text,
  allergies         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE students
  ADD COLUMN pending_parent_id uuid
  REFERENCES pending_parents(id) ON DELETE SET NULL;

COMMENT ON COLUMN students.pending_parent_id IS
  'Placeholder family owning this student while user_id is NULL; cleared when the family is promoted or claims the account.';

-- Rollback:
--   ALTER TABLE students DROP COLUMN pending_parent_id;
--   DROP TABLE pending_parents;
```

- [ ] **Step 2: Fetch the current schema**

The apply endpoint is declarative and treats omitted tables as drops, so the payload must be the complete schema with the additions merged in.

```bash
set -a; . ./.env; set +a
curl -s -H "Authorization: Bearer $BUTTERBASE_API_KEY" \
  https://api.butterbase.ai/v1/app_0otd4vmczvu8/schema > /tmp/schema.json
python3 -c "import json;d=json.load(open('/tmp/schema.json'));print(sorted(d['schema']['tables']))"
```

Expected: a list of the existing tables, with no `pending_parents` in it.

- [ ] **Step 3: Apply the schema with the new table merged in**

The response body nests the schema under a `schema` key, and the request body must nest it the same way.

```bash
set -a; . ./.env; set +a
python3 - <<'PY'
import json, os, urllib.request, urllib.error

d = json.load(open("/tmp/schema.json"))
tables = d["schema"]["tables"]
tables["pending_parents"] = {
    "columns": {
        "id": {"type": "uuid", "primaryKey": True, "default": "gen_random_uuid()"},
        "parent_name": {"type": "text", "nullable": False},
        "email": {"type": "text", "unique": True},
        "student_phone": {"type": "text"},
        "emergency_contact": {"type": "text"},
        "allergies": {"type": "text"},
        "created_at": {"type": "timestamptz", "nullable": False, "default": "now()"},
        "updated_at": {"type": "timestamptz", "nullable": False, "default": "now()"},
    },
}
tables["students"]["columns"]["pending_parent_id"] = {
    "type": "uuid",
    "references": {"table": "pending_parents", "column": "id", "onDelete": "SET NULL"},
}

req = urllib.request.Request(
    "https://api.butterbase.ai/v1/app_0otd4vmczvu8/schema/apply",
    data=json.dumps({"schema": d["schema"]}).encode(),
    method="POST",
)
req.add_header("Authorization", f"Bearer {os.environ['BUTTERBASE_API_KEY']}")
req.add_header("Content-Type", "application/json")
try:
    with urllib.request.urlopen(req, timeout=60) as res:
        print(res.status, res.read().decode()[:3000])
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode()[:3000])
PY
```

Expected: `200` with `"applied"` greater than 0 and the `CREATE TABLE` / `ADD COLUMN` statements listed. If it returns `"Schema is up to date"` with `applied: 0`, the merge did not take - re-check that you edited `d["schema"]["tables"]` and posted `{"schema": ...}`.

- [ ] **Step 4: Verify the table exists and is service-writable**

```bash
set -a; . ./.env; set +a
curl -s -X POST -H "Authorization: Bearer $BUTTERBASE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"parent_name":"__probe__"}' \
  https://api.butterbase.ai/v1/app_0otd4vmczvu8/pending_parents
```

Expected: `201` with a row carrying an `id` and a null `email`. Record the id, then delete the probe:

```bash
set -a; . ./.env; set +a
curl -s -X DELETE -H "Authorization: Bearer $BUTTERBASE_API_KEY" \
  https://api.butterbase.ai/v1/app_0otd4vmczvu8/pending_parents/<probe-id>
```

Expected: `{"deleted":true}`.

- [ ] **Step 5: Confirm RLS hides the table from end users**

This cannot be covered by the stubbed unit tests, so check it now. Sign in to the live site as any parent account, open the browser console, and run:

```javascript
await (await fetch("https://api.butterbase.ai/v1/app_0otd4vmczvu8/pending_parents", {
  headers: { Authorization: `Bearer ${localStorage.getItem("bb_access_token")}` },
})).json();
```

Expected: an empty array or a permission error - never the probe row. If a row comes back, stop: the table needs RLS enabled with no end-user SELECT policy before any real family data is entered.

- [ ] **Step 6: Record the migration in schema-notes.md**

Insert directly above the `## 2026-08-29 - students nullable user_id (no-op)` section:

```markdown
## 2026-08-29 - pending parent accounts

- New `pending_parents` table: a family the admin has recorded but that owns no
  account yet. Columns mirror `parent_profiles` so promotion is a field copy.
  `email` is nullable (the admin often has only a name) and UNIQUE; Postgres
  permits many NULLs under a unique constraint, so several no-email
  placeholders coexist.
- New `students.pending_parent_id` -> `pending_parents.id` `ON DELETE SET NULL`.
  A student's owner is `user_id` xor `pending_parent_id`; neither set is still
  legal and means a bare standalone student. Deleting a placeholder degrades
  its students to bare standalone instead of deleting them.
- RLS: enabled with no end-user policies plus a service-key bypass, matching
  the posture that keeps `parent_profiles` writes behind admin actions.
  Verified by hand that a parent session reads back nothing.
```

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/2026-08-29-pending-parents.sql backend/schema-notes.md
git commit -m "feat: add pending_parents table and students.pending_parent_id

Placeholder families the admin can record before the family has an account.
email is nullable because the admin often starts with only a name."
```

---

### Task 3: `create-pending-parent` and `update-pending-parent`

**Files:**
- Modify: `backend/functions/admin-manage.js` (add two cases to the `switch` in `handler`, add two functions near `createAccount`)
- Test: `test/admin-manage.test.mjs`

**Interfaces:**
- Consumes: the `pending_parents` table from Task 2. Existing helpers in `admin-manage.js`: `data(ctx, path, options)`, `rows(result)`, `str(value)`, `normalizeEmail(value)`, `json(body, status)`, `assertOnlyKeys(body, keys)`, `requestError(message)`.
- Produces: `createPendingParent(ctx, body)`, `updatePendingParent(ctx, body)`, the `assertEmailFree(ctx, email)` helper (used by both of them, and by no later task), and the `PENDING_FIELDS` constant, which Tasks 4 and 6 both reuse. Response shape is `{ pending_parent: { id, parent_name, email, student_phone, emergency_contact, allergies } }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/admin-manage.test.mjs`. `respond` receives every stubbed fetch, so match on the URL to script each REST call in order.

```javascript
// ---- pending parents ----

test("create-pending-parent inserts a placeholder with a normalized email", async () => {
  const res = await callHandler(request({
    action: "create-pending-parent",
    parent_name: "Wei Chen",
    email: "  Wei.Chen@Example.COM ",
    student_phone: "555-0100",
  }), {
    respond: (url) => {
      if (url.includes("parent_profiles")) return { body: [] };
      if (url.includes("pending_parents")) return { body: [{ id: "pending-1", parent_name: "Wei Chen", email: "wei.chen@example.com" }] };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  assert.equal((await res.json()).pending_parent.id, "pending-1");
  const insert = dataCalls(res).find((call) => call.method === "POST" && call.url.includes("pending_parents"));
  assert.equal(insert.body.email, "wei.chen@example.com");
  assert.equal(insert.body.parent_name, "Wei Chen");
});

test("create-pending-parent accepts a placeholder with no email at all", async () => {
  const res = await callHandler(request({
    action: "create-pending-parent",
    parent_name: "Name Only",
  }), {
    respond: (url) => url.includes("pending_parents")
      ? { body: [{ id: "pending-2", parent_name: "Name Only", email: null }] }
      : { body: [] },
  });

  assert.equal(res.status, 200);
  const insert = dataCalls(res).find((call) => call.method === "POST");
  assert.equal(insert.body.email, undefined);
  // A name-only placeholder must not trigger the shadowing lookup.
  assert.equal(dataCalls(res).some((call) => call.url.includes("parent_profiles")), false);
});

test("create-pending-parent requires a parent name", async () => {
  const res = await callHandler(request({ action: "create-pending-parent", email: "a@example.com" }));
  assert.equal(res.status, 400);
});

test("create-pending-parent refuses an email that already has a real account", async () => {
  const res = await callHandler(request({
    action: "create-pending-parent",
    parent_name: "Duplicate",
    email: "taken@example.com",
  }), {
    respond: (url) => url.includes("parent_profiles")
      ? { body: [{ user_id: "user-9", email: "taken@example.com", parent_name: "Real Parent" }] }
      : { body: [] },
  });

  assert.equal(res.status, 409);
  const payload = await res.json();
  assert.equal(payload.code, "ACCOUNT_EXISTS");
  assert.equal(payload.user_id, "user-9");
  assert.equal(dataCalls(res).some((call) => call.method === "POST" && call.url.includes("pending_parents")), false);
});

test("update-pending-parent patches the requested fields", async () => {
  const res = await callHandler(request({
    action: "update-pending-parent",
    id: "pending-1",
    parent_name: "Wei Chen",
    student_phone: "555-0199",
  }), {
    respond: (url) => url.includes("pending_parents")
      ? { body: [{ id: "pending-1", parent_name: "Wei Chen", student_phone: "555-0199" }] }
      : { body: [] },
  });

  assert.equal(res.status, 200);
  const patch = dataCalls(res).find((call) => call.method === "PATCH");
  assert.ok(patch.url.includes("pending_parents/pending-1"));
  assert.equal(patch.body.student_phone, "555-0199");
  assert.ok(patch.body.updated_at);
});

test("update-pending-parent refuses an email that already has a real account", async () => {
  const res = await callHandler(request({
    action: "update-pending-parent",
    id: "pending-1",
    email: "taken@example.com",
  }), {
    respond: (url) => url.includes("parent_profiles")
      ? { body: [{ user_id: "user-9", email: "taken@example.com" }] }
      : { body: [] },
  });

  assert.equal(res.status, 409);
  assert.equal(dataCalls(res).some((call) => call.method === "PATCH"), false);
});

test("update-pending-parent requires an id", async () => {
  const res = await callHandler(request({ action: "update-pending-parent", parent_name: "No Id" }));
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/admin-manage.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: 7 failures, each returning `400` from the `Unknown action` default branch rather than the asserted status.

- [ ] **Step 3: Implement the two actions**

Add the cases to the `switch` in `handler`, immediately after `case "create-account":`:

```javascript
      case "create-pending-parent":
        return await createPendingParent(ctx, body);
      case "update-pending-parent":
        return await updatePendingParent(ctx, body);
```

Add the implementation below `createAccount`:

```javascript
// A placeholder family: recorded and editable before the family owns an
// account. Only parent_name is required - the admin often starts with a name
// from a walk-in and learns the email later. Students attach through
// students.pending_parent_id while their user_id stays NULL.
const PENDING_FIELDS = ["parent_name", "student_phone", "emergency_contact", "allergies"];

// A placeholder must never shadow a real account, or promoting it would
// collide on the auth email and the admin would be editing a record the
// parent cannot see. Skipped entirely when no email is being set.
async function assertEmailFree(ctx, email) {
  if (!email) return null;
  const existing = rows(await data(
    ctx,
    `parent_profiles?email=eq.${encodeURIComponent(email)}&select=user_id,parent_name`,
  ))[0];
  if (!existing) return null;
  return json({
    error: "An account already exists for this email.",
    code: "ACCOUNT_EXISTS",
    user_id: existing.user_id,
    parent_name: str(existing.parent_name),
  }, 409);
}

async function createPendingParent(ctx, body) {
  assertOnlyKeys(body, ["action", "email", ...PENDING_FIELDS]);
  const parentName = str(body.parent_name);
  if (!parentName) return json({ error: "Parent name is required" }, 400);
  if (parentName.length > 200) return json({ error: "Parent name is too long" }, 400);

  const email = normalizeEmail(body.email);
  if (body.email && !email) return json({ error: "A valid email is required" }, 400);
  const conflict = await assertEmailFree(ctx, email);
  if (conflict) return conflict;

  const fields = {};
  for (const key of PENDING_FIELDS) {
    const value = str(body[key]);
    if (value !== null) fields[key] = value;
  }
  if (email) fields.email = email;

  const created = await data(ctx, "pending_parents", { method: "POST", body: fields });
  return json({ pending_parent: rows(created)[0] || null }, 200);
}

async function updatePendingParent(ctx, body) {
  assertOnlyKeys(body, ["action", "id", "email", ...PENDING_FIELDS]);
  const id = str(body.id);
  if (!id) return json({ error: "Pending parent id is required" }, 400);

  const fields = {};
  for (const key of PENDING_FIELDS) {
    if (body[key] !== undefined) fields[key] = str(body[key]);
  }
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (body.email && !email) return json({ error: "A valid email is required" }, 400);
    const conflict = await assertEmailFree(ctx, email);
    if (conflict) return conflict;
    fields.email = email;
  }
  // The column defaults to now() only on insert, so the timestamp is explicit.
  fields.updated_at = new Date().toISOString();

  const updated = await data(ctx, `pending_parents/${encodeURIComponent(id)}`, { method: "PATCH", body: fields });
  const pendingParent = rows(updated)[0];
  if (!pendingParent) return json({ error: "Pending parent not found" }, 404);
  return json({ pending_parent: pendingParent }, 200);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/admin-manage.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `fail 0`, with 7 more passing tests than the baseline.

- [ ] **Step 5: Commit**

```bash
git add backend/functions/admin-manage.js test/admin-manage.test.mjs
git commit -m "feat: create and edit pending parent placeholders

Only parent_name is required, since the admin often has just a name at
first. An email already held by a real account is refused so a placeholder
can never shadow an account the parent can actually see."
```

---

### Task 4: `update-account` for real profiles

**Files:**
- Modify: `backend/functions/admin-manage.js`
- Test: `test/admin-manage.test.mjs`

**Interfaces:**
- Consumes: `data`, `rows`, `str`, `json`, `assertOnlyKeys` from `admin-manage.js`.
- Produces: `updateAccount(ctx, body)`, responding `{ account: { user_id, parent_name, ... } }`.

- [ ] **Step 1: Write the failing tests**

```javascript
test("update-account patches the parent profile", async () => {
  const res = await callHandler(request({
    action: "update-account",
    user_id: "user-1",
    parent_name: "Corrected Name",
    student_phone: "555-0123",
  }), {
    respond: (url) => url.includes("parent_profiles")
      ? { body: [{ user_id: "user-1", parent_name: "Corrected Name", student_phone: "555-0123" }] }
      : { body: [] },
  });

  assert.equal(res.status, 200);
  assert.equal((await res.json()).account.parent_name, "Corrected Name");
  const patch = dataCalls(res).find((call) => call.method === "PATCH");
  assert.ok(patch.url.includes("parent_profiles/user-1"));
  assert.equal(patch.body.parent_name, "Corrected Name");
});

// resend-invitation deliberately trusts the stored profile so an admin browser
// cannot redirect account messages. Letting the email be patched here would
// reopen exactly that hole and desync the profile from the auth identity.
test("update-account never writes the email even when one is supplied", async () => {
  const res = await callHandler(request({
    action: "update-account",
    user_id: "user-1",
    parent_name: "Corrected Name",
    email: "attacker@example.com",
  }), {
    respond: (url) => url.includes("parent_profiles")
      ? { body: [{ user_id: "user-1", parent_name: "Corrected Name" }] }
      : { body: [] },
  });

  assert.equal(res.status, 400);
  assert.equal(dataCalls(res).some((call) => call.method === "PATCH"), false);
});

test("update-account requires a user id", async () => {
  const res = await callHandler(request({ action: "update-account", parent_name: "No Id" }));
  assert.equal(res.status, 400);
});

test("update-account reports a profile that does not exist", async () => {
  const res = await callHandler(request({
    action: "update-account",
    user_id: "missing",
    parent_name: "Ghost",
  }), { respond: () => ({ body: [] }) });

  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/admin-manage.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: 4 failures returning `400` from `Unknown action` (note the third test also expects `400`, so confirm it fails on the message, not just the status - it will pass trivially at this stage and that is acceptable).

- [ ] **Step 3: Implement the action**

Add to the `switch`, after `case "update-pending-parent":`:

```javascript
      case "update-account":
        return await updateAccount(ctx, body);
```

Implement below `updatePendingParent`. `assertOnlyKeys` throws a 400 for an unexpected `email` key, which is exactly the desired refusal - it is stated explicitly here rather than silently dropped, so a mistaken caller learns why.

```javascript
// Edits a real account's profile. Email is deliberately absent from the
// allowed keys: resend-invitation treats the stored profile as authoritative
// so an admin browser cannot redirect account messages, and patching the
// profile email alone would desync it from the auth identity. A wrong email
// is fixed by creating a new account, not by editing this one.
async function updateAccount(ctx, body) {
  assertOnlyKeys(body, ["action", "user_id", ...PENDING_FIELDS]);
  const userId = str(body.user_id);
  if (!userId) return json({ error: "Parent account id is required" }, 400);

  const fields = {};
  for (const key of PENDING_FIELDS) {
    if (body[key] !== undefined) fields[key] = str(body[key]);
  }
  fields.updated_at = new Date().toISOString();

  const updated = await data(ctx, `parent_profiles/${encodeURIComponent(userId)}`, { method: "PATCH", body: fields });
  const account = rows(updated)[0];
  if (!account) return json({ error: "Parent profile not found" }, 404);
  return json({ account }, 200);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/admin-manage.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/functions/admin-manage.js test/admin-manage.test.mjs
git commit -m "feat: let the admin edit a real parent profile

Covers accounts created by the admin that the parent never logged into.
Email stays uneditable so the profile cannot desync from the auth identity
or redirect the invitation."
```

---

### Task 5: Attach students and enrollments to a placeholder

**Files:**
- Modify: `backend/functions/admin-manage.js` (`addStudent` around line 789, `createEnrollment` around line 829)
- Test: `test/admin-manage.test.mjs`

**Interfaces:**
- Consumes: `pending_parents` and `students.pending_parent_id` from Task 2.
- Produces: `add-student` and `create-enrollment` both accept `pending_parent_id`. No new exported symbols.

- [ ] **Step 1: Write the failing tests**

```javascript
test("add-student attaches a student to a pending parent", async () => {
  const res = await callHandler(request({
    action: "add-student",
    pending_parent_id: "pending-1",
    name: "Ada",
    dob: "2016-05-04",
  }), {
    respond: (url) => url.includes("students")
      ? { body: [{ id: "student-1", pending_parent_id: "pending-1", name: "Ada" }] }
      : { body: [] },
  });

  assert.equal(res.status, 200);
  const insert = dataCalls(res).find((call) => call.method === "POST" && call.url.includes("students"));
  assert.equal(insert.body.pending_parent_id, "pending-1");
  assert.equal(insert.body.user_id, undefined);
});

test("add-student refuses both a user id and a pending parent id", async () => {
  const res = await callHandler(request({
    action: "add-student",
    user_id: "user-1",
    pending_parent_id: "pending-1",
    name: "Ada",
    dob: "2016-05-04",
  }));

  assert.equal(res.status, 400);
});

test("create-enrollment uses the pending parent's email for the enrollment row", async () => {
  const res = await callHandler(request({
    action: "create-enrollment",
    pending_parent_id: "pending-1",
    student_id: "student-1",
    schedule_id: "sched-1",
    num_classes_enrolled: 4,
  }), {
    respond: (url) => {
      if (url.includes("class_schedules")) return { body: [{ price_cents: 3000 }] };
      if (url.includes("pending_parents")) return { body: [{ id: "pending-1", parent_name: "Wei Chen", email: "wei@example.com", student_phone: "555-0100" }] };
      if (url.includes("students")) return { body: [{ name: "Ada" }] };
      if (url.includes("enrollments")) return { body: [{ id: "enrollment-1" }] };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  const insert = dataCalls(res).find((call) => call.method === "POST" && call.url.includes("enrollments"));
  assert.equal(insert.body.student_email, "wei@example.com");
  assert.equal(insert.body.parent_name, "Wei Chen");
  assert.equal(insert.body.user_id, undefined);
});

// enrollments.student_email is NOT NULL, so a name-only placeholder cannot
// back an enrollment until an email exists somewhere.
test("create-enrollment refuses a pending parent with no email available", async () => {
  const res = await callHandler(request({
    action: "create-enrollment",
    pending_parent_id: "pending-2",
    student_id: "student-2",
    schedule_id: "sched-1",
    num_classes_enrolled: 4,
  }), {
    respond: (url) => {
      if (url.includes("class_schedules")) return { body: [{ price_cents: 3000 }] };
      if (url.includes("pending_parents")) return { body: [{ id: "pending-2", parent_name: "Name Only", email: null }] };
      if (url.includes("students")) return { body: [{ name: "Bo" }] };
      return { body: [] };
    },
  });

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /email/i);
  assert.equal(dataCalls(res).some((call) => call.method === "POST" && call.url.includes("enrollments")), false);
});

test("create-enrollment writes a supplied email back to the pending parent", async () => {
  const res = await callHandler(request({
    action: "create-enrollment",
    pending_parent_id: "pending-2",
    student_id: "student-2",
    schedule_id: "sched-1",
    num_classes_enrolled: 4,
    student_email: "late@example.com",
  }), {
    respond: (url) => {
      if (url.includes("class_schedules")) return { body: [{ price_cents: 3000 }] };
      if (url.includes("pending_parents")) return { body: [{ id: "pending-2", parent_name: "Name Only", email: null }] };
      if (url.includes("students")) return { body: [{ name: "Bo" }] };
      if (url.includes("enrollments")) return { body: [{ id: "enrollment-2" }] };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  const patch = dataCalls(res).find((call) => call.method === "PATCH" && call.url.includes("pending_parents"));
  assert.equal(patch.body.email, "late@example.com");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/admin-manage.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: 5 failures. The `add-student` cases fail because `pending_parent_id` is not in the insert; the `create-enrollment` cases fail on a missing `pending_parents` lookup.

- [ ] **Step 3: Update `addStudent`**

Replace the body of `addStudent` up to the insert:

```javascript
async function addStudent(ctx, body) {
  const userId = str(body.user_id);
  const pendingParentId = str(body.pending_parent_id);
  const name = str(body.name);
  const dob = str(body.dob);
  // The owner is user_id xor pending_parent_id. Both set would make the
  // student visible to a real parent while still claimable by a placeholder
  // merge, so it is rejected rather than resolved by precedence.
  if (userId && pendingParentId) {
    return json({ error: "A student belongs to either an account or a pending parent, not both" }, 400);
  }
  if (!name) return json({ error: "Student name is required" }, 400);
  const age = calculateStudentAge(dob);
  if (age == null) return json({ error: "A valid date of birth is required" }, 400);

  const fields = { name, age: String(age), dob, notes: str(body.notes) };
  if (userId) fields.user_id = userId;
  if (pendingParentId) fields.pending_parent_id = pendingParentId;

  const created = await data(ctx, "students", { method: "POST", body: fields });
  return json({ student: rows(created)[0] || null }, 200);
}
```

- [ ] **Step 4: Update `createEnrollment`**

After the existing schedule lookup and before the student lookup, resolve the placeholder and the email. Insert this block, and reject the both-set case at the top of the function alongside the existing validation:

```javascript
  const pendingParentId = str(body.pending_parent_id);
  if (userId && pendingParentId) {
    return json({ error: "An enrollment belongs to either an account or a pending parent, not both" }, 400);
  }
```

Then, after `const priceCents = schedules[0].price_cents;`:

```javascript
  // enrollments.student_email is NOT NULL, so a placeholder with no email on
  // file cannot back an enrollment. An email supplied here is written back to
  // the placeholder, so the family only has to be asked once.
  let pendingParent = null;
  if (pendingParentId) {
    pendingParent = rows(await data(
      ctx,
      `pending_parents?id=eq.${encodeURIComponent(pendingParentId)}&select=id,parent_name,email,student_phone`,
    ))[0] || null;
    if (!pendingParent) return json({ error: "Pending parent not found" }, 404);
  }
  const suppliedEmail = normalizeEmail(body.student_email);
  const enrollmentEmail = suppliedEmail || (pendingParent && str(pendingParent.email)) || str(body.student_email);
  if (pendingParentId && !enrollmentEmail) {
    return json({ error: "An email is required to enroll a pending parent's student" }, 400);
  }
```

Then change the denormalized fields in `enrollmentFields` to prefer the placeholder, and add the write-back plus the link after the insert:

```javascript
    student_email: enrollmentEmail,
    student_phone: str(body.student_phone) || (pendingParent && str(pendingParent.student_phone)) || null,
    parent_name: str(body.parent_name) || (pendingParent && str(pendingParent.parent_name)) || null,
```

and after `const created = await data(ctx, "enrollments", { method: "POST", body: enrollmentFields });`:

```javascript
  if (pendingParent && suppliedEmail && !pendingParent.email) {
    await data(ctx, `pending_parents/${encodeURIComponent(pendingParentId)}`, {
      method: "PATCH",
      body: { email: suppliedEmail, updated_at: new Date().toISOString() },
    });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/admin-manage.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add backend/functions/admin-manage.js test/admin-manage.test.mjs
git commit -m "feat: attach students and enrollments to a pending parent

An enrollment needs an email because enrollments.student_email is NOT NULL,
so a name-only placeholder holds students but cannot be enrolled until an
email is supplied - which is then written back to the placeholder."
```

---

### Task 6: The shared merge routine and `promote-pending-parent`

**Files:**
- Modify: `backend/functions/admin-manage.js`
- Test: `test/admin-manage.test.mjs`

**Interfaces:**
- Consumes: `createAccount(ctx, body)` (existing, returns a `Response`), `data`, `rows`, `str`, `json`.
- Produces: `mergePendingParent(ctx, { pendingParent, userId })` returning `{ students_claimed: number }`, and `promotePendingParent(ctx, body)`. Task 7 reimplements the same three steps against `ctx.db` in `claim-enrollments.js`, so keep the ordering and the non-clobbering rule identical.

- [ ] **Step 1: Write the failing tests**

```javascript
test("promote-pending-parent creates the account, repoints students, and deletes the placeholder", async () => {
  const res = await callHandler(request({
    action: "promote-pending-parent",
    id: "pending-1",
  }), {
    respond: (url, call) => {
      if (url.includes("pending_parents") && call.method === "GET") {
        return { body: [{ id: "pending-1", parent_name: "Wei Chen", email: "wei@example.com", student_phone: "555-0100" }] };
      }
      if (url.includes("/signup")) return { body: { user: { id: "user-new" } } };
      if (url.includes("parent_profiles")) return { body: [] };
      if (url.includes("students")) return { body: [{ id: "student-1" }, { id: "student-2" }] };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.account.user_id, "user-new");
  assert.equal(payload.students_claimed, 2);

  const calls = dataCalls(res);
  const repoint = calls.find((call) => call.method === "PATCH" && call.url.includes("students"));
  assert.ok(repoint.url.includes("pending_parent_id=eq.pending-1"));
  assert.equal(repoint.body.user_id, "user-new");
  assert.equal(repoint.body.pending_parent_id, null);
  assert.ok(calls.some((call) => call.method === "DELETE" && call.url.includes("pending_parents/pending-1")));
});

test("promote-pending-parent refuses a placeholder with no email", async () => {
  const res = await callHandler(request({
    action: "promote-pending-parent",
    id: "pending-2",
  }), {
    respond: (url) => url.includes("pending_parents")
      ? { body: [{ id: "pending-2", parent_name: "Name Only", email: null }] }
      : { body: [] },
  });

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /email/i);
  assert.equal(res.calls.some((call) => call.url.includes("/signup")), false);
});

test("promote-pending-parent keeps the placeholder when account creation fails", async () => {
  const res = await callHandler(request({
    action: "promote-pending-parent",
    id: "pending-1",
  }), {
    respond: (url, call) => {
      if (url.includes("pending_parents") && call.method === "GET") {
        return { body: [{ id: "pending-1", parent_name: "Wei Chen", email: "wei@example.com" }] };
      }
      if (url.includes("/signup")) return { ok: false, status: 409, body: { error: "already exists" } };
      return { body: [] };
    },
  });

  assert.equal(res.status, 409);
  assert.equal(dataCalls(res).some((call) => call.method === "DELETE"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/admin-manage.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: 3 failures from the `Unknown action` branch.

- [ ] **Step 3: Implement the merge and the action**

Add to the `switch`, after `case "update-account":`:

```javascript
      case "promote-pending-parent":
        return await promotePendingParent(ctx, body);
```

Implement below `updateAccount`:

```javascript
// Folds a placeholder into a real account. claim-enrollments performs the same
// three steps against ctx.db when the family signs up on its own; keep the two
// in step. Profile fields are filled only where the parent has not already set
// one, so a profile the parent has since edited is never clobbered by stale
// placeholder data.
async function mergePendingParent(ctx, { pendingParent, userId }) {
  const existing = rows(await data(
    ctx,
    `parent_profiles?user_id=eq.${encodeURIComponent(userId)}&select=user_id,parent_name,student_phone,emergency_contact,allergies`,
  ))[0];

  const filled = {};
  for (const key of PENDING_FIELDS) {
    const candidate = str(pendingParent[key]);
    if (candidate && !(existing && str(existing[key]))) filled[key] = candidate;
  }

  if (existing) {
    if (Object.keys(filled).length > 0) {
      filled.updated_at = new Date().toISOString();
      await data(ctx, `parent_profiles/${encodeURIComponent(userId)}`, { method: "PATCH", body: filled });
    }
  } else {
    await data(ctx, "parent_profiles", {
      method: "POST",
      body: {
        user_id: userId,
        email: str(pendingParent.email),
        parent_name: str(pendingParent.parent_name) || str(pendingParent.email),
        ...filled,
      },
    });
  }

  const repointed = await data(
    ctx,
    `students?pending_parent_id=eq.${encodeURIComponent(pendingParent.id)}`,
    { method: "PATCH", body: { user_id: userId, pending_parent_id: null } },
  );

  await data(ctx, `pending_parents/${encodeURIComponent(pendingParent.id)}`, { method: "DELETE" });

  return { students_claimed: rows(repointed).length };
}

// The admin has the family's email at last: create the real account (which
// also sends the invitation) and fold the placeholder into it.
async function promotePendingParent(ctx, body) {
  assertOnlyKeys(body, ["action", "id"]);
  const id = str(body.id);
  if (!id) return json({ error: "Pending parent id is required" }, 400);

  const pendingParent = rows(await data(
    ctx,
    `pending_parents?id=eq.${encodeURIComponent(id)}&select=id,parent_name,email,student_phone,emergency_contact,allergies`,
  ))[0];
  if (!pendingParent) return json({ error: "Pending parent not found" }, 404);
  if (!str(pendingParent.email)) {
    return json({ error: "An email is required before this family can be promoted to an account" }, 400);
  }

  // createAccount owns signup, the welcome email, and the recovery bookkeeping.
  // Its failures are returned untouched so the placeholder survives and the
  // admin can retry.
  const accountRes = await createAccount(ctx, {
    email: str(pendingParent.email),
    display_name: str(pendingParent.parent_name),
  });
  if (accountRes.status !== 200) return accountRes;
  const accountPayload = await accountRes.json();
  const userId = accountPayload.account && accountPayload.account.user_id;
  if (!userId) return json({ error: "Could not create the account. The family was left unchanged." }, 502);

  const { students_claimed } = await mergePendingParent(ctx, { pendingParent, userId });
  return json({ ...accountPayload, students_claimed }, 200);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/admin-manage.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/functions/admin-manage.js test/admin-manage.test.mjs
git commit -m "feat: promote a pending parent to a real account

Reuses createAccount for signup and the invitation, then repoints the
family's students and deletes the placeholder. A failed signup leaves the
placeholder untouched so the admin can retry."
```

---

### Task 7: Claim a placeholder on verified login

**Files:**
- Modify: `backend/functions/claim-enrollments.js`
- Create: `test/claim-enrollments.test.mjs`

**Interfaces:**
- Consumes: `pending_parents` and `students.pending_parent_id` from Task 2.
- Produces: the response gains `claimed_students: string[]` alongside the existing `claimed: string[]`.

This function runs as the end user against `ctx.db`, not the service key, so the merge is written as SQL here rather than reusing Task 6's REST helper. Keep the three steps and the non-clobbering rule identical to `mergePendingParent`.

- [ ] **Step 1: Write the failing tests**

Create `test/claim-enrollments.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/claim-enrollments.js";

const USER = { id: "user-1", email: "wei@example.com" };

function makeCtx(queryResults) {
  const queries = [];
  let i = 0;
  return {
    ctx: {
      user: USER,
      env: { BUTTERBASE_APP_ID: "app_test", BUTTERBASE_API_URL: "https://api.test" },
      db: {
        async query(sql, values) {
          queries.push({ sql, values });
          const result = queryResults[i] ?? { rows: [] };
          i += 1;
          return result;
        },
      },
    },
    queries,
  };
}

function request() {
  return new Request("https://example.test/claim-enrollments", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt" },
  });
}

function stubMe({ email = USER.email, verified = true } = {}) {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ user: { id: USER.id, email, email_verified: verified } }),
  });
  return () => { global.fetch = original; };
}

test("claim-enrollments claims a pending parent's students and deletes the placeholder", async () => {
  const restore = stubMe();
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "enrollment-1" }] },                       // enrollment claim
    { rows: [{ id: "pending-1", parent_name: "Wei Chen", email: "wei@example.com", student_phone: "555-0100", emergency_contact: null, allergies: null }] },
    { rows: [] },                                             // profile upsert
    { rows: [{ id: "student-1" }, { id: "student-2" }] },     // repoint students
    { rows: [] },                                             // delete placeholder
  ]);

  try {
    const res = await handler(request(), ctx);
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.deepEqual(payload.claimed, ["enrollment-1"]);
    assert.deepEqual(payload.claimed_students, ["student-1", "student-2"]);

    const lookup = queries[1];
    assert.match(lookup.sql, /pending_parents/);
    assert.match(lookup.sql, /lower\(email\)/);
    assert.deepEqual(lookup.values, [USER.email]);

    const repoint = queries[3];
    assert.match(repoint.sql, /UPDATE students/);
    assert.match(repoint.sql, /pending_parent_id = NULL/);

    assert.match(queries[4].sql, /DELETE FROM pending_parents/);
  } finally {
    restore();
  }
});

test("claim-enrollments leaves everything alone when no placeholder matches", async () => {
  const restore = stubMe();
  const { ctx, queries } = makeCtx([
    { rows: [] },
    { rows: [] },
  ]);

  try {
    const res = await handler(request(), ctx);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).claimed_students, []);
    // Enrollment claim plus the placeholder lookup, and nothing further.
    assert.equal(queries.length, 2);
  } finally {
    restore();
  }
});

test("claim-enrollments refuses an unverified email", async () => {
  const restore = stubMe({ verified: false });
  const { ctx, queries } = makeCtx([]);

  try {
    const res = await handler(request(), ctx);
    assert.equal(res.status, 403);
    assert.equal(queries.length, 0);
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/claim-enrollments.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: the first two fail (`claimed_students` is undefined and only one query runs); the third already passes, since the verification guard exists.

- [ ] **Step 3: Implement the placeholder claim**

In `backend/functions/claim-enrollments.js`, replace the single `UPDATE` and the return with:

```javascript
  const res = await ctx.db.query(
    `UPDATE enrollments SET user_id = $1
     WHERE lower(student_email) = lower($2) AND user_id IS NULL
     RETURNING id`,
    [me.id, me.email]
  );

  // A family the admin recorded before this account existed. Matching on the
  // verified email is the same proof the enrollment claim above relies on.
  const claimedStudents = await claimPendingParent(ctx, me);

  return json({ claimed: res.rows.map((r) => r.id), claimed_students: claimedStudents }, 200);
}

// Mirrors mergePendingParent in admin-manage.js: fill the profile without
// clobbering anything the parent already set, repoint the students, drop the
// placeholder. Written against ctx.db because this function runs as the end
// user, not the service key.
const PENDING_FIELDS = ["parent_name", "student_phone", "emergency_contact", "allergies"];

async function claimPendingParent(ctx, me) {
  const found = await ctx.db.query(
    `SELECT id, parent_name, email, student_phone, emergency_contact, allergies
       FROM pending_parents WHERE lower(email) = lower($1) LIMIT 1`,
    [me.email]
  );
  const pending = found.rows[0];
  if (!pending) return [];

  // COALESCE keeps a value the parent has already saved; the placeholder only
  // fills blanks.
  await ctx.db.query(
    `INSERT INTO parent_profiles (user_id, email, parent_name, student_phone, emergency_contact, allergies)
     VALUES ($1, $2, COALESCE(NULLIF($3, ''), $2), $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       parent_name       = COALESCE(NULLIF(parent_profiles.parent_name, ''), EXCLUDED.parent_name),
       student_phone     = COALESCE(NULLIF(parent_profiles.student_phone, ''), EXCLUDED.student_phone),
       emergency_contact = COALESCE(NULLIF(parent_profiles.emergency_contact, ''), EXCLUDED.emergency_contact),
       allergies         = COALESCE(NULLIF(parent_profiles.allergies, ''), EXCLUDED.allergies),
       updated_at        = now()`,
    [me.id, me.email, pending.parent_name, pending.student_phone, pending.emergency_contact, pending.allergies]
  );

  const repointed = await ctx.db.query(
    `UPDATE students SET user_id = $1, pending_parent_id = NULL
      WHERE pending_parent_id = $2
      RETURNING id`,
    [me.id, pending.id]
  );

  await ctx.db.query(`DELETE FROM pending_parents WHERE id = $1`, [pending.id]);

  return repointed.rows.map((r) => r.id);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/claim-enrollments.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `fail 0`, 3 passing.

- [ ] **Step 5: Run the whole suite**

Run: `node --test 'test/*.test.mjs' 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add backend/functions/claim-enrollments.js test/claim-enrollments.test.mjs
git commit -m "feat: claim a pending parent on verified login

A family the admin recorded before the account existed is folded in when
that family signs up, matched on the same verified email the enrollment
claim already trusts. The profile fills blanks only, so anything the parent
has already saved survives."
```

---

### Task 8: List both kinds of family

**Files:**
- Modify: `backend/functions/admin-manage.js` (`listAccounts` around line 903, `ADMIN_DATA_RESOURCES` around line 230)
- Test: `test/admin-manage.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: `list-accounts` rows gain `kind: "account" | "pending"` and `pending_parent_id`. `js/admin.js` in Task 9 reads exactly these names.

- [ ] **Step 1: Write the failing tests**

```javascript
test("list-accounts returns pending parents alongside real accounts", async () => {
  const res = await callHandler(request({ action: "list-accounts" }), {
    respond: (url) => {
      if (url.includes("parent_profiles")) return { body: [{ user_id: "user-1", email: "real@example.com", parent_name: "Real Parent" }] };
      if (url.includes("pending_parents")) return { body: [{ id: "pending-1", parent_name: "Pending Parent", email: "pending@example.com" }] };
      if (url.includes("students")) return { body: [{ user_id: "user-1", pending_parent_id: null }, { user_id: null, pending_parent_id: "pending-1" }, { user_id: null, pending_parent_id: "pending-1" }] };
      return { body: [] };
    },
  });

  assert.equal(res.status, 200);
  const { accounts } = await res.json();
  const real = accounts.find((a) => a.user_id === "user-1");
  const pending = accounts.find((a) => a.pending_parent_id === "pending-1");

  assert.equal(real.kind, "account");
  assert.equal(real.student_count, 1);
  assert.equal(pending.kind, "pending");
  assert.equal(pending.student_count, 2);
  assert.equal(pending.user_id, null);
});

test("list-accounts still works when there are no pending parents", async () => {
  const res = await callHandler(request({ action: "list-accounts" }), {
    respond: (url) => url.includes("parent_profiles")
      ? { body: [{ user_id: "user-1", email: "real@example.com", parent_name: "Real Parent" }] }
      : { body: [] },
  });

  assert.equal(res.status, 200);
  const { accounts } = await res.json();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].kind, "account");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/admin-manage.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: 2 failures - `kind` is undefined and no pending row is present.

- [ ] **Step 3: Update `listAccounts`**

Add `pending_parents` to the parallel fetch, select `pending_parent_id` on students, and append the placeholder rows:

```javascript
async function listAccounts(ctx) {
  const [profileRows, studentRows, enrollmentRows, pendingRows] = await Promise.all([
    data(ctx, "parent_profiles?select=user_id,email,parent_name"),
    data(ctx, "students?select=user_id,pending_parent_id"),
    data(ctx, "enrollments?select=user_id,student_email,parent_name,created_at&order=created_at.desc"),
    data(ctx, "pending_parents?select=id,parent_name,email,student_phone"),
  ]);
```

Give the existing `entry` helper a `kind` and a null `pending_parent_id`:

```javascript
  const entry = (userId) => {
    if (!accounts.has(userId)) {
      accounts.set(userId, {
        kind: "account",
        user_id: userId,
        pending_parent_id: null,
        email: null,
        name: null,
        student_count: 0,
        enrollment_count: 0,
      });
    }
    return accounts.get(userId);
  };
```

Then, after the three existing loops and before the sort, add the placeholders. They are keyed separately so a placeholder id can never collide with a user id:

```javascript
  // Placeholders have no user_id, so they are appended rather than merged into
  // the user-keyed map. student_count comes from the pending_parent_id column.
  const pendingCounts = new Map();
  for (const row of rows(studentRows)) {
    if (!row.pending_parent_id) continue;
    pendingCounts.set(row.pending_parent_id, (pendingCounts.get(row.pending_parent_id) || 0) + 1);
  }
  const pendingList = rows(pendingRows).map((row) => ({
    kind: "pending",
    user_id: null,
    pending_parent_id: row.id,
    email: str(row.email),
    name: str(row.parent_name),
    student_count: pendingCounts.get(row.id) || 0,
    enrollment_count: 0,
  }));

  const list = [...accounts.values(), ...pendingList]
    .sort((a, b) => (a.name || "￿").localeCompare(b.name || "￿"));
  return json({ accounts: list }, 200);
}
```

Note the existing sort used a literal `￿` character; `"￿"` is the same value written explicitly.

- [ ] **Step 4: Expose `pending_parents` to `admin-data` as read-only**

Add to `ADMIN_DATA_RESOURCES`, after the `parent_profiles` entry:

```javascript
  // Read-only for the same reason as parent_profiles: contact data is written
  // only through the dedicated actions, never straight from the admin JWT.
  pending_parents: {
    read: ["id", "parent_name", "email", "student_phone", "emergency_contact", "allergies", "created_at", "updated_at"],
    filters: { id: "uuid" },
    order: ["parent_name", "created_at"],
  },
```

Also add `pending_parent_id` to the `students` resource's `read` array and its `filters` as `"uuid"`, so the roster can show which family a standalone student belongs to.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/admin-manage.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add backend/functions/admin-manage.js test/admin-manage.test.mjs
git commit -m "feat: list pending parents alongside real accounts

Rows carry kind account or pending; placeholders are appended rather than
merged into the user-keyed map so their ids cannot collide."
```

---

### Task 9: Admin UI for pending families

**Files:**
- Modify: `js/admin.js` (accounts list around line 738, student roster around line 372, student form parent dropdown at line 418)
- Test: `test/admin-accounts.test.mjs`

**Interfaces:**
- Consumes: `list-accounts` rows with `kind`, `pending_parent_id`, `user_id`, `email`, `name`, `student_count` from Task 8; the actions from Tasks 3, 4, 5, and 6.
- Produces: no exported symbols; UI only.

- [ ] **Step 1: Read the existing accounts view and its test**

Run: `sed -n '700,800p' js/admin.js` and `sed -n '1,60p' test/admin-accounts.test.mjs`

Match whatever rendering and dispatch pattern is already there. Do not restructure the file.

- [ ] **Step 2: Write the failing tests**

Follow the existing file's harness exactly - it renders into a DOM stub and asserts on markup. Add cases asserting:

```javascript
test("accounts view marks a pending family and offers promotion", () => {
  const html = renderAccounts([
    { kind: "account", user_id: "user-1", pending_parent_id: null, email: "real@example.com", name: "Real Parent", student_count: 1, enrollment_count: 2 },
    { kind: "pending", user_id: null, pending_parent_id: "pending-1", email: "pending@example.com", name: "Pending Parent", student_count: 2, enrollment_count: 0 },
  ]);

  assert.match(html, /No account yet/);
  assert.match(html, /data-pending-parent-id="pending-1"/);
  assert.match(html, /Promote to account/);
});

test("a pending family with no email cannot be promoted", () => {
  const html = renderAccounts([
    { kind: "pending", user_id: null, pending_parent_id: "pending-2", email: null, name: "Name Only", student_count: 1, enrollment_count: 0 },
  ]);

  assert.match(html, /Promote to account/);
  assert.match(html, /disabled/);
  assert.match(html, /email/i);
});

test("a real account's email is not editable", () => {
  const html = renderParentForm({ kind: "account", user_id: "user-1", email: "real@example.com", name: "Real Parent" });
  assert.match(html, /readonly|disabled/);
});
```

Adapt `renderAccounts` and `renderParentForm` to the real exported names found in Step 1. If the existing test file drives the DOM rather than returning HTML, follow that instead and assert on `container.innerHTML`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/admin-accounts.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: 3 failures.

- [ ] **Step 4: Implement the UI**

Four changes, all following the file's existing patterns:

1. **Accounts list.** Render a `pending` row with the existing `status-pending` badge reading `No account yet`, keyed by `data-pending-parent-id` where real rows use `data-user-id`.
2. **Add family button.** A form posting `create-pending-parent` with `parent_name` required and `email` optional, labelled to say the email can be added later.
3. **Parent form.** One form for both kinds. When `kind === "account"`, render the email input `readonly` with the note `Email cannot be changed here - it is the account's sign-in identity.` and submit `update-account`. When `kind === "pending"`, the email is editable and it submits `update-pending-parent`.
4. **Promote button.** On pending rows only, posting `promote-pending-parent` with the placeholder id. Disabled when `email` is falsy, with the title `Add an email before promoting this family to an account.` On success, re-fetch the accounts list.

Then extend the student form's parent dropdown (line 418) so placeholders are selectable. Keep the bare-standalone option, since a student with no family at all is still legal:

```javascript
`<label>Parent account<select name="owner">
  <option value="">No parent account yet (standalone)</option>
  ${pendingOptions}
  ${parentOptions}
</select></label>`
```

Give placeholder options a `pending:` prefix in their value (`pending:<id>`) and real accounts a `user:` prefix, then split on the prefix when submitting to send either `pending_parent_id` or `user_id`. That keeps one control while the backend keeps its xor.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/admin-accounts.test.mjs 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `fail 0`.

- [ ] **Step 6: Run the whole suite**

Run: `node --test 'test/*.test.mjs' 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add js/admin.js test/admin-accounts.test.mjs
git commit -m "feat: manage pending families from the admin accounts page

One parent form serves both kinds; a real account's email is read-only
because it is the sign-in identity. Promotion is offered only once an email
is on file."
```

---

### Task 10: Deploy and verify end to end

**Files:**
- Modify: `backend/README.md` (document the new actions in the checkout/admin section)

**Interfaces:**
- Consumes: every task above.
- Produces: the feature live.

- [ ] **Step 1: Confirm the suite is green**

Run: `node --test 'test/*.test.mjs' 2>&1 | grep -E "^. (tests|pass|fail)"`

Expected: `fail 0`. Do not deploy otherwise.

- [ ] **Step 2: Deploy the two changed functions**

```bash
set -a; . ./.env; set +a
BUTTERBASE_API_KEY="$BUTTERBASE_API_KEY" INVITATION_GMAIL_USER_ID="$INVITATION_GMAIL_USER_ID" ./backend/deploy.sh admin-manage
BUTTERBASE_API_KEY="$BUTTERBASE_API_KEY" ./backend/deploy.sh claim-enrollments
```

`admin-manage` needs `INVITATION_GMAIL_USER_ID` in the environment or promotion will create accounts without sending the welcome email. If it is not in `.env`, get it from the admin before deploying rather than deploying without it.

- [ ] **Step 3: Walk the flow in the live admin UI**

As the admin, in order:

1. Add a family with a name only. It appears with `No account yet`, and `Promote to account` is disabled.
2. Add two students to it. Both show under that family in the roster.
3. Edit the family's phone. The change persists after a reload.
4. Try to enroll one of its students. It is refused for want of an email.
5. Add an email to the family, then enroll. It succeeds.
6. Press `Promote to account`. The family becomes a real account, both students follow it, and the placeholder is gone from the list.

- [ ] **Step 4: Verify the self-serve claim**

Create a second placeholder with an email you control and one student. Sign up on the live site with that email, verify it, and sign in. Then confirm on the account page that the student is present, and in the admin accounts list that the placeholder is gone and a real account stands in its place.

- [ ] **Step 5: Re-confirm RLS with real data present**

Repeat the browser check from Task 2 Step 5, now that `pending_parents` holds a real row. A parent session must still read back nothing.

- [ ] **Step 6: Document the actions**

Add to `backend/README.md`, under a new `### Pending families` heading in the admin section:

```markdown
A family the admin has recorded but that owns no account yet lives in
`pending_parents`; its students carry `pending_parent_id` with `user_id` NULL.
`create-pending-parent` needs only a name. An enrollment needs an email,
because `enrollments.student_email` is NOT NULL. `promote-pending-parent`
creates the real account and folds the placeholder in; `claim-enrollments`
does the same automatically when the family signs up with that email itself.
`update-account` edits a real profile but never its email, which is the
account's sign-in identity.
```

- [ ] **Step 7: Commit**

```bash
git add backend/README.md
git commit -m "docs: document pending families in the backend README"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| `pending_parents` table, `students.pending_parent_id`, RLS | 2 |
| `create-pending-parent`, `update-pending-parent` | 3 |
| `update-account`, email deliberately not editable | 4 |
| `add-student` / `create-enrollment` accept a placeholder, NOT NULL email rule, xor rejection | 5 |
| Merge routine, `promote-pending-parent` | 6 |
| Self-serve claim through `claim-enrollments` | 7 |
| `list-accounts` union, `admin-data` read-only resource | 8 |
| Admin UI: badge, one form, promote button, parent dropdown | 9 |
| Hand-verified RLS check | 2 (probe) and 10 (with real data) |
| Testing cases 1-6 | 3, 4, 5, 6, 7, 8 |

No spec requirement is unassigned. Task 1 is extra, covering pre-existing test debt that would otherwise make every later "run the suite" step ambiguous.

**Type consistency**

- `PENDING_FIELDS` is defined once in `admin-manage.js` (Task 3) and reused by Tasks 4 and 6; `claim-enrollments.js` declares its own copy (Task 7) because functions are single-file.
- `mergePendingParent(ctx, { pendingParent, userId })` returns `{ students_claimed }`; `promotePendingParent` spreads it into its response. `claim-enrollments` returns `claimed_students` (an array of ids) - deliberately a different name and type, because one is a count for the admin and the other is a list for the parent's session.
- `list-accounts` row fields (`kind`, `user_id`, `pending_parent_id`, `email`, `name`, `student_count`, `enrollment_count`) are produced in Task 8 and consumed under those exact names in Task 9.
- `assertEmailFree(ctx, email)` is defined in Task 3 and called in Tasks 3 only; Task 6 does not need it, since `createAccount` performs its own duplicate check against the auth service.
