# Camp day-checkbox schedule sync - design

## Problem

Camp bundles are collapsed for display purposes by grouping `class_schedules`
rows that share `scheduleBundleKey` (see
`2026-07-19-camp-program-type-design.md`), but nothing keeps those rows in
sync with the program's intent. `programs.num_classes` is purely descriptive
for camps - it's read once into `enroll.js`'s `state.numClasses` and then
immediately overwritten by the actual sibling-row count (`js/enroll.js:344`).
Editing `num_classes` on the Programs form today does nothing a customer can
see; the schedule grid and enroll page are driven entirely by however many
`class_schedules` day-rows happen to exist, active or not.

This was surfaced by a real bug: "Young Photographer Camp" was set to 5
classes/week but the grid showed a 6-day bundle, because 6 active
`class_schedules` rows existed for it and nothing enforced or reflected the
`num_classes` value. Fixing that one instance (deactivating the stray
Saturday row) is done; this spec makes the general case self-consistent.

## Scope

In scope:
- Admin Programs form: for `program_type = camp`, replace the numeric
  "Number of Classes" field with a day-of-week checkbox picker.
  `num_classes` becomes derived (`= checked day count`), not manually typed.
- On saving an edit to an existing camp program, resync every active bundle
  for that program's `class_schedules` rows to match the checked days
  (deactivate dropped days, reactivate or create added days).
- Pre-check the current active days when opening Edit on a camp program.

Out of scope (explicitly deferred):
- Any change to `class` (non-camp) programs - their form and `num_classes`
  field are untouched.
- The pre-existing gap where a camp enrollment stores a single `schedule_id`
  and `generate-sessions`/`createHomeBookings` only fire for that one day,
  not all bundle days - a real issue, but independent of this feature and
  not addressed here.
- Any backend function change (`enroll-guard`, `guest-enroll`,
  `stripe-webhook`, `generate-sessions`, `book-class`, `class-availability`).
  This feature only touches `class_schedules` rows the same way the existing
  admin Schedules form already does (PATCH/POST via `adminApi`).
- Handling a program that already has *inconsistent* bundles (different
  active day-sets across its semesters/time-slots) specially - see "Scope of
  sync" below, this is resolved by design, not flagged as an error.

## Scope of sync: all active bundles for the program

A camp program can have more than one live bundle instance (e.g. Fall 2026
and Summer 2026, or a morning slot and an afternoon slot in the same
semester) - see `scheduleBundleKey`, which is keyed by
`program_id, semester_id, session_type, start_time, end_time, age_group,
price_cents, max_seats`. Editing the Program's days applies uniformly: every
bundle instance for that program that currently has at least one active row
gets resized to the same checked day-set. A program is treated as having one
canonical weekly pattern; bundles with zero active rows (retired) are left
alone.

## Pure sync-planning logic (`js/api.js`)

New exported function, unit-testable without any network/DOM dependency:

```js
export function planCampBundleSync(scheduleRows, targetDays)
```

- `scheduleRows`: every `class_schedules` row for one program, active and
  inactive (the caller fetches with no `active` filter).
- `targetDays`: array of `day_of_week` strings that should end up active.
- Returns an array of per-bundle plans:
  ```js
  [{ key, deactivateIds: [id, ...], reactivateIds: [id, ...], createRows: [{...row, day_of_week, active: true}, ...] }]
  ```

Algorithm:
1. Group `scheduleRows` by `scheduleBundleKey` (reused as-is).
2. Skip any group with no currently-`active` row (retired bundle - not
   resynced).
3. For each remaining group, compare its active days to `targetDays`:
   - Row is active and its day isn't in `targetDays` -> its id goes in
     `deactivateIds`.
   - A `targetDays` entry has an existing row for that day that's
     inactive -> its id goes in `reactivateIds`.
   - A `targetDays` entry has no row at all for that day -> a new row is
     added to `createRows`, cloning `program_id, semester_id, session_type,
     start_time, end_time, age_group, price_cents, max_seats` from any
     member of the group, with `day_of_week` set and `active: true`.
   - A `targetDays` entry whose row is already active -> no-op, not
     included anywhere.

This function makes no API calls; it only computes the diff. The caller
(admin.js) executes it as PATCH/POST requests via `adminApi`, exactly the
pattern the existing Schedules form already uses for its own day-diffing
(`js/admin.js:199-213`).

## Admin Programs form (`js/admin.js`)

Replace the generic `form(c.fields, ...)` call for `id === "programs"` with
a new bespoke `programForm(values, title)` function (parallel to the
existing `scheduleForm`), since the field set now depends on
`program_type`, which the generic config-driven `form()` builder can't
express.

Fields, in order: Name, Slug, Description, Image URL, Sort Order, Program
Type (select), then **either**:
- Number of Classes (number input) - shown when Program Type is Class, or
- Days per week (checkbox group, reusing the `DAYS` constant and the same
  `.day-picker` fieldset markup/styling as the Schedules form) - shown when
  Program Type is Camp.

Both field blocks are always present in the DOM; visibility toggles via a
`change` listener on the Program Type `<select>` (same wiring style as the
existing session-type auto-fill listeners in `scheduleForm`'s `bindForm`).
Whichever is hidden doesn't matter for submission - the submit handler
recomputes `num_classes` for camps regardless of what's in the number input.

**Pre-checking current days on Edit:** the `edit:` action for `id ===
"programs"` becomes async when the target program's `program_type ===
"camp"`: fetch `class_schedules?program_id=eq.<id>&active=eq.true`, take the
distinct set of `day_of_week` values across all rows (this is the union
across bundles; per "Scope of sync" they're expected to already match), and
pass that as `values.campDays` into `programForm`. For `class` programs, or
brand-new programs, this fetch is skipped and `campDays` defaults to `[]`.

**Validation:** for camp submissions, at least one day must be checked
(`Select at least one day of the week.`, same message/style as the
Schedules form's existing day validation).

**Submit handling**, `id === "programs"` branch:
1. If `program_type !== "camp"`: behaves exactly as today (plain
   PATCH/POST of `body`, with `camp_days` stripped if present).
2. If `program_type === "camp"`:
   - Read `data.getAll("camp_days")` (FormData, not `body`, same reason the
     Schedules form reads `data.getAll("days")` separately - `body` only
     keeps the last value per key for repeated checkbox names).
   - Validate non-empty.
   - Set `body.num_classes = days.length`; delete `body.camp_days` (not a
     real column).
   - Save the program row (PATCH if editing, POST if new).
   - **Only if editing** (`editId` present): fetch
     `class_schedules?program_id=eq.<editId>` (all rows), call
     `planCampBundleSync(rows, days)`, and execute every plan's
     `deactivateIds`/`reactivateIds`/`createRows` as parallel `adminApi`
     calls (PATCH `active:false`, PATCH `active:true`, POST new row,
     respectively) - mirroring the existing
     `Promise.all([...existingSchedules.map(...), ...days.map(...)])`
     pattern already used for schedule saves.
   - New programs skip the resync step entirely (no bundles exist yet to
     sync; the admin creates the actual schedule afterward via the
     Schedules tab, same as today).

No changes to the Schedules tab/form itself - it remains how a camp's first
bundle gets created in the first place (pick days, time, price once); this
feature only keeps it in sync afterward via the Program's day picker.

## Testing

- Unit tests (`test/`, following `camp-bundles.test.mjs`'s style - pure
  function, no DOM):
  - `planCampBundleSync` deactivates a day that's active but unchecked.
  - `planCampBundleSync` reactivates an existing inactive row for a newly
    checked day instead of creating a duplicate.
  - `planCampBundleSync` creates a new row (cloning bundle fields) for a
    checked day with no existing row at all.
  - `planCampBundleSync` skips a bundle group with zero active rows
    (retired bundle untouched).
  - `planCampBundleSync` returns one plan per bundle when a program has
    multiple live bundle instances (e.g. two semesters), each resynced
    independently to the same `targetDays`.
  - A day that's already active and checked produces no id in any list.
- Source-assertion tests for the admin UI wiring (matching
  `admin-program-type.test.mjs`'s style, since `admin.js` isn't otherwise
  unit-tested): `programForm` exists and renders both the number field and
  day-checkbox fieldset; the Program Type change listener is wired; the
  submit handler computes `num_classes` from `camp_days` for camp
  submissions.
- Manual E2E check (per project standards): edit an existing camp program
  in a test environment, uncheck a day, save, confirm the corresponding
  `class_schedules` row goes inactive and `schedule.html`'s Camps table
  (after rebaking) drops that day; re-check it and confirm the same row
  reactivates rather than duplicating; check a day that never had a row and
  confirm a new one is created with the bundle's existing time/price/seats.
