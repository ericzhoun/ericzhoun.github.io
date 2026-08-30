# Pending parent accounts: editing families that were never onboarded

Date: 2026-08-29
Scope: `backend/functions/admin-manage.js`, `backend/functions/claim-enrollments.js`,
`js/admin.js`, schema migration, end-to-end verification script.

## Problem

`2026-08-29-admin-standalone-student-records-design.md` let the admin record a
student whose family has not signed up (`students.user_id` NULL). It stopped
short of the family itself. Today a not-yet-onboarded family is unrepresentable
in two distinct ways:

- **No account at all.** A standalone student has a NULL `user_id` and nothing
  else - there is no row anywhere holding the parent's name, phone, or
  emergency contact. Two siblings recorded standalone are not visibly one
  family. The admin UI already promises "Attach the parent account later from
  Accounts", but there is nothing to attach.
- **Account created, never used.** `create-account` mints a real auth user and
  a `parent_profiles` row, then emails an invitation. If the admin typo'd the
  name, or the parent's phone changes before they ever log in, no action can
  edit that profile: `admin-data` exposes `parent_profiles` as **read-only**
  by design, and the only writes are `create-account` and `recover-account`.

Both are the same request - let the admin maintain a family's details before
that family owns an account - so they get one design.

## Constraints discovered

- `parent_profiles.user_id` is the **primary key** and `email` is **NOT NULL,
  UNIQUE**. A parent with no auth user cannot be stored there without either
  minting a synthetic uuid (forcing a multi-table re-key at signup) or relaxing
  the table's identity. Both were rejected; see "Alternatives".
- `enrollments.student_email` is **NOT NULL**, so an enrollment cannot be
  recorded for a family whose email is unknown.
- `students.user_id` and `enrollments.user_id` are both nullable already.
- `claim-enrollments` establishes the project's precedent for attaching
  unowned rows: proof of ownership is a **verified** email from `/auth/me`,
  never a client-supplied one.

## Design

### `pending_parents` table

A placeholder family. Column names mirror `parent_profiles` so promotion is a
straight field copy rather than a mapping.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK, `gen_random_uuid()` | |
| `parent_name` | text NOT NULL | the one field always known |
| `email` | text, nullable, UNIQUE | normalized lowercase; Postgres permits many NULLs, so several no-email placeholders coexist |
| `student_phone` | text | |
| `emergency_contact` | text | |
| `allergies` | text | |
| `created_at` | timestamptz NOT NULL, `now()` | |
| `updated_at` | timestamptz NOT NULL, `now()` | |

Plus `students.pending_parent_id uuid REFERENCES pending_parents(id) ON DELETE
SET NULL`.

**Ownership invariant.** A student's owner is `user_id` **xor**
`pending_parent_id`. Neither set remains legal - that is today's bare
standalone student, still supported. Both set is rejected at the action layer.
`ON DELETE SET NULL` means deleting a placeholder degrades its students to bare
standalone rather than deleting children.

**RLS.** Enabled with **no end-user policies at all**, plus a
`pending_parents_service_bypass` policy. Placeholders are admin-only data and
are unreachable from any parent session - the same posture that keeps
`parent_profiles` writes behind dedicated actions.

Applied through the declarative `POST /schema/apply` with the complete schema
from `GET /schema` (the endpoint treats omitted tables as drops), and recorded
in `backend/schema-notes.md`.

### admin-manage actions

- **`create-pending-parent`** `{ parent_name, email?, student_phone?,
  emergency_contact?, allergies? }`. Name required. Email normalized; if it
  already belongs to a `parent_profiles` row, respond 409 naming the existing
  account rather than creating a placeholder that shadows it.
- **`update-pending-parent`** `{ id, ...fields }`. Patches any field including
  email. Same 409 shadowing check when an email is being set.
- **`update-account`** `{ user_id, parent_name?, student_phone?,
  emergency_contact?, allergies? }`. Patches `parent_profiles` for a real
  account. **Email is deliberately not editable here**: `resend-invitation`
  treats the stored profile as authoritative precisely so an admin browser
  cannot redirect account messages, and changing the profile email alone would
  desync it from the auth identity. A wrong email on a real account is fixed by
  creating a new account, not by editing this one.
- **`promote-pending-parent`** `{ id }`. The admin now has the email. Requires
  the placeholder to have one; reuses `createAccount` for the auth user and
  invitation, then runs the shared merge routine below.
- **`add-student`** accepts optional `pending_parent_id`, rejected with 400 if
  `user_id` is also present.
- **`create-enrollment`** accepts `pending_parent_id`. Because
  `enrollments.student_email` is NOT NULL, enrolling a placeholder's student
  requires an email - from the placeholder, or supplied in the request, which
  also writes it back to the placeholder. A no-email placeholder can hold
  students and notes but cannot be enrolled until an email exists.
- **`list-accounts`** unions `parent_profiles`-derived accounts with
  `pending_parents`, tagging each row `kind: "account" | "pending"`. Placeholder
  rows carry `pending_parent_id` where real rows carry `user_id`, and count
  their students through `students.pending_parent_id`.
- **`admin-data`** adds `pending_parents` as a **read-only** resource, matching
  the existing `parent_profiles` posture - writes stay behind the actions above
  so the admin JWT can never write contact data directly.

### Merge routine (shared)

One routine, two callers, so both onboarding paths converge:

1. Upsert `parent_profiles` for the target `user_id`, filling **only fields the
   parent has not already set**. A profile the parent has since edited is never
   clobbered by stale placeholder data.
2. `UPDATE students SET user_id = $user, pending_parent_id = NULL WHERE
   pending_parent_id = $placeholder`.
3. Delete the placeholder.

Steps run in a single transaction, so a partial failure cannot strand students
pointing at a deleted placeholder.

### Self-serve claim

`claim-enrollments` gains a second step after its existing enrollment `UPDATE`,
keyed on the same proof it already requires - the verified email from
`/auth/me`:

- Look up a `pending_parents` row by `lower(email)`. None → done, behavior
  unchanged.
- Otherwise run the merge routine for the calling user.

Idempotent: a second run finds no placeholder. The response gains a
`claimed_students` array alongside the existing `claimed` enrollment ids.

### Admin UI (`js/admin.js`)

- The Accounts list renders both kinds; placeholders reuse the existing
  `No account yet` badge.
- One parent form serves both: real accounts render email read-only with a note
  explaining why, placeholders render it editable.
- Placeholder rows get **Promote to account**, disabled with a stated reason
  until an email is present. Real never-logged-in rows keep **Resend
  invitation**.
- The student form's parent dropdown lists placeholders alongside accounts, so
  `No parent account yet (standalone)` becomes a choice of family rather than a
  void.

## Alternatives considered

- **Synthetic `user_id` in `parent_profiles`.** A placeholder becomes an
  ordinary profile row keyed by a uuid no auth user owns, so `students.user_id`
  and every existing admin action work unchanged. Rejected: onboarding requires
  rewriting the `parent_profiles` primary key plus `students.user_id` and
  `enrollments.user_id` from the synthetic uuid to the real one - a multi-table
  re-key, racy against a parent mid-signup. The plumbing cost of a second id
  kind is bounded and one-time; the re-key is neither.
- **Parent contact fields on `students`.** No new table, and claiming is the
  one-line email match that already exists. Rejected: it produces no parent
  entity to edit - the actual feature - and duplicates contact details across
  siblings.

## Testing

The backend functions have no test harness, so verification is a scripted
end-to-end run against the live app with the service key, asserting DB state
through the REST API at each step and cleaning up its own rows:

1. Create a placeholder, add two students to it, edit the placeholder.
2. Attempt to enroll with no email recorded → rejected; supply one → succeeds.
3. Sign up as that email and verify → both students carry the new `user_id`,
   `pending_parent_id` is NULL, `parent_profiles` is populated, placeholder
   gone.
4. Re-run the claim → no change (idempotence).

Negative cases: a placeholder email shadowing an existing account 409s;
`user_id` and `pending_parent_id` together is rejected; a placeholder deleted
while holding students leaves those students bare standalone, not deleted.

Verified separately by hand: a parent session cannot read `pending_parents`.
