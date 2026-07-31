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

### Platform constraints (verified against Butterbase docs)

Butterbase's auth service exposes only end-user self-service routes plus an
admin surface (MCP `manage_auth_users`) limited to **list** and irreversible
**delete**. Confirmed facts that shape this design:

- There is **no** endpoint to update a user's `display_name` after signup,
  and **no** endpoint to disable/re-enable (reversibly deactivate) a user.
- The auth `app_users` table is **not** reachable from a serverless function
  via `ctx.db` (it lives in the auth service, not the app database - a
  `select_rows` on `app_users` returns `TABLE_NOT_FOUND`).
- Therefore admin **rename** and **reversible deactivate** of accounts are
  not buildable and are out of scope (the user chose to drop both rather than
  adopt app-level substitutes). Enumerating accounts is done by deriving from
  app tables, not an auth-admin list call (see `list-accounts`).

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
- Editing, renaming, deactivating, or deleting parent auth accounts (see
  Platform constraints above - not supported by Butterbase). Accounts are
  only created; never mutated or removed.
- Any parent-facing UI change. `account.js` already renders derived credits
  and comped `confirmed` enrollments correctly with no change.
- Bookings/session generation. A comped enrollment grants credits; the
  parent (or admin, via the existing attendance flow) books sessions as
  usual.

## Architecture

### Why a new server-side function

Two concerns keep these operations off the browser service key:

- **Account creation** is an auth operation (`/auth/{appId}/signup`), not a
  REST table write - the service key cannot do it. `guest-enroll` already
  does signup server-side.
- **Enrollment/credit grants** are the most sensitive writes in the app
  (free classes). They deserve a real server-side admin check rather than a
  client-side `isAdmin()` guard plus an all-powerful key shipped to the
  browser.

So all four operations move behind one function, `admin-manage.js`.

**Trigger auth and the RLS constraint (corrected 2026-07-31).** The function is
deployed `auth: none`, not `auth: required`. `students` and `enrollments` carry
user-isolation RLS policies (`USING` and `WITH CHECK` on
`user_id = current_user_id()`), so an admin running as `butterbase_user` can
neither read another parent's rows nor insert rows owned by them - which is the
entire feature. `ctx.db` only binds `butterbase_service` (admitted by the
`*_service_bypass` policies) when the request carries **no** end-user JWT in
`Authorization`; supplying one re-enables RLS even on an `auth: none` function.
This was verified empirically with a throwaway probe function: no auth header →
`butterbase_service`, all rows visible; valid JWT → `butterbase_user`, RLS
enforced.

The admin's token therefore travels in the **`X-Admin-Token`** header, and
`requireAdmin` verifies it against `/auth/{appId}/me` and requires the returned
email to be in the admin allowlist (`herfield8@gmail.com`,
`lightbyolivia@gmail.com`). Because the endpoint is publicly reachable, that
check is the only gate: it fails closed on a missing token, an unverifiable
token, a non-allowlisted email, or a network error, and `ctx.user` (always null
here) is never treated as a credential. `trigger-schedule-bake` uses the same
`auth: none` plus self-authorization pattern.

*Accepted tradeoff:* this gives up the edge's built-in auth rejection in
exchange for service-role data access. The alternative that keeps both -
`auth: required` for the edge check plus `SERVICE_KEY` REST calls for every
read and write - would require re-expressing all six actions (including the
`list-accounts` aggregate) as REST calls with JS-side aggregation. Worth
revisiting if this endpoint's blast radius grows.

The frontend calls it via `callFunction(name, body, token, extraHeaders)`
(`api.js`) with `token` explicitly `null` and the freshly refreshed JWT in
`X-Admin-Token` - **not** `adminApi`.

### `admin-manage.js` actions

All actions take `{ action, ... }` JSON and return JSON. Non-admin callers
get `403` before any action runs.

- **`list-accounts`** → `{ accounts: [{ user_id, email, name,
  student_count, enrollment_count }] }`. Because the auth `app_users` table is
  not reachable from a function (see Platform constraints), the parent list is
  **derived from app tables**: the union of distinct `user_id`s across the
  `students` and `enrollments` tables, with `email`/`name` taken from those
  rows (`enrollments.student_email` / `parent_name`, or a `students` row) and
  `student_count` / `enrollment_count` aggregated per `user_id` via `ctx.db`.
  The only gap is a freshly-created account with zero students and zero
  enrollments; `create-account` returns the new account so the UI can show it
  immediately, and it reappears permanently as soon as it has any student or
  enrollment. A single SQL query with `FULL OUTER JOIN` / `UNION` over the two
  tables produces the list.

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
- **Detail view** (drill into one parent): a header with the parent's name and
  email, then their students and enrollments with inline actions:
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
- `list-accounts`: two parents with mixed students/enrollments aggregate to
  the correct per-`user_id` counts; a parent with only students (no
  enrollments) and one with only enrollments both appear.
- Any extractable frontend helper (e.g. the below-attended warning check)
  gets a small unit test, consistent with the existing `admin-*.test.mjs`
  files.

## Deployment

`admin-manage.js` is added to `backend/functions/` and deployed via the
existing `backend/deploy.sh` (needs `BUTTERBASE_API_KEY`). A note is added to
`backend/schema-notes.md` recording the new function (no schema migration).
The function needs `BUTTERBASE_APP_ID` and `BUTTERBASE_API_URL` for the
`/auth/{appId}/signup` and `/auth/{appId}/me` calls (same env vars
`guest-enroll` / `manage-account` already rely on). No `SERVICE_KEY` is
required - all reads/writes other than signup go through `ctx.db`, and account
enumeration is derived from app tables rather than an auth-admin call.
