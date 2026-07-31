# Admin: create parent accounts, students, enrollments, and credits - design

## Problem

Everything an admin (Olivia) can do today is scoped to data that already
exists. There is no way for an admin to onboard a family directly:

1. **Accounts** (`Butterbase auth` users) are only ever created through
   checkout - `guest-enroll.js` signs up an account for the buyer's email.
   An admin cannot create a login for a parent who paid offline, walked in,
   or is being migrated from paper records.
2. **Students** (`students` table) can be listed/updated/deleted by an admin
   via `manage-students.js`, but its `add` action hardcodes
   `user_id = ctx.user.id`, so an admin can only ever create a student owned
   by *themselves*, never one owned by a specific parent.
3. **Enrollments** (`enrollments` table) are only created through the paid
   checkout flows (`enroll-guard.js` / `guest-enroll.js`). An admin cannot
   grant a comped / manually-paid enrollment.
4. **Credits** are not stored - `account.js:111` derives them as
   `num_classes_enrolled - (bookings with status 'attended')`. There is no
   admin surface to adjust the classes a parent has paid for.

The goal: an admin can create a parent account, create/edit that parent's
students, create comped enrollments for them, and adjust the credits
(classes) on any enrollment - all from the admin CMS.

## Decisions (confirmed with the user)

- **Account access is passwordless.** The admin creates the account with an
  email only (random password nobody holds); the parent signs in later via
  the existing email-code / forgot-password flow. Same model as guest
  accounts.
- **Credits stay derived.** "Change credits" means editing an enrollment's
  `num_classes_enrolled`. No credit ledger, no schema change.
- **Admin-created enrollments are comped.** Created already `confirmed` with
  `total_paid_cents = 0` and no Stripe interaction.
- **New "Accounts" admin section.** A dedicated nav entry: list/create parent
  accounts, drill into one parent to manage their students, enrollments, and
  credits.

## Scope

In scope:
- New admin-authenticated serverless function `admin-manage.js` owning all
  privileged operations below.
- New "Accounts" section in `js/admin.js`: a parent list view and a
  per-parent detail view.
- No schema changes.

Out of scope:
- Changing how the existing admin CMS authenticates its other sections (they
  keep using the browser `adminApi` service key). This feature does **not**
  widen that surface - its sensitive writes go through the new
  admin-authenticated function instead.
- Editing/deleting parent accounts (auth users) themselves. Only creation.
- Any parent-facing UI change. `account.js` already renders derived credits
  and comped `confirmed` enrollments correctly with no change.
- Bookings/session generation. A comped enrollment grants credits; the
  parent (or admin, via the existing attendance flow) books sessions as
  usual.

## Architecture

### Why a new server-side function

Two of the four operations cannot ride the browser service key:

- **Account creation** is an auth operation (`/auth/{appId}/signup`), not a
  REST table write - the service key cannot do it. `guest-enroll` already
  does signup server-side.
- **Enrollment/credit grants** are the most sensitive writes in the app
  (free classes). They deserve a real server-side admin check rather than a
  client-side `isAdmin()` guard plus an all-powerful key shipped to the
  browser.

So all four operations move behind one function, `admin-manage.js`, deployed
`auth: required`, `allow_service_key_impersonation: false` - matching
`manage-students.js`. Every action first resolves the caller via
`/auth/{appId}/me` (using the forwarded end-user token) and rejects unless the
email is in the admin allowlist (`herfield8@gmail.com`,
`lightbyolivia@gmail.com` - the same list `manage-students.js` uses). This is
defense in depth: the frontend also guards with `isAdmin()`, but the function
never trusts that.

The frontend calls it with Olivia's JWT via the existing
`callFunction(name, body, token)` helper (`api.js`), passing
`getToken()` from `auth.js` - **not** `adminApi`.

### `admin-manage.js` actions

All actions take `{ action, ... }` JSON and return JSON. Non-admin callers
get `403` before any action runs.

- **`list-accounts`** → `{ accounts: [{ user_id, email, display_name,
  student_count, enrollment_count }] }`.
  Enumerating auth users is the one detail to confirm against Butterbase
  docs during implementation: preferred source is the Butterbase auth-admin
  "list users" endpoint (called with `SERVICE_KEY`). **Fallback if no such
  endpoint exists:** derive the parent list from distinct `user_id`s across
  the `students` and `enrollments` tables (email/display_name from those
  rows). The fallback's only gap is a freshly-created account with no
  students or enrollments yet; the create flow returns the new account so the
  UI can show it immediately even in that case. Counts always come from the
  `students` and `enrollments` tables via `ctx.db`.

- **`create-account`** `{ email, display_name }` →
  `POST /auth/{appId}/signup` with a random password (`randomPassword()`,
  copied from `guest-enroll`). Returns the new `{ user_id, email,
  display_name }`. Duplicate email → `409 { code: "EMAIL_EXISTS" }`, matching
  `guest-enroll`'s existing-email handling. The parent is told to sign in via
  the email-code flow; no password is surfaced.

- **`add-student`** `{ user_id, name, dob, notes }` and
  **`update-student`** `{ id, name, dob, notes }` → create/edit a `students`
  row owned by the given `user_id`. Reuses the DOB→age validation
  (`calculateStudentAge`) already in `manage-students.js`. This is the piece
  that `manage-students.add` cannot do (it hardcodes the admin's own id).

- **`create-enrollment`** `{ user_id, student_id, schedule_id,
  num_classes_enrolled }` → inserts one `enrollments` row:
  - `status = 'confirmed'`, `total_paid_cents = 0`, `discount_pct = 0`
  - `price_per_class_cents` read from the chosen `class_schedules` row
    (source of truth; never trusted from the client)
  - `num_classes_enrolled` from admin input (validated `>= 1`)
  - `user_id`, `student_id`, and `student_name` / `student_email` /
    `parent_name` populated from the student + account so the row reads
    consistently everywhere else (enrollments list, attendance, account page)
  - `stripe_order_id` left NULL (comped)
  Validates that `student_id` belongs to `user_id` and that `schedule_id`
  exists and is active.

- **`set-credits`** `{ enrollment_id, num_classes_enrolled, status? }` →
  `UPDATE enrollments SET num_classes_enrolled = $1 [, status = $2]
  WHERE id = ...`. Credits recompute automatically in `account.js`. Reducing
  `num_classes_enrolled` below the attended count is permitted (admin
  override) - the resulting negative balance already renders with the
  `credit-negative` style in `account.js`; the admin UI warns before saving.

### Frontend: "Accounts" section in `js/admin.js`

- New nav entry `["accounts", "Accounts"]` added to the `nav` array; routed
  in `render()` alongside the existing sections.
- **List view:** table of parents (Name / Email / # Students / # Enrollments)
  from `list-accounts`, plus a "+ New account" button opening a small form
  (email + display name) that calls `create-account`. Errors (including
  `EMAIL_EXISTS`) surface inline in the form, matching the existing
  `#form-error` pattern.
- **Detail view** (drill into one parent): shows the parent's students and
  enrollments with inline actions:
  - Add / edit student (name, DOB, notes) → `add-student` / `update-student`.
  - Create comped enrollment: pick one of the parent's students, pick a
    `class_schedules` row (program + day + time, from `adminApi` reads that
    the CMS already does), enter class count → `create-enrollment`.
  - Adjust credits on an existing enrollment: edit `num_classes_enrolled`
    (and optionally status) → `set-credits`, with a warning when the new
    value is below the attended count.
- Read-only lookups (schedules, programs, the parent's students/enrollments)
  reuse the existing `adminApi` GET reads; only the sensitive writes go
  through `admin-manage`.

## Data flow

1. Admin opens **Accounts** → `admin-manage list-accounts` (JWT) → renders
   parents + counts.
2. **New account** → `admin-manage create-account` → signup server-side →
   parent appears in the list; parent later signs in via email code.
3. Drill into a parent → read their `students` / `enrollments` via
   `adminApi` → detail view.
4. **Add student** → `admin-manage add-student` (owned by that parent).
5. **Comped enrollment** → `admin-manage create-enrollment` → `confirmed`
   row with 0 paid → parent sees credits on `account.html`.
6. **Adjust credits** → `admin-manage set-credits` → credits recompute.

## Error handling

- Every action: non-admin → `403`; malformed JSON → `400`; unknown action →
  `400`. Mirrors `manage-students.js` / `manage-account.js`.
- `create-account`: duplicate email → `409 EMAIL_EXISTS`; upstream signup
  failure → `502` with a generic message (details logged server-side).
- `add-student` / `update-student`: invalid DOB → `400`; unknown student →
  `404`.
- `create-enrollment`: unknown/inactive schedule → `404`; `student_id` not
  owned by `user_id` → `400`; `num_classes_enrolled < 1` → `400`.
- `set-credits`: unknown enrollment → `404`; `num_classes_enrolled < 0` →
  `400`.
- Frontend surfaces action errors inline in the relevant form
  (`#form-error`), or via the existing `notify()` banner on success.

## Testing

Follow the existing `test/*.test.mjs` conventions (Node's built-in test
runner; pure-logic unit tests, as the suite does for `guest-enroll`,
`manage-students`-style logic, etc.):

- Admin gate: a non-admin email is rejected (`403`) for every action.
- `create-account`: success shape; duplicate email → `EMAIL_EXISTS`.
- `add-student` / `update-student`: student is owned by the *target*
  `user_id`, not the admin; invalid DOB rejected.
- `create-enrollment`: produces a `confirmed`, `total_paid_cents = 0` row
  with `price_per_class_cents` taken from the schedule and the student/parent
  fields denormalized correctly; rejects a `student_id` not owned by
  `user_id` and an inactive schedule.
- `set-credits`: updates `num_classes_enrolled`; below-attended reduction is
  allowed and yields the expected derived (possibly negative) balance.
- Any extractable frontend helper (e.g. the below-attended warning check)
  gets a small unit test, consistent with the existing `admin-*.test.mjs`
  files.

## Deployment

`admin-manage.js` is added to `backend/functions/` and deployed via the
existing `backend/deploy.sh` (needs `BUTTERBASE_API_KEY`). A note is added to
`backend/schema-notes.md` recording the new function (no schema migration).
The function needs `SERVICE_KEY` in its environment for the auth-admin list
call, same as `guest-enroll` already uses `SERVICE_KEY`.
