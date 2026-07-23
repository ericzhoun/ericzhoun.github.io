# Enroll page: split "Number of classes" into "Class Time" + independent class count - design

## Problem

The enroll page's pricing section has one row, labeled "Number of classes",
that does two unrelated jobs depending on mode:

- Single-schedule (today's common case): a +/- stepper on `state.numClasses`
  (`js/enroll.js:199-217`), default 8, capped at `program.num_classes || 8`.
- Multi-day (2+ sibling schedules on different days, from the 2026-07-22
  spec): day-of-week checkboxes (`js/enroll.js:181-198`). The number of
  classes purchased is *derived* from how many days are checked
  (`getNumClasses()`, `js/enroll.js:40-43`) - there is no independent class
  count in this mode.
- Camp: a fixed, non-adjustable span. Unchanged by this spec.

This conflates two different decisions: *which weekly time slot(s)* a
student attends, and *how many total class sessions* they are buying. The
label is also misleading in multi-day mode, where it's really a day
picker.

## Scope

In scope:
- Rename the day-part picker to **"Class Time"**. It always shows the
  matched day-part(s) (today's `campBundleQuery`/`looseBundleQuery`
  matching logic is unchanged): a read-only slot when there's exactly one
  match, or the existing checkboxes when there are 2+.
- Add an independent **"Number of Classes"** stepper: default 15, minimum
  10, applies to both single-schedule and multi-day (non-camp) modes.
- Backend: distribute the "Number of Classes" total evenly across however
  many Class Time day-parts are selected, replacing today's "1 session per
  selected day" multi-day pricing.
- Cap the stepper at `max(program.num_classes || 15, 15)` so the default
  of 15 is always reachable, while a program configured for more sessions
  than 15 still can't be oversold beyond its configured count.

Out of scope:
- Camp programs: unchanged (fixed `campDays`, fixed non-adjustable count).
- The "Day" / "Time" detail rows above the pricing section
  (`js/enroll.js:129-144`). They keep showing today's summary. For the
  single-schedule case this means the Time row and the new read-only
  Class Time row both show the same slot - accepted as a minor
  redundancy rather than removing/merging those rows, since this spec is
  scoped to the pricing section. Flagging this now in case you'd rather
  fold Class Time into the existing Day/Time rows instead.
- Any change to the early-bird threshold or percentage
  (`EARLY_BIRD_MIN_CLASSES = 15`, `EARLY_BIRD_PCT = 10` in
  `js/pricing.js` and duplicated in both backend functions) - the new
  default of 15 classes happens to land exactly on the early-bird
  threshold, which is a deliberate, convenient coincidence, not a change
  to the threshold itself.
- Guest vs. logged-in enrollment flow, student/parent name handling,
  registration/account grouping: all from the 2026-07-22 spec, unchanged.

## Frontend: `js/enroll.js`

### State

- `state.numClasses` default changes from `8` to `15` (`js/enroll.js:24`).
- No new state field needed for the split itself - `state.numClasses` now
  means "total sessions," full stop, in every non-camp mode.
  `state.selectedScheduleIds` (multi-day) continues to mean "which
  day-parts," independently.

### "Class Time" row (replaces today's day-checkbox block at lines 181-198)

Always rendered for non-camp schedules, regardless of how many siblings
matched:

- Exactly one matched schedule (today's common case, no siblings): a
  read-only `<span>` showing `${schedule.day_of_week}
  ${formatTime(schedule.start_time)}-${formatTime(schedule.end_time)}`.
- 2+ matched schedules: today's checkboxes, relabeled under "Class Time"
  instead of "Number of classes" - unchanged behavior (toggle
  `state.selectedScheduleIds`, minimum one day stays checked by disabling
  its checkbox, as today).

Camp: unchanged fixed `campDays` display, under whatever label the camp
branch already uses (no rename needed there - "not adjustable" note stays
as-is).

### "Number of Classes" row (new; replaces the old dual-purpose row's
stepper-only branch at lines 199-217, now shown for BOTH single-schedule
and multi-day non-camp modes)

- Same `.num-classes-control` +/- stepper UI as today.
- `minClasses = 10`, floored further down only if `getSelectedDayCount()`
  (see below) exceeds 10, which cannot happen in practice (at most 7
  weekdays) but is clamped defensively: `effectiveMin =
  Math.max(10, dayCount)`.
- `maxClasses = Math.max(program?.num_classes || 15, 15)` (was
  `program.num_classes || 8`).
- Buttons: minus disabled at `state.numClasses <= effectiveMin || isFull`;
  plus disabled at `state.numClasses >= maxClasses || isFull`.
- Not shown for camps (unchanged - camp's count stays fixed/non-adjustable
  as today).

### `getNumClasses()` (`js/enroll.js:40-43`)

Simplifies to just `return state.numClasses;` in every mode (camp already
sets `state.numClasses` directly to the bundle size on load and never
lets it change). The multi-day special case
(`Math.max(1, state.selectedScheduleIds.size)`) is removed - day count and
class count are no longer the same number.

### Submission (`handleEnroll`)

- Multi-day mode now also sends `num_classes_enrolled: state.numClasses`
  alongside `schedule_ids` (today it sends neither - server derived the
  count from array length). Single-schedule mode is unchanged (already
  sends `num_classes_enrolled`).

## Backend: `enroll-guard.js` / `guest-enroll.js`

Both files have near-identical single-schedule and `handleMultiDay`
blocks; the same two changes apply to both files, both blocks.

### Single-schedule path (`enroll-guard.js:44-46`, `guest-enroll.js:50-52`)

```js
// before
const maxClasses = schedule.program_num_classes || 8;
if (!Number.isFinite(numClasses) || numClasses < 1) numClasses = maxClasses;
numClasses = Math.min(numClasses, maxClasses);

// after
const maxClasses = Math.max(schedule.program_num_classes || 15, 15);
if (!Number.isFinite(numClasses) || numClasses < 10) numClasses = 15;
numClasses = Math.min(numClasses, maxClasses);
```

(A client sending an out-of-range value, e.g. 3, is *not* rejected with an
error - it's clamped to 10, same defensive posture as today's clamp-not-
reject handling of an oversized value.)

### Multi-day path (`handleMultiDay` in both files)

Today: `const numClasses = schedules.length;` (one session per selected
day, no client input consulted). Replace with:

```js
const maxClasses = Math.max(schedules[0].program_num_classes || 15, 15);
let numClasses = parseInt(body.num_classes_enrolled, 10);
const minClasses = Math.max(10, schedules.length);
if (!Number.isFinite(numClasses) || numClasses < minClasses) numClasses = Math.max(15, minClasses);
numClasses = Math.min(numClasses, maxClasses);
```

Then distribute evenly across the sorted schedule list (sort by `id`
ascending for a deterministic, order-independent split - the client may
send `schedule_ids` in click order, not day order):

```js
schedules.sort((a, b) => a.id - b.id);
const n = schedules.length;
const base = Math.floor(numClasses / n);
const remainder = numClasses % n;
// first `remainder` schedules (by id) get one extra session
const classesForRow = (i) => base + (i < remainder ? 1 : 0);
```

Pricing: `subtotal = perClass * numClasses` (unchanged formula, now
using the distributed total instead of `schedules.length`).
`isEarlyBird` / `discountAmount` / `total` unchanged formulas, now driven
by the real total.

Per-row insert changes from hardcoded `num_classes_enrolled = 1` to
`classesForRow(i)`, and `rowTotal` is computed per row's own class count
rather than an equal split, with the existing last-row-absorbs-rounding
pattern kept (now absorbing against the row's own `perClass *
classesForRow(i)` discounted amount, not a flat `perDayDiscounted`):

```js
const perClassDiscounted = perClass - Math.round((perClass * (isEarlyBird ? ebPct : 0)) / 100);
// ...in the insert loop:
const rowClasses = classesForRow(i);
const isLast = i === n - 1;
const rowTotal = isLast
  ? total - runningTotal   // absorbs rounding remainder
  : perClassDiscounted * rowClasses;
runningTotal += rowTotal;  // accumulated across the loop, start at 0
```

`num_classes_enrolled` column for row `i` becomes `rowClasses` (was
hardcoded `1`). Everything else in the insert (schedule_id, user_id,
student fields, price_per_class_cents, discount_pct) is unchanged.

Product/checkout metadata (`num_classes`, `total_cents`, etc.) already
reads from the recomputed `numClasses`/`total` variables, so no further
change needed there beyond what's shown above.

### Validation added

- `schedule_ids` structural checks (non-empty, no duplicates, shared
  bundle signature, per-day capacity) are unchanged from the 2026-07-22
  spec.
- No new rejection path for `num_classes_enrolled` - out-of-range values
  are clamped as described above, matching the single-schedule path's
  existing behavior (never a 400 for this field).

## Testing

- Unit tests (backend): single-schedule path clamps below 10 up to 15 and
  above `maxClasses` down to `maxClasses`; multi-day path splits a given
  `num_classes_enrolled` evenly across 2 and 3 schedules (even and
  uneven splits, e.g. 15 across 2 = 8+7), remainder always lands on the
  lowest-id schedule(s), row totals sum exactly to the overall `total`
  (no lost/extra cent), early-bird applies once to the combined total
  when the total (not day count) crosses 15.
- Unit tests (frontend): `getNumClasses()` returns `state.numClasses` in
  all three modes; Class Time read-only display appears with exactly one
  match, checkboxes with 2+; stepper min/max clamp correctly including
  the `program.num_classes` interaction.
- Manual E2E: as a logged-in parent, open a class with Mon/Wed siblings,
  confirm "Class Time" shows both day checkboxes (both checked by
  default per existing behavior) and a separate "Number of Classes"
  stepper defaulting to 15; drop to 12, confirm price = 12 x
  price_per_class with no early-bird; raise to 15+, confirm early-bird
  applies; uncheck one day, confirm Class Time still shows one slot and
  price/count is unaffected by the day selection; complete Stripe
  test-mode checkout and confirm the two `enrollments` rows'
  `num_classes_enrolled` sum to the stepper value and their
  `total_paid_cents` sum to the exact total charged.
