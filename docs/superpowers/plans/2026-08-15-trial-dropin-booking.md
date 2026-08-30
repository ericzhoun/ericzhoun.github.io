# Implementation Plan: Trial / Drop-in Booking

**Spec:** `docs/superpowers/specs/2026-08-15-trial-dropin-booking-design.md`
**Approach:** Vertical slices — each slice delivers one working, testable path
(read dates → book trial → admin visibility) rather than building all DB, then all API,
then all UI.

## Architecture Decisions
- Reuse `class_sessions` + `bookings` for dated capacity; add only one column
  (`enrollments.enrollment_type`). No new tables.
- Per-date availability is *derived* (count `bookings` for a `session_id`) — no
  denormalized counter to keep in sync.
- Free trial provisions a provisional account (mirrors `guest-enroll`) so conversion to
  paid later reuses the existing flow.

## Task List

### Phase 1 — Foundation (read path + data readiness)

- [ ] **Task 1: Ensure dated sessions + capacity data exist** _(BLOCKED: live app `app_0otd4vmczvu8` is catalog-only — 0 enrollments / 0 bookings, so `generate-sessions` backfill is a no-op; AND the function cannot be invoked because the shared `bb_sk_…` key is a data (read) key, not the management/service key `deploy.sh` needs)_
  - **Description:** Confirm `class_sessions` are generated for active Fall 2026
    schedules; run `generate-sessions` to backfill `'home'` bookings for already-confirmed
    weekly enrollments so per-date capacity is accurate.
  - **Acceptance:** For each active schedule, `class_sessions` rows exist for future
    dates; `bookings` of type `'home'` exist for confirmed enrollments.
  - **Verify:** SQL spot-check in staging; `node --test test/bake-schedule.test.mjs` still green.
  - **Dependencies:** None (do first — everything depends on real session data).
  - **Files:** `backend/functions/originals/generate-sessions.js` (run, not edited).
  - **Size:** S (operational)

- [x] **Task 2: Add `enrollments.enrollment_type` column (migration)** _(VERIFIED in live app — `GET enrollments?select=enrollment_type` returns HTTP 200, so the column already exists; migration SQL retained at `backend/migrations/2026-08-15-add-enrollment-type.sql` for the record)_
  - **Description:** Apply the additive migration (default `'standard'`).
  - **Acceptance:** Column present; existing rows read as `'standard'`; insert of
    `enrollment_type='trial'` succeeds.
  - **Verify:** `SELECT enrollment_type FROM enrollments LIMIT 1;` returns `'standard'`.
  - **Dependencies:** None. **Ask first:** approval to touch prod DB.
  - **Files:** SQL migration (applied via existing DB admin/CI).
  - **Size:** XS

- [x] **Task 3: `list-trial-sessions` function (public read)**
  - **Description:** Given `schedule_id`, return upcoming (`class_date >= today`,
    `status='scheduled'`) sessions with per-date availability:
    `spots_taken` = count of `bookings` for that `session_id` with `status='scheduled'`,
    `available = max_seats - spots_taken`.
  - **Acceptance:** Returns only future dates; excludes past; `available` never negative;
    respects `max_seats`; 404 if schedule missing/inactive.
  - **Verify:** `node --test test/list-trial-sessions.test.mjs` — cases: future dates
    only, capacity math, missing schedule, past-date exclusion.
  - **Dependencies:** Task 1 (real sessions).
  - **Files:** `backend/functions/list-trial-sessions.js` (new),
    `test/list-trial-sessions.test.mjs` (new).
  - **Size:** S

### Checkpoint: Foundation
- [ ] All tests pass; `list-trial-sessions` returns correct availability; sessions exist
      for active schedules. Review with human before building the write path.

### Phase 2 — Core: book a free trial (write path)

- [x] **Task 4: `book-trial` function (public write)**
  - **Description:** Validate `schedule_id` + `class_date`; load session (active,
    `class_date >= today`); capacity check on the session → `409` if full; eligibility
    (one trial per `student_email`, lowercased) → `409 TRIAL_ALREADY_CLAIMED`; provision
    provisional account (mirror `guest-enroll`); insert `enrollment`
    (`type='trial'`, `status='confirmed'`, `num_classes_enrolled=1`, `total_paid_cents=0`);
    insert `booking` (`type='trial'`, `status='scheduled'`, `session_id`); return
    `{ enrollment_id, claim_url }`.
  - **Acceptance:** Happy path creates enrollment + booking + account; full date → `409`;
    duplicate email → `409 TRIAL_ALREADY_CLAIMED`; past date / invalid email → `400`;
    unknown schedule → `404`.
  - **Verify:** `node --test test/book-trial.test.mjs` — happy + each error path; mock
    `ctx.db.query` and `global.fetch` per `guest-enroll.test.mjs` pattern.
  - **Dependencies:** Tasks 2, 3.
  - **Files:** `backend/functions/book-trial.js` (new), `test/book-trial.test.mjs` (new).
  - **Size:** M

- [x] **Task 5: Frontend — Schedule CTA + date-picker modal**
  - **Description:** Add **Book a trial** CTA to class cells in `schedule.js`. On click,
    open `trial-modal.js`: fetch `list-trial-sessions`, render selectable dates (disabled
    if `available <= 0` or past), collect parent name / student name / email / phone,
    call `book-trial` via `callFunction`, then show confirmation + claim link.
  - **Acceptance:** CTA visible on schedule; picker shows only bookable dates; success
    shows confirmation; errors (full/already claimed) surface clearly; no page reload.
  - **Verify:** `node --test test/schedule.test.mjs` still green; manual e2e in staging.
  - **Dependencies:** Tasks 3, 4; add `listTrialSessions`/`bookTrial` helpers to `api.js`.
  - **Files:** `js/schedule.js` (edit), `js/trial-modal.js` (new), `js/api.js` (edit).
  - **Size:** M

### Checkpoint: Core
- [ ] End-to-end: visitor books a free trial on a real date with no account; confirmation
      + claim link shown; DB has enrollment(`type='trial'`) + booking(`type='trial'`).
- [ ] Capacity + eligibility error paths verified manually.

### Phase 3 — Polish: admin visibility + conversion readiness

- [x] **Task 6: Show trials in admin roster**
  - **Description:** Surface trial bookings distinctly in the existing admin/roster view
    (badge `Trial`, link to the dated session); no new conversion action in v1.
  - **Acceptance:** Trial rows visible and labeled; clicking opens the schedule date.
  - **Verify:** manual check in admin; existing admin tests still green.
  - **Dependencies:** Task 4.
  - **Files:** admin UI files (e.g. `js/admin*.js`) — scope confirmed during build.
  - **Size:** S

- [ ] **Task 7: Confirm trial→paid conversion path** _(BLOCKED: live app has 0 enrollments / 0 students / no trial account, data-key writes are 403, and conversion e2e needs the management key + seed data + Stripe — cannot be executed headlessly with the current credential)_
  - **Description:** Ensure a trial account can later enroll via `enroll.html` (logged in
    as the claimed provisional account) and that the resulting `enrollment_type='standard'`
    is distinguishable from the trial. (No new code if `guest-enroll` claim already enables
    login; verify only.)
  - **Acceptance:** Claimed trial account can complete a paid enrollment; both rows persist.
  - **Verify:** manual e2e in staging.
  - **Dependencies:** Task 5.
  - **Files:** none (verification) unless a deep-link is added.
  - **Size:** XS

### Checkpoint: Complete
- [ ] All acceptance criteria in the spec met; all new + existing tests green; ready for
      human review/merge.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| R1: Weekly enrollments lack `'home'` bookings → capacity undercount | High | Task 1 backfills via `generate-sessions`; `book-trial` always writes its own `'trial'` booking. |
| R2: No real `class_sessions` for a schedule → nothing to book | High | Verify in Task 1; add a scheduled `generate-sessions` run if missing. |
| R3: Magic-link claim email not wired for free trials | Med | Task 5 fallback: show claim link on confirmation screen; confirm email path in Task 7. |
| R4: Timezone mismatch on `class_date` | Med | Open Q1: pin comparisons to studio timezone, date-only. |
| R5: Spam / abuse of free trials | Low | One-per-email eligibility (Task 4); optional CAPTCHA later. |

## Parallelization
- **Safe to parallelize after Task 1–2:** Task 3 (read fn) and the `api.js` helpers can
  start once the column exists; Task 4 (write fn) should follow Task 3's contract.
- **Must be sequential:** migration (Task 2) → functions (3,4) → UI (5) → admin (6).
- **Coordinate:** Define the `list-trial-sessions` / `book-trial` JSON contract (Task 3)
  before building the modal (Task 5).

## Live-App / Credential Investigation (2026-08-15) — what unblocked the env-gated tasks

**Auth reconciliation (resolves the earlier MCP + REST failures):**
- The data REST API (tables: `/enrollments`, `/bookings`, …) authenticates with the
  **`X-Api-Key`** header. `curl -H "X-Api-Key: $KEY" …/bookings` → **HTTP 200**.
- The management API (deploy functions via `POST /functions`, apply schema via
  `/schema/apply`) authenticates with **`Authorization: Bearer`** — this is what
  `backend/deploy.sh` and `migrate.py` use.
- The shared `bb_sk_…` key is a **data (read) key only**: it works under `X-Api-Key`
  (reads return 200), but `Authorization: Bearer` on `/functions` and `/schema` returns
  **401 AUTH_INVALID_API_KEY**, and `POST /enrollments` via the data key returns **403**.
  So this key is NOT the dashboard management/service key that migrations + function
  deployment require.
- Note: the user's reported `Authorization: Bearer …/bookings` "working" could not be
  reproduced from the sandbox; the data path requires `X-Api-Key`. The key itself is valid
  (reads succeed), the header scheme for the intended path was the mismatch.

**Live app `app_0otd4vmczvu8` inventory (via `X-Api-Key`):**
- `semesters` = 2, `programs` = 5, `class_schedules` = 46, `class_sessions` = 26
- `students` = 0, `parent_profiles` = 0, `enrollments` = **0**, `bookings` = **0**
- `enrollments?select=enrollment_type` → **200** ⇒ the `enrollment_type` column already
  exists (Task 2 end-state satisfied).
- App is **catalog-seeded only** — no users, enrollments, or bookings. There is therefore
  nothing for `generate-sessions` to backfill (Task 1 no-op) and no trial account to drive
  the conversion e2e (Task 7).

**Conclusion for Tasks 1 / 7:**
- Task 1 backfill has no data to act on in this app; invoking `generate-sessions` also needs
  the management key (it is not in `deploy.sh`'s active config and the live invocation path
  is unavailable with a data-only key).
- Task 7 conversion e2e needs: (a) the management/service key to write, (b) seeded students +
  a trial enrollment, and (c) a live Stripe Checkout round-trip — none executable headlessly
  with the current credential.
- **To actually run 1/7**, provide the Butterbase **dashboard management/service key** (Bearer)
  and confirm `app_0otd4vmczvu8` is the intended target (vs. a production app that holds real
  enrollment data). Alternatively, run `./backend/deploy.sh` + a manual `generate-sessions`
  invocation yourself in an environment holding the service key.
