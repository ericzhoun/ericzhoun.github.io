# Schema migration notes

Applied via `POST /v1/app_48ul5eszfv7v/schema/apply` (full-schema declarative
payload; the endpoint treats omitted tables as drops and refuses them without
`_drop`, so always send the complete schema from `GET /schema`).

## 2026-07-15 - guest checkout (migration_id 21)

- `enrollments.user_id` made nullable (guest enrollments are unclaimed until
  the buyer verifies their email).
- `idx_enrollments_order`: unique index on `enrollments.stripe_order_id`
  (duplicate-webhook safety; Postgres unique indexes permit multiple NULLs).
- `idx_enrollments_email`: index on `enrollments.student_email` (claim query).

## 2026-07-16 - schedule session type

- Added nullable `class_schedules.session_type` (`text`). New schedules store
  `standard`, `extended`, or `full`; existing schedules continue to infer the
  session type from their start and end times.

## 2026-07-16 - students + artwork_photos (migration_id 23)

- New `students` table: parent-owned child profiles (`user_id`, `name`, `age`,
  `dob`, `notes`). RLS user-isolation on `user_id` with auto-populate trigger.
- New `artwork_photos` table: photo metadata (`student_id` -> students CASCADE,
  `storage_object_id` durable Butterbase Storage objectId, `caption`,
  `uploaded_by`). RLS enabled with a SELECT policy that lets a parent read
  rows whose student they own (`EXISTS students.user_id = current_user_id()`).
  Writes go through the `manage-artwork` function (service role) so the parent
  never needs direct INSERT/DELETE on this table.
- New functions: `manage-account`, `manage-students`, `manage-artwork`
  (all `auth: required`, `allow_service_key_impersonation: false`).

## 2026-07-16 - enrollment student association (migration_id 28)

- Added nullable `enrollments.student_id` foreign key to `students.id` with
  `ON DELETE SET NULL`, plus `idx_enrollments_student` for student enrollment
  lookups. Existing enrollments remain intact until their parent associates
  them from the account page.

## 2026-07-19 - camp program type (migration_id 29)

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

## 2026-07-31 - admin-manage reads/writes via SERVICE_KEY (no migration)

- `students` and `enrollments` carry user-isolation RLS (`USING`/`WITH CHECK`
  on `user_id = current_user_id()`). `admin-manage` originally used `ctx.db`,
  which binds `butterbase_user` whenever the request carries an end-user JWT,
  so the admin could only ever see her own rows: the accounts grid came back
  empty and every cross-parent write would have been rejected by `WITH CHECK`.
- `ctx.db` binds `butterbase_service` only when no JWT is present - true even
  on an `auth: none` trigger (verified with a probe function). Passing the
  token in a custom header to avoid that fails in browsers: Butterbase's CORS
  allowlist is fixed at `Content-Type, Authorization, X-Signup-Source,
  X-Signup-Referrer, X-Organization-Id, X-Butterbase-As-User`, so a custom auth
  header fails the preflight ("Failed to fetch").
- Resolution: the trigger stays `auth: required` with the admin JWT in
  `Authorization`, and every read/write goes through the REST data API with
  `SERVICE_KEY` (which the `*_service_bypass` policies admit), as
  `guest-enroll` already does for billing. `ctx.db` is no longer used by this
  function, and it now requires `SERVICE_KEY` in its environment.

## 2026-07-30 - admin-manage function (no migration)

- New `admin-manage` function (`auth: required`,
  `allow_service_key_impersonation: false`). Admin-only, gated on the admin
  email allowlist server-side. Actions: `list-accounts` (derived from
  `students` + `enrollments`; the auth `app_users` table is not reachable
  from a function), `create-account` (passwordless signup), `add-student` /
  `update-student` (for any parent by `user_id`), `create-enrollment`
  (comped: `confirmed`, `total_paid_cents = 0`), `set-credits` (edits
  `num_classes_enrolled`). No schema change.

## 2026-07-31 - parent profiles (migration_id 30; policy migrations 31-33)

- New `parent_profiles` table is the durable parent identity and contact source
  of truth. Columns: `user_id` (`uuid`, primary key, not null), `email` (`text`,
  not null, unique), `parent_name` (`text`, not null), nullable text fields
  `student_phone`, `emergency_contact`, and `allergies`, plus `created_at` and
  `updated_at` (`timestamptz`, not null, default `now()`).
- The initially applied RLS state allows end-user SELECT, INSERT, and UPDATE.
  That state is superseded by the required select-only policy migration below.
- `parent_profiles_service_bypass` grants only `butterbase_service` all
  operations with `USING (true) WITH CHECK (true)` for trusted administrative
  and synchronization work.

## 2026-08-01 - required parent profile policy hardening (not applied)

- Desired end-user state: own-row SELECT only, using
  `user_id = current_user_id()::uuid`. End users must have no INSERT, UPDATE,
  DELETE, or ALL policy on `parent_profiles`.
- Desired trusted state: retain the table-scoped `butterbase_service` bypass.
- The idempotent, pause-protected live migration and rollback procedure is in
  `backend/migrations/2026-08-01-parent-profiles-select-only-policy.md`.
- This repository change does not apply or mutate the live policy state.
