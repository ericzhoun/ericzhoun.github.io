# Guest Checkout with Account Claiming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let unregistered visitors pay for class credits via Stripe with no account, fulfill enrollment from the payment webhook, and let buyers claim the enrollment into an account afterwards with a magic-link email code.

**Architecture:** Static frontend (vanilla JS modules) talks to a Butterbase backend (`app_48ul5eszfv7v`). New public `guest-enroll` function creates unclaimed pending enrollments and checkout sessions using the service role; the existing webhook fulfills; new `claim-enrollments` attaches enrollments to a verified-email account; new `complete-registration` replaces the browser-shipped service key. Spec: `docs/superpowers/specs/2026-07-15-guest-checkout-account-claiming-design.md`.

**Tech Stack:** Vanilla ES modules, Butterbase management REST API (`POST /v1/{app}/functions`, `POST /v1/{app}/schema/apply`), Butterbase auth magic links.

## Global Constraints

- App id: `app_48ul5eszfv7v`; site URL `https://olivistart.com`; API base `https://api.butterbase.ai`.
- Deploy calls authenticate with the service key from env `BUTTERBASE_API_KEY` (never hardcode in repo files; the old key is being rotated).
- Functions use auto-injected `ctx.env.BUTTERBASE_APP_ID`, `ctx.env.BUTTERBASE_API_URL`, `ctx.env.BUTTERBASE_API_KEY`; `SITE_URL` passed as envVar with fallback `https://olivistart.com`.
- Verified empirically: `ctx.db` runs as `butterbase_service` (RLS bypassed) in all functions, including `auth: none`; anon REST reads of `enrollments` return `[]`.
- Capacity rule everywhere: `status = 'confirmed' OR (status = 'pending' AND created_at > now() - interval '60 minutes')`.
- No em dashes in any authored text or strings.
- Function sources are checked into `backend/functions/` and deployed from there via `backend/deploy.sh` (fixes the "source only lives in production" problem).
- Commit after each task.

---

### Task 1: Schema changes

**Files:** none (remote schema); record the applied payload in `backend/schema-notes.md`.

- [ ] Fetch current schema: `GET /v1/{app}/schema` (service key), extract `enrollments`.
- [ ] Build payload: same table with `user_id.nullable: true`, added indexes `idx_enrollments_order {columns:[stripe_order_id], unique: true}` and `idx_enrollments_email {columns:[student_email]}`.
- [ ] `POST /v1/{app}/schema/apply` with `dry_run: true`; inspect planned operations; abort if it plans drops of other tables (send full schema instead in that case).
- [ ] Apply for real; re-GET schema and confirm `user_id.nullable == true` and both indexes present.
- [ ] Write `backend/schema-notes.md` documenting the change; commit.

### Task 2: Backend function sources in repo + deploy script

**Files:**
- Create: `backend/functions/guest-enroll.js`, `backend/functions/claim-enrollments.js`, `backend/functions/complete-registration.js`, `backend/functions/enroll-guard.js`, `backend/functions/stripe-webhook.js`, `backend/deploy.sh`, `backend/README.md`

**Interfaces produced:**
- `POST fn/guest-enroll` (public) body `{schedule_id, student_name, student_email, student_phone?, num_classes_enrolled?}` returns `{enrollment_id, checkout_url, total_cents}`. Never returns `order_id`.
- `POST fn/claim-enrollments` (auth) body `{}` returns `{claimed: [ids]}`. Refuses unverified email (403). `allow_service_key_impersonation: false`.
- `POST fn/complete-registration` (auth) body `{enrollment_id, child_name, child_age, child_dob, parent_name, emergency_contact, allergies, referred_by}` returns `{id}`; 404 unless caller owns the enrollment.
- `POST fn/class-availability` (public) body `{schedule_id}` returns `{spots_taken, max_seats}` (fixes broken anon capacity display).
- `enroll-guard`: capacity rule updated; pricing computed server-side (client-sent prices ignored); response drops `order_id`.
- `stripe-webhook`: re-verifies order status via `GET billing/orders/{order_id}` with service key before acting (unauthenticated payload no longer trusted); 500 on lookup failure so delivery retries; fulfillment logic unchanged; `allow_service_key_impersonation: false`.

Full source for each function is written at implementation time following the spec's Design section; `deploy.sh` posts each file to `POST /v1/{app}/functions` with per-function trigger and impersonation config, reading the key from `$BUTTERBASE_API_KEY`.

- [ ] Write the five function sources plus `class-availability` per the interfaces above.
- [ ] Write `backend/deploy.sh` (bash + curl + python3 for JSON-encoding the code field).
- [ ] Commit.

### Task 3: Deploy and test backend functions

- [ ] Back up currently-deployed `enroll-guard` and `stripe-webhook` source to `backend/functions/originals/` (already fetched this session); commit.
- [ ] Deploy all six via `deploy.sh`.
- [ ] Test `guest-enroll`: missing email -> 400; bogus schedule -> 404; valid input -> 200 with `checkout_url` containing `checkout.stripe.com`, DB row has `user_id NULL`, `status pending`, correct server-computed totals; response has no `order_id`.
- [ ] Test `class-availability`: returns integers matching DB counts.
- [ ] Test `stripe-webhook`: POST `{order_id: <real pending order>, order_status: "paid"}` -> because billing API says order is actually pending, enrollment stays pending (spoof rejected). POST bogus order id -> 500.
- [ ] Test `claim-enrollments`: anonymous -> 401. (Positive path exercised in Task 8 E2E.)
- [ ] Delete test enrollment rows created above via service key.

### Task 4: auth.js magic-link helpers + api.js key removal

**Files:** Modify `js/auth.js`, `js/api.js`.

- [ ] `js/auth.js`: add `sendMagicLink(email)`, `verifyMagicLink(email, code)` (stores tokens/user like `login`), `claimEnrollments()` (best-effort POST to `fn/claim-enrollments` with stored token; returns `[]` on any failure).
- [ ] `js/api.js`: delete `ADMIN_KEY` and `adminApi`; keep everything else.
- [ ] `grep -r "bb_sk_" js/ *.html` returns nothing; commit.

### Task 5: Enroll page guest flow

**Files:** Modify `js/enroll.js`, `css/style.css` (small additions only if needed).

- [ ] Remove the "Please log in to enroll" branch; render the form for guests with a required email field (logged-in users keep using their account email, no field shown).
- [ ] Capacity display: call `fn/class-availability` instead of anon REST reads.
- [ ] `handleEnroll`: logged-in -> `enroll-guard` (unchanged payload); guest -> `guest-enroll`; on success store the email in `sessionStorage["olivistart_pending_email"]` and redirect to `checkout_url`.
- [ ] Verify in browser: guest sees form with email field; submit redirects toward Stripe. Commit.

### Task 6: checkout-success page

**Files:** Create `checkout-success.html`, `js/checkout-success.js`; modify `css/style.css`.

- [ ] Page copy: "You're enrolled! Create your account to manage this class." Claim card: email input (prefilled from sessionStorage), send-code button, 6-digit code input, verify button, inline errors, resend link.
- [ ] Logged-in visitors: skip claim UI, auto-run `claimEnrollments()`, link to `registration.html?enrollment={id}` and `account.html`.
- [ ] After verify: `claimEnrollments()`, then redirect to `registration.html?enrollment={id}` (or `account.html` if no enrollment param).
- [ ] Verify rendering and error paths in browser. Commit.

### Task 7: Login/account/registration integration

**Files:** Modify `login.html`, `js/login.js`, `js/account.js`, `js/registration.js`.

- [ ] Login page: add "Email me a sign-in code" toggle using `sendMagicLink`/`verifyMagicLink`; after any successful login call `claimEnrollments()` before redirecting to `next`.
- [ ] `js/account.js`: best-effort `claimEnrollments()` on init before fetching enrollments.
- [ ] `js/registration.js`: replace `adminApi` PATCH with `callFunction("complete-registration", {...}, getToken())`.
- [ ] Verify login page both modes render; commit.

### Task 8: End-to-end verification

- [ ] Serve the site locally (static server against production API).
- [ ] Guest flow: schedule -> class -> enroll form -> submit -> Stripe checkout page loads (stop before payment; do not pay).
- [ ] Success page: send a code to a controlled test scenario; verify claim path: create test enrollment via `guest-enroll` for a test email, sign in via password test account whose email matches and is verified if available; otherwise verify the 403-unverified guard and claim SQL via direct invoke with a real user token.
- [ ] Confirm `stripe-webhook` logs show spoof rejection; confirm no `bb_sk_` string in any served asset.
- [ ] Clean up all test rows; commit remaining changes; report key-rotation reminder to owner.
