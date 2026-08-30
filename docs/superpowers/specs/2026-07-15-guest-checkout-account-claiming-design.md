# Guest Checkout with Account Claiming

Date: 2026-07-15

## Problem

Today an unregistered visitor who clicks a class on the schedule hits a login wall on the
enroll page (`js/enroll.js`). They must create a password account before paying, which is
the highest-friction point in the funnel. We want guests to pay first and claim an account
afterwards, without risking lost credits or orphaned payments.

## Goals

- Guest completes Stripe checkout for a class credit pack with no account.
- Enrollment is fulfilled by the payment webhook, not the success page, and is idempotent.
- After payment, the guest claims their enrollment into an account with minimal friction.
- Payments remain recoverable indefinitely if the buyer closes the browser after paying.
- Existing logged-in enrollment flow keeps working unchanged.
- Remove the RLS-bypassing service key currently shipped to browsers in `js/api.js`.

## Non-goals

- Google/Apple OAuth sign-in (no providers configured on this app; magic-link codes and
  the existing password login cover claiming).
- New `checkout_intent` / `credit_transaction` tables. The existing `enrollments` table
  already models the intent (status lifecycle) and the credit pack
  (`num_classes_enrolled`, consumption = attended bookings).
- Delayed/async payment methods. Butterbase's managed checkout is card-based; its order
  statuses (`pending`/`paid`/`failed`/`refunded`) are what the webhook receives.
- Automated refunds when a lapsed seat hold is paid after the class fills (surfaced to
  admin instead; 6-seat classes make this rare).

## Platform constraints (verified against the live backend)

- Billing is Butterbase-managed Stripe Connect. No direct access to Checkout Session
  fields (`client_reference_id`, session id) or raw Stripe webhooks. The app webhook
  receives `{event, order_id, order_status, metadata}`.
- `POST /v1/{app}/billing/purchase` requires auth, but accepts the app service key, so a
  serverless function can create checkout sessions on behalf of guests.
- Butterbase auth supports magic links: `POST /auth/{app}/magic-link` emails a 6-digit
  code; `verify` returns tokens and auto-creates the user if new. Codes expire in 15
  minutes, single-use, reissuable. Same response whether or not the account exists.
- Function HTTP triggers support `auth: required | none` only.
- `enrollments.user_id` is currently `NOT NULL` and must become nullable.

## Design

### Flow

(As-built 2026-07-15. Two constraints discovered during implementation reshaped the
original sketch: `billing/purchase` requires a genuine end-user JWT - service keys pass
authentication but have no purchaser, and `X-Butterbase-As-User` impersonation is not
honored by billing endpoints - and billing order reads are equally user-scoped, so a
webhook cannot re-verify order status.)

1. Guest clicks a class on the schedule and lands on the enroll page. No login wall.
   The form shows student name, phone, and (for guests) a required email field.
2. Submit calls a new public `guest-enroll` function which:
   - re-checks seat availability server-side and computes pricing from the database,
   - creates a provisional account for the email via auth signup with a random
     password that is never stored or revealed (if the email already has an account,
     returns 409 `EMAIL_EXISTS` and the frontend routes to login instead),
   - logs in as that account to obtain the end-user JWT billing requires,
   - creates an enrollment owned by it: `status = 'pending'`,
   - creates the dynamically priced product (service key),
   - calls `billing/purchase` with the provisional account's JWT,
   - stores `stripe_order_id`, returns the checkout URL (never the order id).
   Success URL: `checkout-success.html?enrollment={id}`. Cancel URL: back to the enroll page.
3. Stripe collects payment. The existing `stripe-webhook` function fulfills: flips the
   enrollment to `confirmed` and creates home bookings, idempotently (`status != $1`
   guard on the unique `stripe_order_id`).
4. Success page shows "You're enrolled! Create your account to manage this class." with
   the email prefilled (via sessionStorage, never the URL). One button emails the
   6-digit code; entering it calls `magic-link/verify`, which signs the buyer into the
   provisional account that already owns the enrollment.
5. A `claim-enrollments` function (auth required) additionally attaches any enrollment
   where `student_email` matches the caller's verified email and `user_id IS NULL`
   (legacy rows, admin-corrected emails). It runs after every login and on the account
   page.

Claiming is by proof of email ownership (the magic-link code): the provisional account
has no usable credentials until the code is redeemed. No claim token exists, so no URL
alone can expose or claim a purchase.

Known limits accepted for this deployment:
- Auth endpoints are rate-limited per source IP (signup 5/15min). `guest-enroll` calls
  signup/login from the function egress, so more than ~5 guest checkouts per 15 minutes
  could be throttled. Fine at this studio's volume.
- The webhook payload cannot be re-verified against the billing API (reads are
  user-scoped) and carries no signature. Mitigation: order ids are never returned to
  clients, so forging a confirmation requires guessing a UUID.

### Seat reservation

Pending enrollments currently hold a seat forever if checkout is abandoned (existing
bug). Capacity checks change to count `confirmed` plus `pending` rows younger than 60
minutes, in `guest-enroll`, `enroll-guard`, and the enroll page display. The webhook
still confirms any paid order; a payment completed after the hold lapsed can oversell by
one and is left for admin follow-up.

### Recovery paths

- Browser closed after paying: enrollment is already confirmed. The login page gains an
  "email me a code" option, and `claim-enrollments` runs after every login, so the
  purchase attaches whenever the buyer returns. Unclaimed enrollments never expire.
- Mistyped email at checkout: admin corrects `student_email` in the admin panel; the
  normal claim then works. Support path is based on payment details, never on URLs.
- Duplicate webhooks: unique index on `stripe_order_id` plus the existing
  status-transition guard.

### Schema changes

- `enrollments.user_id` becomes nullable.
- Unique partial index on `enrollments.stripe_order_id` (where not null).
- Index on `enrollments.student_email` for the claim query.

### Backend functions

| Function | Change |
|---|---|
| `guest-enroll` | New. HTTP `auth: none`. Guest checkout as above. Validates email shape, seat availability. |
| `claim-enrollments` | New. HTTP `auth: required`. `UPDATE enrollments SET user_id = $me WHERE lower(student_email) = lower($my_email) AND user_id IS NULL`. Returns claimed ids. |
| `complete-registration` | New. HTTP `auth: required`. Accepts registration-form fields for an enrollment the caller owns; replaces the client-side service-key PATCH. |
| `enroll-guard` | Modified. Fresh-pending capacity rule. |
| `stripe-webhook` | Modified. `allow_service_key_impersonation: false`; minor hardening. Fulfillment logic unchanged. |

### Frontend changes

- `js/enroll.js`: remove the auth prompt branch; guest form with email; call
  `guest-enroll` when logged out, `enroll-guard` when logged in.
- `checkout-success.html` + `js/checkout-success.js`: new. Enrolled banner, code
  send/verify UI, claim, forward to `registration.html?enrollment={id}`.
- `login.html` + `js/login.js`: add magic-link code option alongside password login.
- `js/auth.js`: `sendMagicLink(email)`, `verifyMagicLink(email, code)` helpers; both
  login paths call `claim-enrollments` after obtaining tokens.
- `js/registration.js`: submit via `complete-registration` instead of `adminApi`.
- `js/api.js`: delete `ADMIN_KEY` and `adminApi`. The exposed key must be rotated by the
  owner afterwards (it has been public in the repo and on the site).

### Security notes

- The service key currently shipped in `js/api.js` bypasses RLS for anyone who views
  source. Removing it from the client and rotating it is part of this work.
- `guest-enroll` is a public endpoint that writes rows and creates Stripe sessions.
  Abuse surface is limited: rows are `pending` and expire from capacity counts after 60
  minutes, and Butterbase rate-limits at the edge. It validates schedule existence,
  email shape, and numeric bounds (`num_classes` within program limits, prices from the
  database rather than trusting the client).

### Error handling

- `guest-enroll` compensates like `enroll-guard`: failed product or purchase creation
  deletes the just-created enrollment and returns a 502 with details.
- Magic-link failures (wrong/expired code) surface the API's message inline with a
  "send a new code" action.
- Claim after verify is best-effort on the success page; if it fails, the account page
  retries claim on next login (claim-on-login), so nothing is lost.

## Testing

- Test-invoke `guest-enroll` against a real schedule: verify pending enrollment with
  NULL user_id, valid checkout URL, and compensation on forced product failure.
- Simulate the webhook payload against a test enrollment: confirm status flip, home
  bookings, idempotency on redelivery.
- `claim-enrollments`: seed an unclaimed confirmed enrollment, verify a magic-link
  login claims it; verify a second user with a different email cannot.
- Browser E2E: schedule -> enroll as guest -> Stripe checkout page loads; success page
  code flow renders; login page code flow works; registration submit works without the
  admin key present anywhere in served JS.
