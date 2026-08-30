# Enroll page: parent name, student dropdown, multi-day enrollment - design

## Problem

The enroll page (`enroll.html` / `js/enroll.js`) currently collects only
Student Name and Phone Number (plus Email for guests). Two things are
wrong or missing:

1. It mistakenly pre-fills **Student Name** with the account's
   `display_name` (`enroll.js:349`). There is no Parent Name field at all,
   even though `enrollments.parent_name` already exists as a column and is
   filled in later, post-payment, on `registration.html`.
2. A parent with existing student profiles (`students` table, managed via
   `manage-students.js`) has to retype the student's name from scratch
   every time, instead of picking from their own students.
3. Enrollment is hard-locked to the single `class_schedules` row the parent
   clicked on the schedule grid. Classes that meet on more than one day per
   week (e.g. a Mon/Wed/Fri program, each day its own `class_schedules`
   row) cannot be enrolled into for more than one day at a time - the
   parent would have to run through checkout N separate times.

## Scope

In scope:
- Parent Name field on the enroll form, pre-filled (editable) from the
  logged-in account's `display_name`; required free text for guests.
- Student Name becomes a dropdown of the account's existing students (via
  `manage-students` `list`) plus an "Other / New student" free-text
  fallback, when the account has 1+ students. Unchanged (free text) when
  the account has none, or for guests.
- Day-of-week checkboxes for regular (non-camp) classes that have sibling
  `class_schedules` rows on other days of the same program/time/price/
  capacity bundle, defaulting to only the clicked day checked. Selecting
  more than one day bills one session per selected day (no weekly-
  recurrence stepper in that mode), mirroring how camp bundles already
  price.
- Backend support in `enroll-guard.js` / `guest-enroll.js` for creating
  one `enrollments` row per selected day in a single checkout, with
  independent per-day capacity checks.
- Grouping multiple same-purchase `enrollments` rows (sharing one
  `stripe_order_id`) on `registration.html` and `account.html`, since those
  pages currently assume one row = one page/card.

Out of scope:
- Camp programs (`program_type = 'camp'`): unchanged. They already force
  all bundle days, non-adjustable; this spec does not touch that path.
- Any UI to create a new student profile (with DOB) from the enroll page.
  "Other / New student" stays a plain name field, unlinked
  (`student_id: null`), exactly like today - linking to a real student
  profile still happens later from the account page via the existing
  `assign-enrollment` action.
- `checkout-success.html`: no change needed. `claimEnrollments()` already
  claims every unclaimed row for the guest's email in one request, so a
  multi-row guest purchase is already claimed as a group.
- Any change to per-class capacity/pricing logic for the single-schedule
  (today's common) path.

## Data model

No schema changes. Everything needed already exists:
- `enrollments.parent_name` (used today by `complete-registration.js`).
- `enrollments.student_id` (nullable FK to `students`, added migration 28).
- `enrollments.stripe_order_id` (already stamped identically across rows
  from the same checkout by `enroll-guard.js` / `guest-enroll.js`, and
  already used by `stripe-webhook.js` to update every row sharing an order
  id at once - so grouping by it is safe, just not yet done in the
  frontend).

Sibling-day detection reuses the existing `scheduleBundleKey` /
`campBundleQuery` helpers in `js/api.js`, which group
`class_schedules` rows by `program_id, semester_id, session_type,
start_time, end_time, age_group, price_cents, max_seats` - already
generic, not camp-specific, despite being introduced for camps.

## Frontend: `enroll.js`

### Parent Name

New `state.parentName`, initialized in `init()`:
- Logged in: `state.user.display_name || state.user.email || ""`.
- Guest: `""`.

Rendered as a normal text input, always shown (both guest and logged-in
forms), required. Submitted as `parent_name` in both `enroll-guard` and
`guest-enroll` calls.

### Student Name

New `state.students` (array from `manage-students` `list`, logged-in
only), `state.studentId` (selected existing student id, or `null`),
`state.showNewStudentInput` (bool).

On `init()`, logged-in only: `callFunction("manage-students", { action:
"list" }, token)`.

Render logic in the form:
- Not logged in, or logged in with zero students: today's free-text input
  (`state.studentName`), `state.studentId` stays `null`.
- Logged in with 1+ students: a `<select>` listing each student's name
  (value = student id), plus a trailing "Other / New student" option.
  Selecting a student sets `state.studentId` and `state.studentName` (from
  the student record) together. Selecting "Other / New student" clears
  `state.studentId` to `null` and reveals the existing free-text input.

Submitted as `student_name` (always) and `student_id` (only when a real
student is selected; omitted/`null` for free text) to `enroll-guard`.
Guests never send `student_id` - `guest-enroll.js` does not accept it.

### Day-of-week checkboxes

On `init()`, after loading `state.schedule` and `state.program` (for
every program, not just camps): fetch sibling rows via the existing
`campBundleQuery(state.schedule)` query.

- If `state.program.program_type === "camp"`: unchanged existing path
  (`state.isCamp`, `state.campDays`, locked `numClasses = siblings.length`,
  no checkboxes, no stepper).
- Else if there are 2+ sibling rows (a non-camp class meeting multiple
  days/week): enter a new "multi-day" mode.
  - `state.siblingSchedules` = sorted sibling rows (Mon..Sun).
  - `state.selectedScheduleIds` = a `Set` containing only the clicked
    schedule's id, by default.
  - Render one checkbox per sibling day (label = `day_of_week`), checked
    state driven by membership in `selectedScheduleIds`. Toggling
    add/removes that schedule's id from the set and re-renders.
  - No stepper is shown in this mode. `numClasses` for pricing purposes
    equals `selectedScheduleIds.size` (minimum 1 - the clicked day cannot
    be unchecked below one selection; enforce by disabling its checkbox
    when it is the only one selected, matching the existing minus-button
    disable pattern at `numClasses <= 1`).
  - "Day" detail row shows the selected days joined, e.g. "Monday,
    Wednesday".
- Else (today's common case, exactly one schedule for this program/time):
  unchanged existing stepper path.

### Submission (`handleEnroll`)

- Multi-day mode: send `schedule_ids: [...state.selectedScheduleIds]`
  instead of `schedule_id`. Still send `parent_name`, `student_name`,
  `student_id` (if any), `student_email`/`student_phone` as today.
  `num_classes_enrolled` is not sent in this mode (server derives it from
  `schedule_ids.length`).
- Single-schedule and camp modes: unchanged (`schedule_id`,
  `num_classes_enrolled`).
- Success redirect: unchanged shape
  (`registration.html?enrollment=<id>&payment=success` /
  `checkout-success.html?enrollment=<id>`) - `<id>` is simply the first
  enrollment row created; the registration page finds its siblings via
  `stripe_order_id` (see below), so which row's id is "first" does not
  matter.

## Backend: `enroll-guard.js` / `guest-enroll.js`

Both gain two independent, backward-compatible additions:

**`parent_name` / `student_id`** (parent_name in both; student_id in
`enroll-guard` only):
- `parent_name` is trimmed and inserted into the existing `parent_name`
  column, defaulting to `""` when absent (same pattern as
  `student_phone` today).
- `student_id`, when present, is validated with
  `EXISTS (SELECT 1 FROM students WHERE id = $1 AND user_id = $2)`
  before being trusted; reject with 400 if it does not belong to
  `ctx.user.id`. Persisted into `enrollments.student_id`.

**`schedule_ids` (multi-day path)**, checked before the existing single-
`schedule_id` path (which remains exactly as-is when `schedule_ids` is
absent):

1. Reject if `schedule_ids` is not a non-empty array, or contains
   duplicates.
2. Re-fetch all corresponding `class_schedules` + joined `programs` rows
   server-side (never trust client-side grouping). Reject (400) if any
   row is missing/inactive, or if the set does not share one bundle
   signature (`program_id, semester_id, session_type, start_time,
   end_time, age_group, price_cents, max_seats` - same fields as
   `scheduleBundleKey`).
3. Per-schedule capacity check, identical query to today's single-
   schedule check, run once per id. If any is full, reject the whole
   request with 409 before creating anything (all-or-nothing).
4. Pricing: `perClass` from the shared bundle signature,
   `numClasses = schedule_ids.length`, early-bird calculation unchanged
   (`numClasses >= 15` before the deadline) - applied once to the
   combined total.
5. Insert one `enrollments` row per schedule_id (`num_classes_enrolled =
   1` each, `price_per_class_cents = perClass`, `discount_pct` the same
   on every row). Each row's `total_paid_cents` is the discounted
   per-class amount (`perClass - round(perClass * discount_pct / 100)`),
   except the last row (sorted by schedule_id) absorbs any leftover cent
   from integer rounding, so the rows' sum always equals the combined
   total charged.
6. Create one Stripe product/checkout for the combined total (same shape
   as today, metadata lists all involved schedule_ids and enrollment
   ids).
7. On success, stamp the same `stripe_order_id` on every row created in
   step 5 (loop, or a single `UPDATE ... WHERE id = ANY($1)`).
8. On any failure at steps 4-7, delete all rows created in step 5 for
   this attempt (mirrors today's single-row rollback-on-failure).

`guest-enroll.js` gets the same `schedule_ids` handling; the one
provisional-account/sign-in flow (steps 4-5 today) runs once regardless
of day count, then the enrollment-row-per-schedule loop runs against that
one guest account.

## Post-purchase grouping

**`complete-registration.js`**: instead of `WHERE id = $... AND user_id =
$...`, update `WHERE stripe_order_id = (SELECT stripe_order_id FROM
enrollments WHERE id = $enrollment_id AND user_id = $user_id) AND
user_id = $user_id`, applying the same field values
(`child_name`, `child_dob`, `parent_name`, etc.) to every row in the
group. Falls through to today's single-row behavior automatically when a
row's `stripe_order_id` is unique to it.

**`registration.html` / `js/registration.js`**: after fetching the
enrollment by id (as today), also fetch every row sharing its
`stripe_order_id` (skip the extra query when there is only one). Combine
their schedule/day info into one summary line (e.g. "Monday, Wednesday,
4:00-5:00 PM") instead of showing a single day. Form submission is
unchanged (still posts one `enrollment_id`; the backend resolves the
group).

**`account.html` / `js/account.js`**: after fetching all of the user's
enrollments (as today), group rows by `stripe_order_id` before rendering
cards (rows with a `null`/unique order id render as their own card, same
as today). Each grouped card lists the bundled days underneath and links
"Complete Registration" using any one row's id from the group (the
registration page resolves the rest).

## Testing

- Unit tests (plain node test files, per existing `test/` precedent):
  - Backend: `schedule_ids` validation (rejects mismatched bundle
    signatures, duplicate ids, empty array), per-day capacity rejection,
    rollback-on-failure leaves no orphaned rows, `student_id` ownership
    check rejects another parent's student.
  - Frontend: sibling-day detection reuses `campBundleQuery` grouping
    correctly for non-camp multi-day programs; single-schedule programs
    take the unchanged stepper path; `selectedScheduleIds` cannot drop
    below one selection.
  - `complete-registration.js`: updates every row sharing a
    `stripe_order_id`, does not touch rows belonging to a different order
    or a different user.
- Manual E2E check (per project standards): as a logged-in parent with an
  existing student, enroll in a class that has Mon/Wed/Fri siblings,
  check two of the three days, confirm the price breakdown and Stripe
  test-mode checkout total match `2 x price_per_class`, then confirm
  `registration.html` shows both days and one registration submission
  marks both rows complete on `account.html`. Repeat once as a guest to
  confirm the claim + registration flow still groups correctly.
