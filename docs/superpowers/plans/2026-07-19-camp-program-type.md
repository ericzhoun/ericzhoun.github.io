# Camp Program Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "camp" program type whose Mon-Fri (or similar) class_schedules rows are enrolled and displayed as one bundle, at a fixed bundle price and class count, instead of as separate per-day classes.

**Architecture:** One new column (`programs.program_type`) is the only schema change. A shared grouping key in `js/api.js` collapses a camp program's identical-except-day `class_schedules` rows into a "bundle" object; `schedule.js` renders that bundle as a single grid block spanning its day columns (and one mobile card), and `enroll.js` shows the bundle's full day list with a locked class count. `enroll-guard`, `guest-enroll`, and every other backend function are unmodified — pricing already computes as `price_per_class_cents * num_classes_enrolled`, which is exactly the bundle total when the frontend sends the bundle size as `num_classes_enrolled`.

**Tech Stack:** Vanilla JS (ES modules, no framework, no build step), Butterbase (Postgres + PostgREST-style REST + serverless functions), `node --test` for the test suite.

## Global Constraints

- No em dash "—" in any UI copy or commit message; use a plain hyphen.
- Do not modify `enroll-guard.js`, `guest-enroll.js`, `stripe-webhook.js`, `generate-sessions.js`, `book-class.js`, or `mark-attendance.js` — the spec (`docs/superpowers/specs/2026-07-19-camp-program-type-design.md`) requires camp pricing/checkout to work through the existing, unmodified functions.
- Camps do not get `class_sessions` / attendance / makeup-booking support in this plan — out of scope per the spec.
- Run the full test suite with `node --test "test/**/*.test.mjs"` before every commit; it must stay at 100% pass.
- The schema is production (`app_48ul5eszfv7v` via the Butterbase MCP `manage_schema` tool). Always `dry_run` before `apply`, and never omit a table from the `apply` payload's intent to touch only `programs` (only include the `programs` table in the schema payload — the MCP tool's `apply` diffs against the current schema rather than treating omitted tables as drops, per its own tool description).

---

## File Structure

- **Modify** `js/api.js` — add `WEEK_DAYS`, `compareDayOfWeek`, `scheduleBundleKey`, `groupCampBundles`, `campBundleQuery`. Shared by `schedule.js` and `enroll.js`; already the shared "backend API config" module with no DOM dependency, so it's directly importable in tests.
- **Create** `test/camp-bundles.test.mjs` — unit tests for the five new `js/api.js` exports.
- **Modify** `js/schedule.js` — camp bundles render as one spanning grid block and one mobile card instead of one block/card per day.
- **Modify** `test/schedule.test.mjs` — add regression tests asserting `schedule.js` uses `groupCampBundles`.
- **Modify** `js/enroll.js` — camp programs show the bundled day list and a locked class count instead of the day/stepper controls.
- **Create** `test/enroll.test.mjs` — regression tests asserting `enroll.js` uses the camp bundle helpers and renders the locked state.
- **Modify** `js/admin.js` — add a Program Type select to the Programs form, a select-type branch in the shared `form()` builder, and a Type column in the Programs table.
- **Create** `test/admin-program-type.test.mjs` — regression tests asserting the admin config/form changes are present.
- **Modify** `backend/schema-notes.md` — log the `programs.program_type` migration.

---

### Task 1: Add `programs.program_type` column

**Files:**
- Schema: `programs` table on Butterbase app `app_48ul5eszfv7v` (via MCP `manage_schema`)
- Modify: `backend/schema-notes.md`

**Interfaces:**
- Produces: `programs.program_type` (`text`, default `'class'`), read by every later task as `program.program_type` (`"class"` | `"camp"`).

- [ ] **Step 1: Dry-run the schema change**

Call the `manage_schema` MCP tool with:

```json
{
  "app_id": "app_48ul5eszfv7v",
  "action": "dry_run",
  "schema": {
    "tables": {
      "programs": {
        "columns": {
          "active": { "type": "boolean", "default": "true" },
          "created_at": { "type": "timestamptz", "default": "now()" },
          "description": { "type": "text" },
          "id": { "type": "uuid", "primaryKey": true, "default": "gen_random_uuid()" },
          "image_url": { "type": "text" },
          "name": { "type": "text", "nullable": false },
          "slug": { "type": "text", "nullable": false, "unique": true },
          "sort_order": { "type": "integer", "default": "0" },
          "num_classes": { "type": "integer", "default": "8" },
          "session_type": { "type": "text", "default": "'standard'::text" },
          "early_bird_discount_pct": { "type": "integer", "default": "0" },
          "early_bird_deadline": { "type": "date" },
          "program_type": { "type": "text", "default": "'class'::text" }
        }
      }
    }
  }
}
```

Expected: the returned SQL is a single `ALTER TABLE programs ADD COLUMN program_type text DEFAULT 'class'` (or equivalent) — no drops, no changes to any other column.

- [ ] **Step 2: Apply the schema change**

Call `manage_schema` again with `"action": "apply"` and the identical `schema` payload from Step 1, plus `"name": "add_program_type"`.

Expected: success response; re-running `manage_schema` with `"action": "get"` shows `programs.program_type` with `"type": "text", "default": "'class'::text"`.

- [ ] **Step 3: Log the migration**

Append to `backend/schema-notes.md`:

```markdown

## 2026-07-19 - camp program type

- Added `programs.program_type` (`text`, default `'class'`). Allowed values
  `'class'` and `'camp'`. A camp program's `class_schedules` rows (created
  via the existing admin multi-day schedule form) are grouped into one
  enrollable bundle by matching `program_id, semester_id, session_type,
  start_time, end_time, age_group, price_cents, max_seats` - see
  `js/api.js` `scheduleBundleKey`/`groupCampBundles`. No other schema or
  backend function changes; `enroll-guard`/`guest-enroll` already price a
  bundle correctly because they compute `price_per_class_cents *
  num_classes_enrolled`, and the frontend now sends the bundle's day count
  as `num_classes_enrolled` for camps.
```

- [ ] **Step 4: Commit**

```bash
git add backend/schema-notes.md
git commit -m "Log programs.program_type schema migration"
```

---

### Task 2: Shared camp-bundle helpers in `js/api.js`

**Files:**
- Modify: `js/api.js`
- Test: `test/camp-bundles.test.mjs`

**Interfaces:**
- Consumes: nothing new (plain data objects: `class_schedules` rows shaped like `{ id, program_id, semester_id, session_type, start_time, end_time, age_group, price_cents, max_seats, day_of_week }`; `programs` rows shaped like `{ id, program_type }`).
- Produces (used by Task 3 and Task 4):
  - `WEEK_DAYS: string[]` - `["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]`
  - `compareDayOfWeek(a: string, b: string): number` - comparator for `Array.prototype.sort`
  - `scheduleBundleKey(schedule): string`
  - `groupCampBundles(schedules, programs): { bundles: Bundle[], singles: Schedule[] }` where `Bundle = { key, programId, days: string[], schedules: Schedule[], startTime, endTime, pricePerClassCents, totalCents }`
  - `campBundleQuery(schedule): string` - REST path fragment (no leading `/`)

- [ ] **Step 1: Write the failing tests**

Create `test/camp-bundles.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WEEK_DAYS,
  compareDayOfWeek,
  scheduleBundleKey,
  groupCampBundles,
  campBundleQuery,
} from "../js/api.js";

test("WEEK_DAYS lists Monday through Sunday in order", () => {
  assert.deepEqual(WEEK_DAYS, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
});

test("compareDayOfWeek sorts day names into Monday..Sunday order", () => {
  const days = ["Friday", "Monday", "Wednesday"];
  assert.deepEqual([...days].sort(compareDayOfWeek), ["Monday", "Wednesday", "Friday"]);
});

test("scheduleBundleKey matches rows with identical bundle fields and differs when any field changes", () => {
  const base = {
    program_id: "p1", semester_id: "s1", session_type: "standard",
    start_time: "09:00", end_time: "12:00", age_group: "6-10",
    price_cents: 7000, max_seats: 12,
  };
  const sameBundleDifferentDay = { ...base, day_of_week: "Tuesday" };
  const differentPrice = { ...base, price_cents: 8000 };

  assert.equal(scheduleBundleKey(base), scheduleBundleKey(sameBundleDifferentDay));
  assert.notEqual(scheduleBundleKey(base), scheduleBundleKey(differentPrice));
});

test("groupCampBundles collapses a camp program's rows into one bundle and leaves class programs as singles", () => {
  const programs = [
    { id: "camp-1", program_type: "camp" },
    { id: "class-1", program_type: "class" },
  ];
  const campRow = (day) => ({
    id: `camp-${day}`, program_id: "camp-1", semester_id: "sem-1", session_type: "standard",
    start_time: "09:00", end_time: "12:00", age_group: "6-10", price_cents: 7000, max_seats: 12,
    day_of_week: day,
  });
  const schedules = [
    campRow("Wednesday"), campRow("Monday"), campRow("Friday"), campRow("Tuesday"), campRow("Thursday"),
    {
      id: "class-row", program_id: "class-1", semester_id: "sem-1", session_type: "standard",
      start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3500, max_seats: 8,
      day_of_week: "Monday",
    },
  ];

  const { bundles, singles } = groupCampBundles(schedules, programs);

  assert.equal(bundles.length, 1);
  assert.deepEqual(bundles[0].days, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  assert.equal(bundles[0].totalCents, 35000);
  assert.equal(bundles[0].pricePerClassCents, 7000);
  assert.equal(bundles[0].startTime, "09:00");
  assert.equal(bundles[0].programId, "camp-1");
  assert.equal(singles.length, 1);
  assert.equal(singles[0].id, "class-row");
});

test("groupCampBundles treats a program with no program_type as a regular class", () => {
  const programs = [{ id: "legacy-1" }];
  const schedules = [{
    id: "row-1", program_id: "legacy-1", semester_id: "sem-1", session_type: "standard",
    start_time: "10:00", end_time: "11:00", age_group: "7-12", price_cents: 3000, max_seats: 6,
    day_of_week: "Saturday",
  }];

  const { bundles, singles } = groupCampBundles(schedules, programs);

  assert.equal(bundles.length, 0);
  assert.equal(singles.length, 1);
});

test("campBundleQuery builds a REST filter matching every bundle field", () => {
  const schedule = {
    program_id: "p1", semester_id: "s1", session_type: "standard",
    start_time: "09:00", end_time: "12:00", age_group: "6-10",
    price_cents: 7000, max_seats: 12,
  };
  assert.equal(
    campBundleQuery(schedule),
    "class_schedules?program_id=eq.p1&semester_id=eq.s1&session_type=eq.standard" +
      "&start_time=eq.09:00&end_time=eq.12:00&age_group=eq.6-10" +
      "&price_cents=eq.7000&max_seats=eq.12&active=eq.true&order=day_of_week.asc"
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/camp-bundles.test.mjs`
Expected: FAIL — `WEEK_DAYS`, `compareDayOfWeek`, `scheduleBundleKey`, `groupCampBundles`, and `campBundleQuery` are not exported by `../js/api.js`.

- [ ] **Step 3: Implement the helpers**

Append to `js/api.js` (after `getQueryParam`, before the schedule-query-helpers block, so the new exports sit next to the query helpers they complement):

```js
/** Canonical weekly day order, Monday through Sunday. */
export const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Comparator for sorting day_of_week strings into WEEK_DAYS order. */
export function compareDayOfWeek(a, b) {
  return WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b);
}

/** Grouping key shared by every class_schedules row that belongs to the same
 *  bundle: same program, semester, session, time, age group, price, and
 *  capacity. Used to collapse a camp's Mon-Fri rows into one enrollable unit. */
export function scheduleBundleKey(schedule) {
  return [
    schedule.program_id, schedule.semester_id, schedule.session_type,
    schedule.start_time, schedule.end_time, schedule.age_group,
    schedule.price_cents, schedule.max_seats,
  ].join("|");
}

/** Partition a semester's class_schedules rows into camp bundles (grouped by
 *  scheduleBundleKey, one entry per bundle) and singles (every row that
 *  isn't a camp program's row, kept as-is). `programs` supplies program_type. */
export function groupCampBundles(schedules, programs) {
  const programTypeById = new Map(programs.map((p) => [p.id, p.program_type || "class"]));
  const singles = [];
  const byKey = new Map();
  for (const schedule of schedules) {
    if (programTypeById.get(schedule.program_id) !== "camp") {
      singles.push(schedule);
      continue;
    }
    const key = scheduleBundleKey(schedule);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(schedule);
  }
  const bundles = [...byKey.entries()].map(([key, group]) => {
    const sorted = [...group].sort((a, b) => compareDayOfWeek(a.day_of_week, b.day_of_week));
    return {
      key,
      programId: sorted[0].program_id,
      days: sorted.map((s) => s.day_of_week),
      schedules: sorted,
      startTime: sorted[0].start_time,
      endTime: sorted[0].end_time,
      pricePerClassCents: sorted[0].price_cents,
      totalCents: sorted[0].price_cents * sorted.length,
    };
  });
  return { bundles, singles };
}

/** REST query for every class_schedules row in the same camp bundle as
 *  `schedule` (same program/semester/session/time/age group/price/capacity).
 *  Used by enroll.js to fetch a camp's full day list. */
export function campBundleQuery(schedule) {
  return `class_schedules?program_id=eq.${schedule.program_id}` +
    `&semester_id=eq.${schedule.semester_id}` +
    `&session_type=eq.${schedule.session_type}` +
    `&start_time=eq.${schedule.start_time}` +
    `&end_time=eq.${schedule.end_time}` +
    `&age_group=eq.${encodeURIComponent(schedule.age_group)}` +
    `&price_cents=eq.${schedule.price_cents}` +
    `&max_seats=eq.${schedule.max_seats}` +
    `&active=eq.true&order=day_of_week.asc`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/camp-bundles.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full suite and commit**

Run: `node --test "test/**/*.test.mjs"`
Expected: all tests pass (existing 39 + 7 new = 46)

```bash
git add js/api.js test/camp-bundles.test.mjs
git commit -m "Add shared camp-bundle grouping helpers to js/api.js"
```

---

### Task 3: Camp bundles on the public schedule grid (`js/schedule.js`)

**Files:**
- Modify: `js/schedule.js`
- Modify: `test/schedule.test.mjs`

**Interfaces:**
- Consumes: `groupCampBundles` from Task 2 (`js/api.js`).
- Produces: no new exports; `render()` behavior only.

- [ ] **Step 1: Write the failing regression tests**

Add to `test/schedule.test.mjs` (after the existing `import` line, no import changes needed since these are source-text assertions like the existing "uses the shared query helpers" test):

```js
test("schedule.js groups camp bundles instead of rendering one block per day", async () => {
  const script = await readSchedule();
  assert.match(script, /groupCampBundles\(/);
  assert.match(script, /gridColumn/);
});

test("schedule.js shows the per-day price times day count for camp bundles", async () => {
  const script = await readSchedule();
  assert.match(script, /days = \$\{formatPrice\(bundle\.totalCents\)\}/);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test test/schedule.test.mjs`
Expected: FAIL — `groupCampBundles(` and `gridColumn` not found in `js/schedule.js`.

- [ ] **Step 3: Import the helper**

In `js/schedule.js`, change the import line:

```js
import { apiGet, formatPrice, formatTime, semestersQuery, programsQuery, scheduleQuery } from "./api.js";
```

to:

```js
import { apiGet, formatPrice, formatTime, semestersQuery, programsQuery, scheduleQuery, groupCampBundles } from "./api.js";
```

- [ ] **Step 4: Replace the grid- and mobile-building sections of `render()`**

Replace this entire block (from `// ---- Desktop weekly grid ----` through the end of the mobile-list block, right before the closing of `render()`):

```js
  // ---- Desktop weekly grid ----
  const byDay = {};
  DAYS.forEach((d) => (byDay[d] = []));
  state.schedules.forEach((s) => { if (byDay[s.day_of_week]) byDay[s.day_of_week].push(s); });

  const allTimes = [...new Set(state.schedules.map((s) => s.start_time))].sort();
  const slotMap = schedulesBySlot(state.schedules);

  const wrapper = el("div", "calendar-grid-wrapper");
  const grid = el("div", "calendar-grid");

  grid.appendChild(el("div", "calendar-cell calendar-corner", "Time"));
  DAYS.forEach((day) => {
    grid.appendChild(el("div", "calendar-cell calendar-day-header", DAY_SHORT[day]));
  });

  allTimes.forEach((time) => {
    grid.appendChild(el("div", "calendar-cell calendar-time-label", formatTime(time)));
    DAYS.forEach((day) => {
      const schedules = slotMap[`${day}|${time}`] || [];
      if (schedules.length === 0) {
        grid.appendChild(el("div", "calendar-cell calendar-empty"));
        return;
      }
      const cell = el("div", "calendar-cell calendar-class-cell");
      schedules.forEach((sched) => {
        const prog = state.programs.find((p) => p.id === sched.program_id);
        const color = getColorForProgram(sched.program_id, state.programs);
        const a = el("a", "calendar-class");
        a.href = `enroll.html?schedule=${sched.id}`;
        a.style.background = color.bg;
        a.style.borderColor = color.border;
        a.style.color = color.text;
        a.appendChild(el("span", "calendar-class-program", prog ? prog.name : "Class"));
        a.appendChild(el("span", "calendar-class-time",
          `${formatTime(sched.start_time)}–${formatTime(sched.end_time)}`));
        a.appendChild(el("span", "calendar-class-age", formatAgeGroup(sched.age_group)));
        a.appendChild(el("span", "calendar-class-price", formatPrice(sched.price_cents)));
        cell.appendChild(a);
      });
      grid.appendChild(cell);
    });
  });
  wrapper.appendChild(grid);
  root.appendChild(wrapper);

  // ---- Mobile list grouped by day ----
  const mobile = el("div", "calendar-mobile");
  DAYS.filter((d) => byDay[d].length > 0).forEach((day) => {
    const group = el("div", "calendar-day-group");
    group.appendChild(el("h4", "calendar-day-title", day));
    const list = el("div", "calendar-day-classes");
    byDay[day].forEach((sched) => {
      const prog = state.programs.find((p) => p.id === sched.program_id);
      const color = getColorForProgram(sched.program_id, state.programs);
      const card = el("a", "calendar-class-mobile");
      card.href = `enroll.html?schedule=${sched.id}`;
      card.style.borderLeftColor = color.border;
      card.style.background = color.bg;
      const header = el("div", "calendar-class-mobile-header");
      header.style.color = color.text;
      header.appendChild(el("span", "calendar-class-program", prog ? prog.name : "Class"));
      header.appendChild(el("span", "calendar-class-price", formatPrice(sched.price_cents)));
      card.appendChild(header);
      const details = el("div", "calendar-class-mobile-details");
      details.appendChild(el("span", "", `${formatTime(sched.start_time)}–${formatTime(sched.end_time)}`));
      details.appendChild(el("span", "muted", formatAgeGroup(sched.age_group)));
      card.appendChild(details);
      list.appendChild(card);
    });
    group.appendChild(list);
    mobile.appendChild(group);
  });
  root.appendChild(mobile);
```

with:

```js
  // ---- Camp bundles vs. regular per-day schedules ----
  const { bundles, singles } = groupCampBundles(state.schedules, state.programs);
  const campStartCells = new Map();
  bundles.forEach((bundle) => campStartCells.set(`${bundle.days[0]}|${bundle.startTime}`, bundle));

  // ---- Desktop weekly grid ----
  const byDay = {};
  DAYS.forEach((d) => (byDay[d] = []));
  singles.forEach((s) => { if (byDay[s.day_of_week]) byDay[s.day_of_week].push(s); });

  const allTimes = [...new Set([...singles.map((s) => s.start_time), ...bundles.map((b) => b.startTime)])].sort();
  const slotMap = schedulesBySlot(singles);

  const wrapper = el("div", "calendar-grid-wrapper");
  const grid = el("div", "calendar-grid");

  const timeHeader = el("div", "calendar-cell calendar-corner", "Time");
  timeHeader.style.gridColumn = "1";
  timeHeader.style.gridRow = "1";
  grid.appendChild(timeHeader);
  DAYS.forEach((day, dayIndex) => {
    const header = el("div", "calendar-cell calendar-day-header", DAY_SHORT[day]);
    header.style.gridColumn = String(dayIndex + 2);
    header.style.gridRow = "1";
    grid.appendChild(header);
  });

  allTimes.forEach((time, timeIndex) => {
    const rowNum = timeIndex + 2;
    const timeLabel = el("div", "calendar-cell calendar-time-label", formatTime(time));
    timeLabel.style.gridColumn = "1";
    timeLabel.style.gridRow = String(rowNum);
    grid.appendChild(timeLabel);

    let dayIndex = 0;
    while (dayIndex < DAYS.length) {
      const day = DAYS[dayIndex];
      const bundle = campStartCells.get(`${day}|${time}`);

      if (bundle) {
        const span = DAYS.indexOf(bundle.days[bundle.days.length - 1]) - dayIndex + 1;
        const prog = state.programs.find((p) => p.id === bundle.programId);
        const color = getColorForProgram(bundle.programId, state.programs);
        const cell = el("div", "calendar-cell calendar-class-cell");
        cell.style.gridColumn = `${dayIndex + 2} / span ${span}`;
        cell.style.gridRow = String(rowNum);
        const a = el("a", "calendar-class");
        a.href = `enroll.html?schedule=${bundle.schedules[0].id}`;
        a.style.background = color.bg;
        a.style.borderColor = color.border;
        a.style.color = color.text;
        a.appendChild(el("span", "calendar-class-program", prog ? prog.name : "Camp"));
        a.appendChild(el("span", "calendar-class-time",
          `${formatTime(bundle.startTime)}–${formatTime(bundle.endTime)}`));
        a.appendChild(el("span", "calendar-class-price",
          `${formatPrice(bundle.pricePerClassCents)} × ${bundle.days.length} days = ${formatPrice(bundle.totalCents)}`));
        cell.appendChild(a);
        grid.appendChild(cell);
        dayIndex += span;
        continue;
      }

      const schedules = slotMap[`${day}|${time}`] || [];
      const cellColumn = dayIndex + 2;
      if (schedules.length === 0) {
        const empty = el("div", "calendar-cell calendar-empty");
        empty.style.gridColumn = String(cellColumn);
        empty.style.gridRow = String(rowNum);
        grid.appendChild(empty);
        dayIndex += 1;
        continue;
      }
      const cell = el("div", "calendar-cell calendar-class-cell");
      cell.style.gridColumn = String(cellColumn);
      cell.style.gridRow = String(rowNum);
      schedules.forEach((sched) => {
        const prog = state.programs.find((p) => p.id === sched.program_id);
        const color = getColorForProgram(sched.program_id, state.programs);
        const a = el("a", "calendar-class");
        a.href = `enroll.html?schedule=${sched.id}`;
        a.style.background = color.bg;
        a.style.borderColor = color.border;
        a.style.color = color.text;
        a.appendChild(el("span", "calendar-class-program", prog ? prog.name : "Class"));
        a.appendChild(el("span", "calendar-class-time",
          `${formatTime(sched.start_time)}–${formatTime(sched.end_time)}`));
        a.appendChild(el("span", "calendar-class-age", formatAgeGroup(sched.age_group)));
        a.appendChild(el("span", "calendar-class-price", formatPrice(sched.price_cents)));
        cell.appendChild(a);
      });
      grid.appendChild(cell);
      dayIndex += 1;
    }
  });
  wrapper.appendChild(grid);
  root.appendChild(wrapper);

  // ---- Mobile list grouped by day ----
  const mobile = el("div", "calendar-mobile");
  DAYS.filter((d) => byDay[d].length > 0 || bundles.some((b) => b.days[0] === d)).forEach((day) => {
    const group = el("div", "calendar-day-group");
    group.appendChild(el("h4", "calendar-day-title", day));
    const list = el("div", "calendar-day-classes");

    bundles.filter((b) => b.days[0] === day).forEach((bundle) => {
      const prog = state.programs.find((p) => p.id === bundle.programId);
      const color = getColorForProgram(bundle.programId, state.programs);
      const card = el("a", "calendar-class-mobile");
      card.href = `enroll.html?schedule=${bundle.schedules[0].id}`;
      card.style.borderLeftColor = color.border;
      card.style.background = color.bg;
      const header = el("div", "calendar-class-mobile-header");
      header.style.color = color.text;
      header.appendChild(el("span", "calendar-class-program", prog ? prog.name : "Camp"));
      header.appendChild(el("span", "calendar-class-price",
        `${formatPrice(bundle.pricePerClassCents)} × ${bundle.days.length} days = ${formatPrice(bundle.totalCents)}`));
      card.appendChild(header);
      const details = el("div", "calendar-class-mobile-details");
      details.appendChild(el("span", "",
        `${bundle.days.join(", ")} · ${formatTime(bundle.startTime)}–${formatTime(bundle.endTime)}`));
      card.appendChild(details);
      list.appendChild(card);
    });

    byDay[day].forEach((sched) => {
      const prog = state.programs.find((p) => p.id === sched.program_id);
      const color = getColorForProgram(sched.program_id, state.programs);
      const card = el("a", "calendar-class-mobile");
      card.href = `enroll.html?schedule=${sched.id}`;
      card.style.borderLeftColor = color.border;
      card.style.background = color.bg;
      const header = el("div", "calendar-class-mobile-header");
      header.style.color = color.text;
      header.appendChild(el("span", "calendar-class-program", prog ? prog.name : "Class"));
      header.appendChild(el("span", "calendar-class-price", formatPrice(sched.price_cents)));
      card.appendChild(header);
      const details = el("div", "calendar-class-mobile-details");
      details.appendChild(el("span", "", `${formatTime(sched.start_time)}–${formatTime(sched.end_time)}`));
      details.appendChild(el("span", "muted", formatAgeGroup(sched.age_group)));
      card.appendChild(details);
      list.appendChild(card);
    });
    group.appendChild(list);
    mobile.appendChild(group);
  });
  root.appendChild(mobile);
```

Note: `byDay` is now built from `singles` only, so a camp's rows never render as individual day blocks/cards; `bundles` supplies the one spanning block / one card per camp.

- [ ] **Step 5: Run the schedule tests to verify they pass**

Run: `node --test test/schedule.test.mjs`
Expected: PASS (all existing tests plus the 2 new ones)

- [ ] **Step 6: Run the full suite and commit**

Run: `node --test "test/**/*.test.mjs"`
Expected: all tests pass

```bash
git add js/schedule.js test/schedule.test.mjs
git commit -m "Render camp bundles as one spanning block on the schedule grid"
```

---

### Task 4: Camp bundle details on the enroll page (`js/enroll.js`)

**Files:**
- Modify: `js/enroll.js`
- Test: `test/enroll.test.mjs` (new)

**Interfaces:**
- Consumes: `campBundleQuery` and `compareDayOfWeek` from Task 2 (`js/api.js`).
- Produces: no new exports; `state.isCamp: boolean` and `state.campDays: string[]` added to the existing `state` object, `render()`/`init()` behavior only.

- [ ] **Step 1: Write the failing regression tests**

Create `test/enroll.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readEnroll = () => readFile(new URL("../js/enroll.js", import.meta.url), "utf8");

test("enroll.js fetches camp bundle siblings for camp programs", async () => {
  const script = await readEnroll();
  assert.match(script, /campBundleQuery\(/);
  assert.match(script, /program_type === "camp"/);
  assert.match(script, /compareDayOfWeek/);
});

test("enroll.js shows the bundled day list and locks the class count for camps", async () => {
  const script = await readEnroll();
  assert.match(script, /state\.campDays\.join\(", "\)/);
  assert.match(script, /not adjustable/);
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `node --test test/enroll.test.mjs`
Expected: FAIL — none of the camp markers exist yet in `js/enroll.js`.

- [ ] **Step 3: Import the new helpers and extend state**

Change the import line:

```js
import { apiGet, callFunction, formatPrice, formatTime, getQueryParam } from "./api.js";
```

to:

```js
import { apiGet, callFunction, formatPrice, formatTime, getQueryParam, campBundleQuery, compareDayOfWeek } from "./api.js";
```

Add two fields to `state`:

```js
const state = {
  user: null,
  schedule: null,
  program: null,
  enrollmentCount: 0,
  loading: true,
  error: "",
  enrolling: false,
  studentName: "",
  studentEmail: "",
  studentPhone: "",
  numClasses: 8,
  isCamp: false,
  campDays: [],
};
```

- [ ] **Step 4: Fetch the bundle siblings in `init()`**

In `init()`, replace:

```js
    const prog = await apiGet(`programs?id=eq.${sched[0].program_id}`);
    if (prog.length > 0) {
      state.program = prog[0];
      state.numClasses = prog[0].num_classes || 8;
    }
```

with:

```js
    const prog = await apiGet(`programs?id=eq.${sched[0].program_id}`);
    if (prog.length > 0) {
      state.program = prog[0];
      state.numClasses = prog[0].num_classes || 8;
    }

    if (state.program?.program_type === "camp") {
      state.isCamp = true;
      const siblings = await apiGet(campBundleQuery(state.schedule));
      state.campDays = siblings.map((s) => s.day_of_week).sort(compareDayOfWeek);
      state.numClasses = siblings.length || 1;
    }
```

- [ ] **Step 5: Show the bundled day list**

In `render()`, replace:

```js
    const rowDay = el("div", "detail-row");
    rowDay.appendChild(el("span", "detail-label", "Day"));
    rowDay.appendChild(el("span", "", schedule.day_of_week));
    details.appendChild(rowDay);
```

with:

```js
    const rowDay = el("div", "detail-row");
    rowDay.appendChild(el("span", "detail-label", "Day"));
    rowDay.appendChild(el("span", "", state.isCamp ? state.campDays.join(", ") : schedule.day_of_week));
    details.appendChild(rowDay);
```

- [ ] **Step 6: Lock the number-of-classes control for camps**

Replace:

```js
  // Number-of-classes stepper
  const rowClasses = el("div", "pricing-row");
  const lbl = el("label", "", "Number of classes");
  lbl.setAttribute("for", "num-classes");
  rowClasses.appendChild(lbl);

  const ctrl = el("div", "num-classes-control");
  const minusBtn = el("button", "", "−");
  minusBtn.type = "button";
  minusBtn.disabled = state.numClasses <= 1 || isFull;
  minusBtn.onclick = () => { state.numClasses = Math.max(1, state.numClasses - 1); render(); };
  ctrl.appendChild(minusBtn);

  ctrl.appendChild(el("span", "num-classes-value", String(state.numClasses)));

  const plusBtn = el("button", "", "+");
  plusBtn.type = "button";
  plusBtn.disabled = state.numClasses >= maxClasses || isFull;
  plusBtn.onclick = () => { state.numClasses = Math.min(maxClasses, state.numClasses + 1); render(); };
  ctrl.appendChild(plusBtn);

  ctrl.appendChild(el("span", "muted num-classes-max", `of ${maxClasses}`));
  rowClasses.appendChild(ctrl);
  pricing.appendChild(rowClasses);
```

with:

```js
  // Number-of-classes stepper (camps: fixed to the bundle size, not adjustable)
  const rowClasses = el("div", "pricing-row");
  const lbl = el("label", "", "Number of classes");
  lbl.setAttribute("for", "num-classes");
  rowClasses.appendChild(lbl);

  if (state.isCamp) {
    rowClasses.appendChild(el("span", "num-classes-value",
      `${state.numClasses} (${state.campDays.join(", ")} - included, not adjustable)`));
  } else {
    const ctrl = el("div", "num-classes-control");
    const minusBtn = el("button", "", "−");
    minusBtn.type = "button";
    minusBtn.disabled = state.numClasses <= 1 || isFull;
    minusBtn.onclick = () => { state.numClasses = Math.max(1, state.numClasses - 1); render(); };
    ctrl.appendChild(minusBtn);

    ctrl.appendChild(el("span", "num-classes-value", String(state.numClasses)));

    const plusBtn = el("button", "", "+");
    plusBtn.type = "button";
    plusBtn.disabled = state.numClasses >= maxClasses || isFull;
    plusBtn.onclick = () => { state.numClasses = Math.min(maxClasses, state.numClasses + 1); render(); };
    ctrl.appendChild(plusBtn);

    ctrl.appendChild(el("span", "muted num-classes-max", `of ${maxClasses}`));
    rowClasses.appendChild(ctrl);
  }
  pricing.appendChild(rowClasses);
```

- [ ] **Step 7: Run the enroll tests to verify they pass**

Run: `node --test test/enroll.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 8: Run the full suite and commit**

Run: `node --test "test/**/*.test.mjs"`
Expected: all tests pass

```bash
git add js/enroll.js test/enroll.test.mjs
git commit -m "Show the bundled day list and a locked class count for camp enrollments"
```

---

### Task 5: Program Type field in the admin UI (`js/admin.js`)

**Files:**
- Modify: `js/admin.js`
- Test: `test/admin-program-type.test.mjs` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks (admin reads/writes `programs.program_type` directly via `adminApi`, added in Task 1).
- Produces: no exports; UI-only.

- [ ] **Step 1: Write the failing regression tests**

Create `test/admin-program-type.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAdmin = () => readFile(new URL("../js/admin.js", import.meta.url), "utf8");

test("admin.js exposes a Program Type select on the programs form", async () => {
  const script = await readAdmin();
  assert.match(script, /\["program_type","Program Type","select"/);
  assert.match(script, /\[\["class","Class"\],\["camp","Camp"\]\]/);
});

test("admin.js form() builder supports select-type fields", async () => {
  const script = await readAdmin();
  assert.match(script, /type === "select"/);
});

test("admin.js shows the program type in the Programs table", async () => {
  const script = await readAdmin();
  assert.match(script, /id === "programs" && key === "program_type"/);
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `node --test test/admin-program-type.test.mjs`
Expected: FAIL — none of the markers exist yet in `js/admin.js`.

- [ ] **Step 3: Add select support to the shared `form()` builder**

Replace:

```js
function form(fields, values = {}, title = "Edit record") {
  const inputValue = (key, type) => {
    const value = values[key] ?? "";
    return type === "date" && value ? String(value).slice(0, 10) : value;
  };
  return `<form id="record-form" class="admin-form"><h3>${title}</h3><p class="auth-error" id="form-error" hidden></p>${fields.map(([key, label, type = "text", extra = ""]) => `<label>${label}<${type === "textarea" ? "textarea" : "input"} name="${key}" type="${type}" value="${esc(inputValue(key, type))}" ${extra}>${type === "textarea" ? esc(values[key] ?? "") : ""}</${type === "textarea" ? "textarea" : "input"}></label>`).join("")}<div class="form-actions"><button type="submit" class="btn btn-sm" data-save-button>Save</button><button type="button" class="btn btn-sm btn-secondary" data-action="cancel-form">Cancel</button></div></form>`;
}
```

with:

```js
function form(fields, values = {}, title = "Edit record") {
  const inputValue = (key, type) => {
    const value = values[key] ?? "";
    return type === "date" && value ? String(value).slice(0, 10) : value;
  };
  const field = ([key, label, type = "text", extra = ""]) => {
    if (type === "select") {
      const options = extra;
      const selected = values[key] ?? options[0][0];
      return `<label>${label}<select name="${key}">${options.map(([value, text]) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
    }
    return `<label>${label}<${type === "textarea" ? "textarea" : "input"} name="${key}" type="${type}" value="${esc(inputValue(key, type))}" ${extra}>${type === "textarea" ? esc(values[key] ?? "") : ""}</${type === "textarea" ? "textarea" : "input"}></label>`;
  };
  return `<form id="record-form" class="admin-form"><h3>${title}</h3><p class="auth-error" id="form-error" hidden></p>${fields.map(field).join("")}<div class="form-actions"><button type="submit" class="btn btn-sm" data-save-button>Save</button><button type="button" class="btn btn-sm btn-secondary" data-action="cancel-form">Cancel</button></div></form>`;
}
```

- [ ] **Step 4: Add the Program Type field and Type column to `configs.programs`**

Replace:

```js
  programs: { title: "Programs", endpoint: "programs?order=sort_order.asc", fields: [["name","Name"],["slug","Slug"],["description","Description","textarea"],["image_url","Image URL"],["sort_order","Sort Order","number"],["num_classes","Number of Classes","number"],["early_bird_discount_pct","Early-Bird Discount %","number"],["early_bird_deadline","Early-Bird Deadline","date"]], cols: ["name","num_classes","active"], labels: ["Name","Classes","Active"] },
```

with:

```js
  programs: { title: "Programs", endpoint: "programs?order=sort_order.asc", fields: [["name","Name"],["slug","Slug"],["description","Description","textarea"],["image_url","Image URL"],["sort_order","Sort Order","number"],["program_type","Program Type","select",[["class","Class"],["camp","Camp"]]],["num_classes","Number of Classes (for camps, set to the number of days in the bundle - e.g. 5 for Mon-Fri)","number"],["early_bird_discount_pct","Early-Bird Discount %","number"],["early_bird_deadline","Early-Bird Deadline","date"]], cols: ["name","program_type","num_classes","active"], labels: ["Name","Type","Classes","Active"] },
```

- [ ] **Step 5: Display "Class"/"Camp" instead of the raw value**

In `crud()`, replace:

```js
  const displayValue = (item, key) => {
    if (id === "schedules" && key === "program_id") return programs.find((p) => p.id === item.program_id)?.name || "-";
    if (id === "schedules" && key === "semester_id") return semesters.find((s) => s.id === item.semester_id)?.name || "-";
    if (id === "schedules" && key === "session_type") return SESSION_TYPES[sessionTypeFor(item)].label;
    if (key.includes("date")) return date(item[key]);
    if (key === "price_cents") return formatPrice(item[key]);
    return item[key] ?? (key === "active" ? "✓" : "-");
  };
```

with:

```js
  const displayValue = (item, key) => {
    if (id === "schedules" && key === "program_id") return programs.find((p) => p.id === item.program_id)?.name || "-";
    if (id === "schedules" && key === "semester_id") return semesters.find((s) => s.id === item.semester_id)?.name || "-";
    if (id === "schedules" && key === "session_type") return SESSION_TYPES[sessionTypeFor(item)].label;
    if (id === "programs" && key === "program_type") return item.program_type === "camp" ? "Camp" : "Class";
    if (key.includes("date")) return date(item[key]);
    if (key === "price_cents") return formatPrice(item[key]);
    return item[key] ?? (key === "active" ? "✓" : "-");
  };
```

- [ ] **Step 6: Run the admin tests to verify they pass**

Run: `node --test test/admin-program-type.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 7: Run the full suite and commit**

Run: `node --test "test/**/*.test.mjs"`
Expected: all tests pass

```bash
git add js/admin.js test/admin-program-type.test.mjs
git commit -m "Add a Program Type field to the admin Programs form"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only, per project standard: reproduce/verify in as close to a real end-user setting as possible before calling this done)

- [ ] **Step 1: Create a camp program in the admin UI**

Open `admin.html` in a browser, log in as an admin, go to Programs -> "+ New Program". Set Name = "Test Summer Camp", Slug = "test-summer-camp", Program Type = Camp, Number of Classes = 5, Active = checked. Save.

- [ ] **Step 2: Create the Mon-Fri schedule bundle**

Go to Schedules -> "+ New Class Schedules". Program = Test Summer Camp, Semester = an active semester, Days = Monday through Friday (all 5 checked), Session type/time/price/age group/max seats = any valid values. Save. Confirm the Schedules table shows one grouped row listing "Monday, Tuesday, Wednesday, Thursday, Friday".

- [ ] **Step 3: Verify the public schedule grid**

Open `schedule.html`, select the semester used above. Confirm the camp shows as a single block spanning the Monday-Friday columns at the chosen time, with the price text `$<perClass> × 5 days = $<total>` matching Number of Classes × price. Confirm no separate blocks appear under Monday/Tuesday/etc. individually. Resize to mobile width (or use browser dev tools device mode) and confirm the mobile list shows exactly one card for the camp, under its first day, listing all 5 days.

- [ ] **Step 4: Verify the enroll page**

Click into the camp's block. Confirm the "Day" row reads "Monday, Tuesday, Wednesday, Thursday, Friday", the number-of-classes row shows the fixed count with no +/- buttons, and the pricing breakdown total matches `perClass × 5`.

- [ ] **Step 5: Verify checkout still works (Stripe test mode)**

Complete the enrollment form and proceed to payment with Stripe test card `4242 4242 4242 4242`. Confirm checkout succeeds and lands on `registration.html` with the correct enrollment id, exactly like a regular class enrollment - this confirms `enroll-guard`/`guest-enroll` needed no changes.

- [ ] **Step 6: Clean up the test data**

Delete the test camp's schedules and the "Test Summer Camp" program from the admin UI so they don't appear on the live schedule.

---

## Self-Review Notes

- Spec coverage: schema change (Task 1), grouping key (Task 2), schedule grid spanning block + mobile card (Task 3), enroll page day list/locked count (Task 4), admin Program Type field + num_classes hint (Task 5), no backend function changes (verified: no task touches `backend/functions/*.js`), manual E2E check (Task 6). All spec sections are covered.
- No backend function changes anywhere in this plan, matching the spec's explicit "out of scope" list.
- Types/signatures cross-checked: `groupCampBundles` (Task 2) returns `{ bundles, singles }` with `bundle.days`, `bundle.startTime`, `bundle.endTime`, `bundle.pricePerClassCents`, `bundle.totalCents`, `bundle.programId`, `bundle.schedules` - Task 3 uses exactly these names. `campBundleQuery` and `compareDayOfWeek` (Task 2) are used with the same names in Task 4.
