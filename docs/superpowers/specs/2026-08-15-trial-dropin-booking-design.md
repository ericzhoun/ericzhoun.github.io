# Spec: Trial / Drop-in Booking

**Date:** 2026-08-15
**Status:** Draft for review
**Author:** Rex (Engineering Workflow Coach) + user

## Objective

Let a prospective student book **one free trial class on a specific date**, with the
lowest possible friction, to drive engagement and feed the paid-enrollment funnel.

- **User:** A visitor (no account required) browsing the schedule for their child.
- **Why:** The current enrollment flow only sells a *weekly recurring slot of 10–15
  classes* with a Stripe charge — a high-commitment first step. A free, date-specific
  trial removes that barrier and is the strongest lever for the stated goal of
  *improving engagement*.
- **Success looks like:** A visitor books exactly one free trial for a concrete class
  date in under a minute, with no upfront payment and no pre-existing account, and the
  studio owner can see who is coming.

### User stories / acceptance criteria (summary)
1. As a visitor, I can open the schedule, click **Book a trial** on a class, pick an
   available upcoming date, and confirm with my contact info — then see a confirmation.
2. I cannot book a second free trial with the same email (one trial per student/email).
3. I cannot book a date that is full or in the past.
4. A trial never pushes a class past its `max_seats`, counting both weekly enrollments
   and other trials for that date.
5. The studio owner can see trial bookings separately from paid enrollments.

## Decisions (resolved with user)

| Decision | Choice | Rationale |
|---|---|---|
| Booking model | **Specific dated session** | Reuses existing `class_sessions` / `bookings`; matches "drop in to a specific class." Capacity is checked **per date**. |
| Price | **Free first class ($0)** | Best for the engagement goal; no Stripe charge, just contact capture. |
| Eligibility | **One per student/email** | Prevents abuse; encourages conversion to paid. |
| Entry point | **CTA on Schedule page** | Surfaces where users already browse classes. Opens a date picker. |
| Account | Provision a **provisional account** (mirror `guest-enroll`) | Enables later "claim account / convert to paid" without re-entry. |

## Tech Stack

- **Frontend:** Static HTML + vanilla ES modules (`js/`), same as today.
- **Backend:** Butterbase serverless functions in `backend/functions/*.js`
  (plain JS, `export async function handler(req, ctx)`, `ctx.db.query` SQL, `ctx.env`,
  `ctx.user`). Public functions use HTTP trigger `auth: "none"`.
- **Data:** Postgres via Butterbase. Reuses `class_schedules`, `class_sessions`,
  `bookings`, `enrollments`, `programs`, `semesters`.
- **Auth/email:** Existing Butterbase auth + magic-link claim flow (same as
  `guest-enroll` → `checkout-success` claim). No new provider.
- **Payments:** None for the trial itself (free). Conversion to paid reuses the
  existing `enroll-guard` / `guest-enroll` Stripe path later.

## Commands

```
Test one file:   node --test test/book-trial.test.mjs
Test all:        node --test
Deploy funcs:    (existing pipeline — new functions dropped in backend/functions/ are
                  picked up by the same deploy as enroll-guard/guest-enroll)
```

## Project Structure

```
backend/functions/
  list-trial-sessions.js   # NEW — public; upcoming dated sessions + per-date availability
  book-trial.js            # NEW — public; reserve a free trial on a specific date
  guest-enroll.js          # existing — pattern source for provisional account + claim
  enroll-guard.js          # existing — reused later for trial→paid conversion
js/
  schedule.js              # EDIT — add "Book a trial" CTA + date-picker modal
  trial-modal.js           # NEW — modal: date picker + contact form + confirmation
  api.js                   # EDIT (minor) — add listTrialSessions / bookTrial helpers
test/
  list-trial-sessions.test.mjs  # NEW
  book-trial.test.mjs           # NEW
docs/superpowers/specs/ + plans/  # this spec + plan
```

## Data Model Changes

- **`enrollments.enrollment_type`** — `text`, default `'standard'`. Values:
  `'standard' | 'trial'`. (Single additive column; no breaking change to existing rows.)
- **`bookings`** — reused as-is. Trial inserts a row
  `(enrollment_id, session_id, type='trial', status='scheduled')`.
- **`class_sessions`** — reused as-is. Per-date availability is derived by counting
  `bookings` for a `session_id` with `status='scheduled'` (both `'home'` from weekly
  enrollments and `'trial'`) against `class_schedules.max_seats`.
- **Eligibility** — derived by querying
  `enrollments WHERE enrollment_type='trial' AND lower(student_email) = $1`. No new table.

### Migration (needs human approval before applying to prod DB)
```sql
ALTER TABLE enrollments ADD COLUMN enrollment_type text NOT NULL DEFAULT 'standard';
-- Optional index for eligibility lookups:
CREATE INDEX IF NOT EXISTS idx_enrollments_trial_email
  ON enrollments (student_email) WHERE enrollment_type = 'trial';
```

### Pre-existing dependency / risk
`bookings` rows of type `'home'` are only created by `generate-sessions.js` at session
*generation* time, for enrollments confirmed *before* generation. Weekly enrollments
created afterward may lack `'home'` bookings, which would **undercount** per-date
capacity. For v1 accuracy we must (a) run `generate-sessions` to backfill `'home'`
bookings for all active schedules, and (b) have `book-trial` insert its own `'trial'`
booking. See Plan Task 1 + Risk R1.

## Code Style

Follow the existing function style (see `guest-enroll.js`):
- `export async function handler(req, ctx)`, a local `json(obj, status)` helper.
- **Never trust client-sent prices/flags.** All scheduling, capacity, eligibility, and
  identity checks are server-side.
- Validate inputs early; return `400` for bad input, `409` for capacity/eligibility
  conflicts (mirror `enroll-guard`'s `409 Class is full`).
- Reuse the `guest-enroll` provisional-account + magic-link claim pattern for account
  creation (do not invent a new auth path).

```js
// book-trial.js (sketch of the guarded shape)
export async function handler(req, ctx) {
  // 1. parse + validate schedule_id, class_date, emails
  // 2. load session + schedule (must be active, date >= today)
  // 3. capacity: count bookings for session_id w/ status='scheduled' vs max_seats -> 409 if full
  // 4. eligibility: enrollment_type='trial' for this email already? -> 409 TRIAL_ALREADY_CLAIMED
  // 5. provision provisional account (mirror guest-enroll) + magic-link claim
  // 6. INSERT enrollment(type='trial', status='confirmed', num_classes=1, total=0)
  // 7. INSERT booking(type='trial', status='scheduled', session_id)
  // 8. return { enrollment_id, claim_url }
}
```

## Testing Strategy

- **Framework:** Node's built-in runner (`node --test`), colocated as `test/*.test.mjs`,
  importing the function `handler` directly.
- **Mocking:** `ctx.db.query` is stubbed to return queued result sets; `global.fetch` is
  stubbed for the auth/billing calls (see `test/guest-enroll.test.mjs` for the exact
  pattern). No live Butterbase/Stripe calls in unit tests.
- **Levels:**
  - *Unit (functions):* availability counting, capacity 409, eligibility 409, past-date
    400, invalid-email 400, success creates enrollment + booking.
  - *Integration (manual, pre-merge):* end-to-end booking in a staging env via the
    schedule page modal.
- **Coverage expectation:** every new branch in `book-trial` and `list-trial-sessions`
  has a test; happy path + each error path.

## Boundaries

- **Always:** server-side validation of schedule/session/email; server-side capacity +
  eligibility checks; one trial per email; compute availability from the DB, never the
  client; keep `enrollment_type` the single source of truth for "is this a trial."
- **Ask first:** applying the `enrollments.enrollment_type` migration to production;
  running `generate-sessions` backfill (writes `bookings`); any change to the deploy
  pipeline or CI.
- **Never:** commit secrets/`SERVICE_KEY`; trust client-sent price or type; edit vendor
  code; delete or weaken existing tests; expose `order_id`/PII beyond what the UI needs.

## Success Criteria (testable)

- [ ] A visitor with no account books exactly **one** free trial for a specific dated
      session and sees a confirmation + claim link.
- [ ] A second trial attempt with the same email is blocked (`409`, code
      `TRIAL_ALREADY_CLAIMED`).
- [ ] Booking a full or past date is blocked (`409` / `400`); reported `spots_available`
      matches the DB count.
- [ ] Across weekly enrollments + trials, no dated session exceeds `max_seats`.
- [ ] The **Book a trial** CTA is visible on schedule class cells; past/full dates are
      not selectable in the picker.
- [ ] Trial rows are distinguishable (`enrollment_type='trial'`) so conversion
      (trial → paid) can be measured by a later query.

## Open Questions

1. **Timezone for `class_date` comparisons** — confirm studio timezone; comparisons must
   be date-only against that zone, not the visitor's local time.
2. **Claim email for free trials** — confirm the existing magic-link email mechanism can
   be triggered from `book-trial` (guest-enroll relies on `checkout-success` sending it).
   Fallback: show a claim link directly on the confirmation screen.
3. **Admin visibility depth** — v1 lists trials in the existing roster; a dedicated
   "convert to paid" action is deferred unless requested.
