# Student Age From Date of Birth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make student-profile age a read-only value derived from a required date of birth in both the account UI and API.

**Architecture:** The account page calculates and displays age when the DOB input changes, but sends only the DOB to the student API. The API independently validates DOB and calculates the persisted age for both create and update requests, so the database cannot be poisoned by a client-supplied age.

**Tech Stack:** Vanilla browser JavaScript, ESM function handlers, Node.js built-in test runner.

## Global Constraints

- Do not modify checkout registration behavior.
- Preserve `students.age` and `students.dob` database fields.
- Use calendar-date age calculation that handles birthdays and invalid dates.
- Implement directly on the current `main` branch per user direction.

---

### Task 1: Enforce derived age in the student API

**Files:**

- Modify: `backend/functions/manage-students.js`
- Modify: `test/enrollment-student-association.test.mjs`

**Interfaces:**

- Consumes: request body `{ action: "add" | "update", dob: "YYYY-MM-DD", age?: string }`.
- Produces: student rows with `age` derived from `dob`; a 400 response with `{ error: "A valid date of birth is required" }` when DOB is missing or invalid.

- [ ] **Step 1: Write failing API tests**

```js
test("student creation derives age from date of birth instead of submitted age", async () => {
  const response = await handler(request({ action: "add", name: "Ada", dob: "2015-10-20", age: "99" }), ctx);
  assert.equal(response.status, 200);
  assert.equal(queries[0].values.includes("99"), false);
  assert.equal(queries[0].values.includes(String(calculateAge("2015-10-20"))), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/enrollment-student-association.test.mjs`

Expected: FAIL because `manage-students` persists the submitted `age`.

- [ ] **Step 3: Implement server-side DOB validation and age derivation**

```js
const dob = str(body.dob);
const age = calculateAge(dob);
if (age == null) return json({ error: "A valid date of birth is required" }, 400);
// add: insert String(age), dob
// update: set fields.age = String(age) and fields.dob = dob
```

Add a local `calculateAge(dob, today = new Date())` helper matching the registration implementation, including strict ISO-date validation.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/enrollment-student-association.test.mjs`

Expected: PASS with all tests in the file passing.

- [ ] **Step 5: Commit the API change**

```bash
git add backend/functions/manage-students.js test/enrollment-student-association.test.mjs
git commit -m "Derive student age from date of birth"
```

### Task 2: Calculate and protect age in the account student form

**Files:**

- Modify: `js/account.js`
- Modify: `test/enrollment-student-association.test.mjs`

**Interfaces:**

- Consumes: `state.editingStudent?.dob` when the form renders and the `input` event from `[name="dob"]`.
- Produces: a required `<input type="date" name="dob">`, a read-only `<input name="age">`, and API save bodies that omit `age`.

- [ ] **Step 1: Write the failing UI source test**

```js
test("student form derives a read-only age from its date of birth", async () => {
  const account = await readFile(new URL("../js/account.js", import.meta.url), "utf8");
  assert.match(account, /dobI\.type = "date"/);
  assert.match(account, /ageI\.readOnly = true/);
  assert.match(account, /dobI\.oninput/);
  assert.doesNotMatch(account, /action: "add", name, age, dob, notes/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/enrollment-student-association.test.mjs`

Expected: FAIL because DOB is currently text input and age is editable.

- [ ] **Step 3: Implement the calculated account form**

```js
const age = calculateAge(dobI.value);
ageI.value = age == null ? "" : String(age);
dobI.oninput = () => updateAge();
```

Add a local calendar-date `calculateAge` helper in `js/account.js`, make DOB required, make Age read-only, and remove `age` from `handleSaveStudent` and its API calls.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/enrollment-student-association.test.mjs`

Expected: PASS with all tests in the file passing.

- [ ] **Step 5: Run full verification and commit**

Run: `node --test test/*.test.mjs`

Expected: PASS with zero failures.

```bash
git add js/account.js test/enrollment-student-association.test.mjs docs/superpowers/plans/2026-07-17-student-age-from-dob.md
git commit -m "Calculate student age from date of birth"
```
