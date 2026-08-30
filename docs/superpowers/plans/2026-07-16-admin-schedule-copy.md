# Admin Schedule Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Copy action to grouped Admin CRM schedules that opens a prefilled create form, and move Actions to the second table column.

**Architecture:** Reuse the existing grouped schedule row renderer and `scheduleForm`. Copy passes the grouped source values into create mode, while the existing POST branch creates new rows. The source group remains untouched because no edit identifier is passed.

**Tech Stack:** Vanilla JavaScript ES modules, HTML strings, Node built-in test runner where useful.

## Global Constraints

- Keep the feature limited to the Admin CRM Schedules view.
- Do not change the backend schema or endpoints.
- Copy must create new rows and never PATCH or delete the source.
- Preserve multi-day schedule creation behavior.

---

### Task 1: Add schedule-copy rendering and behavior

**Files:**
- Modify: `/Users/ericz/Documents/GitHub/olivistart/js/admin.js`

- [ ] **Step 1: Preserve copied days in create-mode forms**

Update `scheduleForm` so create mode uses `values.days` when supplied, while ordinary new forms still start with no selected days:

```js
const selectedDays = values.days || (isEditing ? [values.day_of_week] : []);
```

- [ ] **Step 2: Put Actions second and add Copy**

Render each schedule row as the first data cell, then the Actions cell, then the remaining configured columns. Add a Copy button whose action contains the grouped member ids, and keep Edit/Delete behavior unchanged.

- [ ] **Step 3: Open a prefilled create form from Copy**

Handle `copy-group:` by finding the matching `scheduleGroups` entry, rendering `scheduleForm` with the group's representative item plus `days: group.days`, `active: group.activeDays.length > 0`, and a create title, then call `bindForm()` without an edit id.

- [ ] **Step 4: Keep table headers aligned with row order**

Pass `c.labels` reordered to match the row output, with `Actions` inserted after `Program`, and ensure the actions cell is escaped only through the existing button helper.

- [ ] **Step 5: Run syntax and static checks**

Run:

```bash
node --check js/admin.js
rg -n "copy-group|Actions|scheduleForm" js/admin.js
```

Expected: syntax check exits 0; the copy handler and second-column rendering are present.

### Task 2: Verify the behavior

**Files:**
- Test: `/Users/ericz/Documents/GitHub/olivistart/test/admin-schedule-copy.test.mjs` if a test harness can be added without changing application architecture.

- [ ] **Step 1: Inspect available project test commands**

Run:

```bash
rg --files -g 'package.json' -g 'test/**' -g '*.config.*'
```

Use existing tests if present; do not add a dependency solely for this focused UI change.

- [ ] **Step 2: Run targeted verification**

Run the repository's relevant test command, or use `node --check js/admin.js` plus a small source-level assertion if no test harness exists. Verify the Actions header follows Program and Copy does not pass an edit id.

- [ ] **Step 3: Run the full available test suite**

Run the project's documented test command. Record any pre-existing failures accurately.

- [ ] **Step 4: Review the diff**

Run:

```bash
git diff --check && git diff -- js/admin.js
```

Confirm no unrelated files or generated changelogs were modified.

- [ ] **Step 5: Commit the implementation**

```bash
git add js/admin.js
git commit -m "feat: copy admin class schedules"
```
