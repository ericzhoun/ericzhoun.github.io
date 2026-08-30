# Admin standalone-student records: attendance, credits, and 请假 (leave) without a parent account

Date: 2026-08-29
Scope: `backend/functions/admin-manage.js`, `js/admin.js`, schema migration, tests.

## Problem

Every admin workflow for a student funneled through a parent account:

- `add-student` required `user_id`, and `students.user_id` was NOT NULL, so a
  student whose family had not signed up could not even be recorded.
- `create-enrollment` required a parent, so no enrollment (and therefore no
  credits) could exist for such a student.
- The session attendance sheet listed only pre-existing `bookings`, which are
  created by the paid-enrollment and trial flows. Comped enrollments often had
  no bookings at all, so their students could not be marked attended.
- There was no way to record an excused absence (请假). The only parent-facing
  equivalent is the ≥24h "Skip" button, which the admin could not exercise on a
  student's behalf — and never for a parentless student.

## Design

### Standalone students (parent account not created yet)

- Migration `2026-08-29-students-nullable-user-id.sql` drops the NOT NULL on
  `students.user_id`. Nothing is backfilled. RLS stays untouched: end-user
  policies compare `user_id = current_user_id()`, which never matches NULL, so
  standalone rows are invisible to parents until a `user_id` is attached.
  Service-key writes (admin-manage) already bypass RLS.
- `add-student` treats `user_id` as optional; the insert omits it entirely for
  standalone students.
- `create-enrollment` treats `user_id` as optional. With a parent, the student
  must belong to them (unchanged); without one, the student only has to exist.
  The inserted row carries `user_id` NULL — the same shape as guest
  enrollments — so later parent attachment keeps working.

### Attendance, no-show, and 请假 (leave) per enrollment

- New admin-manage action `record-session-status`
  (`{ enrollment_id, session_id, status ∈ scheduled|attended|no_show|skipped }`):
  - Validates that the session belongs to the enrollment's schedule (400
    otherwise), 404s on unknown rows, and rejects unexpected fields.
  - Updates every non-cancelled booking for the (enrollment, session) pair and
    stamps `marked_at`; a cancelled make-up stays historical and re-recording
    mints a fresh `home` booking.
  - Creates a `home` booking on demand when none exists, directly in the
    requested status. This is what makes comped/standalone enrollments visible
    on attendance sheets.
  - `skipped` is the 请假 state: not attended, so the credit is preserved by
    the existing balance formula (`credits = num_classes_enrolled − attended`).
    `no_show` consumes it. `scheduled` resets a mark.
  - The legacy `mark-attendance` booking-level action remains for
    compatibility; the UI no longer depends on a booking existing.
- The old per-booking `mark-attendance` service-function call stays deployed;
  the admin sheet simply no longer requires it.

### Admin UI (admin.html)

- **Student Roster** (replaces the enrollment-derived "Students" summary):
  reads the `students` table directly, shows each student's parent account
  (via a read-only `parent_profiles` admin-data resource) or "No account yet",
  and opens a per-student detail page.
- **Add student** form offers "No parent account yet (standalone)" — with a
  parent selected it behaves exactly as before.
- **Student detail** works for standalone and parented students: edit profile,
  comp enrollment (no parent required), edit credits, cancel enrollment, and a
  link to the parent's account page when one exists.
- **Attendance sheet** lists every confirmed enrollment of the session's
  schedule plus any active booking from other-schedule enrollments (make-ups,
  trials). Each row offers ✓ Attended, ✗ No-show, 请假 Leave, and Reset
  (after a mark), all through `record-session-status`.

## Credits semantics (unchanged formula, new reach)

`js/account.js` computes balance per enrollment as
`num_classes_enrolled − attended bookings`. Admin "credits" edits set
`num_classes_enrolled` (`set-credits`), which now also works for standalone
enrollments because they are keyed by enrollment, not by parent.

## Deployment order

1. Apply `backend/migrations/2026-08-29-students-nullable-user-id.sql` to the
   live app (env-gated; not executed by the agent).
2. `BUTTERBASE_API_KEY=*** INVITATION_GMAIL_USER_ID=*** ./backend/deploy.sh admin-manage`
3. Push the static frontend (`js/admin.js`) as usual.

If the migration is skipped, standalone creates fail closed with a generic
error (Postgres NOT NULL violation mapped to 502); parented flows are
unaffected.

## Tests

- `test/admin-manage.test.mjs`: standalone `add-student` / `create-enrollment`
  (user_id omitted; schedule-priced; ownership still enforced), and
  `record-session-status` (leave mark PATCH, booking creation, cancelled
  make-up handling, input validation, cross-schedule rejection, 404s,
  admin-data surface additions).
- `test/admin-attendance-ui.test.mjs`: the sheet's per-enrollment recording,
  the 请假 Leave action, unbooked-enrollment coverage, the roster's standalone
  path, and the student-detail wiring.
