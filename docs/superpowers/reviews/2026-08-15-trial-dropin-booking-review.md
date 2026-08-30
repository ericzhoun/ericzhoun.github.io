# Pre-merge Code Review — Trial / Drop-in Booking

**Phase:** 4 — Review (self-review before merge)
**Scope:** New code for the trial-booking feature — `backend/functions/book-trial.js`,
`backend/functions/list-trial-sessions.js`, `js/trial-modal.js`, `js/api.js` (2 helpers),
`js/schedule.js` CTA, `js/admin.js` roster badge, `css/style.css`.
**Verdict:** APPROVE (one Important issue found and fixed during review)

## Critical Issues
- None.

## Important Issues
1. **Past-date booking gap (FIXED).** `book-trial.js` step 2 loaded the session with
   `status = 'scheduled'` but **no `class_date >= CURRENT_DATE` guard**. `list-trial-sessions.js`
   hides past dates, but a direct POST with a past `class_date` whose `class_sessions` row is still
   `scheduled` would have succeeded. Added `AND class_date >= CURRENT_DATE` to the session query
   and a regression test (`book-trial.test.mjs`).
2. **TOCTOU capacity race (open).** Capacity is checked (count `bookings` where `status='scheduled'`)
   then the booking is inserted — not atomic. Two near-simultaneous bookings for the same session
   could both pass the count and overbook by 1. Low risk for a free trial at current volume; if
   booking volume grows, add a serializable transaction or a DB-level guard (e.g. a deferred
   constraint / advisory lock) and re-check after insert.

## Suggestions
- **N+1 in `list-trial-sessions.js`.** It issues one `COUNT(*)` per session inside a loop. Collapse
  to a single `GROUP BY session_id` query. Minor at current scale, cleaner and cheaper as the number
  of future sessions grows.
- **One-trial-per-email ignores status.** The check is `enrollment_type='trial' AND student_email=$1`
  regardless of `status`. A *cancelled* trial still blocks that email forever. Confirm this is the
  intended policy for v1 (likely fine); if a cancelled trial should free the email, add a
  `AND status <> 'cancelled'` clause.
- **Orphan account on partial failure.** If `signup` succeeds but the `enrollments` insert fails,
  a provisional account is left with no enrollment/booking. No rollback today. Acceptable for v1;
  consider a compensating cleanup if it shows up in logs.
- **Timezone (Risk R4).** `CURRENT_DATE` is evaluated in the DB server's timezone. If the studio
  operates in a different TZ, the "today" boundary can be off by hours. Pin to studio TZ:
  `class_date >= (CURRENT_DATE AT TIME ZONE 'America/Los_Angeles')` (or the configured studio TZ).
- **Spam / abuse (Risk R5).** This is a public, unauthenticated endpoint that provisions accounts.
  The one-per-email rule only stops *repeat* use of the same email. An attacker can still
  bomb many addresses. Low severity for now (free, no payment); add rate-limiting or CAPTCHA if
  abuse appears.

## What's Done Well
- **Server-side validation is authoritative** — `book-trial` recomputes everything and never trusts
  client-supplied prices; no price tampering possible.
- **Email normalized** (trim + lowercase) before the uniqueness check — case-insensitive, correct.
- **Provisional password is random and never returned** to the client; only the magic-link `claim_url`
  is exposed. Good secret hygiene.
- **Consistent error taxonomy** (400 / 404 / 409 `CLASS_FULL` / 409 `TRIAL_ALREADY_CLAIMED` /
  409 `EMAIL_EXISTS` / 502) matches the unit tests exactly.
- **Modal uses safe DOM construction** (`createElement` / `textContent` / `createTextNode`); no API
  data is injected via `innerHTML`, so there is no XSS surface from `list-trial-sessions` responses.
- **Capacity is derived** (count of `bookings` for a `session_id`) — no denormalized counter to
  drift. Matches the plan's architecture decision.
- **Tests cover happy + every error path**; backend trial suite 8/8 after the past-date fix.

## Verification Story
- Backend trial tests: **8/8 pass** (incl. new past-date guard test).
- Schedule source tests: **13/13 pass**.
- Admin source tests: **19/19 pass** (incl. the new roster badge).
- Full suite: **218/222**; the 4 failures are pre-existing `enroll-guard`/`guest-enroll`
  `num_classes_enrolled` cap mismatches, unrelated to this feature (files not touched).
- **Not verified (env-gated):** `generate-sessions` backfill (Task 1) and the
  `enrollments.enrollment_type` migration (Task 2) require the live Butterbase environment; Task 7
  (trial→paid conversion e2e) is verification-only and also needs the live env.

## Updates (applied after review — both approved via LGTM)
- **N+1 in `list-trial-sessions.js` → RESOLVED.** Replaced the per-session `COUNT(*)` loop with a
  single `GROUP BY session_id` query using `session_id = ANY($1)` (matches the `= ANY($1)` array
  pattern already used in `guest-enroll.js`/`enroll-guard.js`). One query instead of 1+N.
- **Timezone pin (R4) → RESOLVED (consistent with repo).** Both `list-trial-sessions.js` and
  `book-trial.js` now pin the "today" boundary to UTC via
  `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`, matching the existing convention in
  `sync-student-ages.js`. No more server-TZ drift.
- Tests updated: `list-trial-sessions.test.mjs` now asserts the grouped query (`GROUP BY session_id`
  + `= ANY($1)`); `book-trial.test.mjs` past-date test asserts the UTC pin.
- Re-verified: backend trial suite **8/8**; full suite **219/223** (4 pre-existing
  `enroll-guard`/`guest-enroll` `num_classes_enrolled` failures remain, unrelated to this feature).
- Still open (suggestions, not blocking): TOCTOU capacity race, one-trial-per-email ignores status,
  orphan account on partial failure, spam/abuse rate-limiting (R5).
