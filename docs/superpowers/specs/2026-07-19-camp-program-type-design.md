# Camp program type - design

## Problem

Today every `programs` row is a regular weekly class: a parent picks a
schedule (one `class_schedules` row = one day of the week + time), and buys
between 1 and `program.num_classes` occurrences of that single weekly slot.

We want a second program type, "camp": a bundle of several weekdays (e.g.
Monday-Friday, same time each day) sold as one unit at one bundle price
(e.g. $70/day x 5 days = $350). On the public schedule grid it should show
as a single block instead of one block per day. On the enroll page, "Day"
shows the full list of bundled days, and the number of classes equals the
bundle size and cannot be changed by the parent.

## Scope

In scope:
- New `program_type` on `programs` (`class` | `camp`).
- Public schedule page: camps render as one spanning block per bundle.
- Enroll page: camps show the bundled day list and a locked class count.
- Admin: a Program Type field on the program form.

Out of scope (explicitly deferred):
- `class_sessions` / attendance / makeup-class booking for camps. Camps are
  enroll-and-pay only for now, same as the day before generate-sessions
  support existed for regular classes.
- Any change to `enroll-guard`, `guest-enroll`, `stripe-webhook`,
  `generate-sessions`, `book-class`, or `mark-attendance`. Pricing already
  works as `price_per_class_cents x num_classes_enrolled`, which is exactly
  the bundle total when `num_classes_enrolled` is fixed at the bundle size.
  Camps recur weekly across the semester the same way regular classes do
  (a new bundle instance every week the semester's schedule runs), not as a
  one-off dated event.

## Data model change

Add one column:

```sql
ALTER TABLE programs ADD COLUMN program_type text NOT NULL DEFAULT 'class';
```

Allowed values: `'class'`, `'camp'`. No other schema changes. A camp's
Monday-Friday rows are ordinary `class_schedules` rows created today via the
admin's existing multi-day schedule form (it already POSTs one row per
selected day with identical program/time/price/etc.) - we are not adding a
`bundle_id` column. Instead, rows are grouped for display/enrollment
purposes by a shared key computed from fields that are already identical
across a bundle:

`program_id, semester_id, session_type, start_time, end_time, age_group, price_cents, max_seats`

This key is implemented once in `js/api.js` as `scheduleBundleKey(schedule)`
and reused by `schedule.js` and `enroll.js`. Bundle size (number of classes,
displayed days) is *derived* from how many rows share the key - it is not
read from `program.num_classes`. `program.num_classes` still matters as the
backend's enrollment cap (see "Pricing and the num_classes cap" below), so
the admin form gets a hint to set it to at least the bundle's day count for
camp programs.

## Public schedule grid (`schedule.js`)

Today the grid loops `time -> day`, rendering one `<a class="calendar-class">`
per `class_schedules` row that falls in that day/time cell.

For camp bundles: group all schedules for the active semester by
`scheduleBundleKey`. For any group belonging to a camp program (size > 1,
`program.program_type === 'camp'`), render **one** block instead of one per
day:

- Position: the time row of the bundle's `start_time`.
- Span: `grid-column` from the earliest bundled day to the latest bundled
  day (Mon..Sun ordering), so a Mon-Fri bundle visually spans those 5
  columns as one wide block. (Simplifying assumption: if a camp's bundled
  days are non-contiguous, e.g. Mon/Wed/Fri, the block still spans from the
  earliest to the latest day, covering the gap - camps in practice are
  contiguous weekday blocks.)
- Content: program name, time range, age group, and the price breakdown
  `$<perClass> x <N> days = $<total>` (using existing `formatPrice`).
- The individual day cells covered by the span are skipped (not rendered as
  separate empty cells) when building that row.

This requires switching the grid-building loop from implicit DOM-order grid
placement to explicit `grid-column` indices per day cell, since spanning
requires knowing exactly which column a block starts at.

Non-camp programs render exactly as they do today - untouched code path.

**Mobile list**: currently grouped by day, one card per schedule per day.
For a camp bundle, render one card under the bundle's earliest day (not
once per day), with the day list and bundle price on the card.

## Enroll page (`enroll.js`)

After loading `state.schedule` and `state.program` as today: if
`state.program.program_type === 'camp'`, fetch sibling rows sharing the
bundle key (same `program_id`, `semester_id`, `session_type`, `start_time`,
`end_time`, `age_group`, `price_cents`, `max_seats`, `active=true`) via a
REST query. From that set:

- `state.campDays` = sorted list of `day_of_week` values (Mon..Sun order).
- `state.numClasses` is set to `campDays.length` once, on load, and is
  **not** adjustable afterward.

Rendering changes, camp-only:
- "Day" detail row shows `campDays.join(", ")` instead of the single
  `schedule.day_of_week`.
- The number-of-classes stepper (+/- buttons) is not rendered; instead a
  plain, non-interactive value is shown (e.g. "5 (Monday-Friday, all days
  included)").
- Pricing breakdown math is unchanged (`pricePerClass * numClasses`,
  early-bird logic unchanged) - it already produces the correct bundle
  total.

Non-camp programs render exactly as they do today.

## Pricing and the num_classes cap

`enroll-guard` and `guest-enroll` both clamp the client-sent
`num_classes_enrolled` to `program.num_classes` (`Math.min(numClasses,
maxClasses)`). Since the frontend now sends `numClasses = bundle size` for
camps, `program.num_classes` must be set to a value >= the bundle's day
count, or the backend will silently under-charge/under-count. This is a
data-entry responsibility, not a code path - the admin Programs form adds
inline help text: "For camp programs, set this to the number of days in
each camp bundle (e.g. 5 for Mon-Fri)." No backend changes.

## Admin (`admin.js`)

Add a "Program Type" field to the `programs` form fields list: a `select`
with options Class / Camp, defaulting to Class. Stored as `program_type`.
Add the num_classes hint described above next to the "Number of Classes"
field, shown only when Program Type is Camp (simple client-side
show/hide, no new component).

No changes to the schedule form - multi-day creation already exists and is
exactly how camp bundles get created (pick the program, pick Mon-Fri, pick
one time/price/capacity).

## Testing

- Unit tests (existing `test/` uses plain node test files per
  `test/bake-schedule.test.mjs` as precedent):
  - `scheduleBundleKey` groups rows with matching fields and separates rows
    that differ in any one field.
  - Camp grid grouping: given a semester's schedules, camp bundles collapse
    to one entry per bundle with the correct day span and total price;
    non-camp schedules pass through unchanged.
  - Enroll page camp path: given a schedule + sibling rows, day list is
    sorted Mon..Sun, `numClasses` locks to bundle size, pricing total
    matches `perClass * bundleSize` with early-bird applied correctly.
- Manual E2E check (per project standards): create a camp program + Mon-Fri
  schedule bundle in a test environment, verify the schedule grid shows one
  spanning block with the right price text, click through to enroll.html
  and confirm the day list/locked count/total, and confirm checkout still
  succeeds end-to-end (Stripe test mode) exactly like a regular class does
  today, since the backend functions are unmodified.
