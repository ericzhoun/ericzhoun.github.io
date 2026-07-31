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

## 2026-07-31 - admin-manage runs as service (no migration)

- `admin-manage` redeployed with http trigger `auth: none`. `students` and
  `enrollments` carry user-isolation RLS (`USING`/`WITH CHECK` on
  `user_id = current_user_id()`), so with `auth: required` the function ran as
  `butterbase_user` and could not read other parents' rows or insert rows owned
  by them - the accounts grid came back empty and every cross-parent write
  would have failed. `ctx.db` only binds `butterbase_service` (which the
  `*_service_bypass` policies admit) when the request carries no end-user JWT
  in `Authorization`; sending one re-enables RLS even on an `auth: none`
  function (verified empirically).
- The admin JWT therefore travels in `X-Admin-Token`, and `requireAdmin`
  verifies it against `/auth/{appId}/me` plus the admin allowlist. The endpoint
  is publicly reachable, so that check is the only gate and fails closed.
  `ctx.user` is null here and is never treated as a credential.

## 2026-07-30 - admin-manage function (no migration)

- New `admin-manage` function (`auth: required`,
  `allow_service_key_impersonation: false`). Admin-only, gated on the admin
  email allowlist server-side. Actions: `list-accounts` (derived from
  `students` + `enrollments`; the auth `app_users` table is not reachable
  from a function), `create-account` (passwordless signup), `add-student` /
  `update-student` (for any parent by `user_id`), `create-enrollment`
  (comped: `confirmed`, `total_paid_cents = 0`), `set-credits` (edits
  `num_classes_enrolled`). No schema change.
