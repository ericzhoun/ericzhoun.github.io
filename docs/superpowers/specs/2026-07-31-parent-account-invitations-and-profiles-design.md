# Parent account invitations and profiles

## Problem

Admin-created parent accounts currently depend on two unrelated side effects:

1. Butterbase signup sends a generic verification or sign-in-code email. The
   message does not identify OliVista Art Studio or explain why the recipient
   received it.
2. Parent contact information is stored only on enrollment rows. A parent with
   no enrollment has no durable application profile, so the admin Accounts grid
   can show `-` for both name and email even though the auth account has those
   values.

The desired behavior is:

- An admin-created parent receives one branded invitation email from
  `OliVista Art Studio <olivistastudio@gmail.com>` containing the initial
  six-digit sign-in code.
- The initial code remains valid until it is successfully used.
- The admin can resend the invitation. Resending invalidates the previous code.
- Later logins continue using Butterbase's existing magic-link code flow.
- Parent profile changes become the authoritative name and email shown in the
  admin Accounts grid.

## Platform constraints

Butterbase's documented magic-link send endpoint returns only a generic success
message. It does not return the generated code or document custom sender and
template controls. The code therefore cannot be copied into a separately sent
branded email.

Butterbase does document Gmail sending through its connected-account
integrations API. A service-key caller executes `GMAIL_SEND_EMAIL` on behalf of
a connected user by supplying that user's ID. OliVista will connect
`olivistastudio@gmail.com` once through Google OAuth and store the corresponding
sender user ID in backend configuration.

References:

- https://docs.butterbase.ai/api-reference/auth-api/#magic-link-send
- https://docs.butterbase.ai/api-reference/auth-api/#magic-link-verify
- https://docs.butterbase.ai/api-reference/integrations-api/#post-v1-appid-integrationsexecute
- https://docs.butterbase.ai/core-concepts/functions/#environment-variables

## Chosen architecture

Admin-created accounts use a dedicated first-login invitation flow. This flow
is separate from normal magic-link login because application code must control
both the message and the code in the initial email.

Account creation performs these operations in order:

1. Validate and normalize the submitted email and parent name.
2. Create the Butterbase auth account with a server-derived internal password.
3. Create the parent's durable application profile.
4. Generate and store a protected invitation code.
5. Send the branded invitation through the connected Gmail account.
6. Return the account and invitation delivery status to the CMS.

If Gmail delivery fails, the auth account, profile, and invitation remain
valid. The CMS reports the delivery failure and offers a resend action instead
of encouraging the admin to create a duplicate account.

## Data model

### `parent_profiles`

One durable row per auth user:

| Column | Contract |
| --- | --- |
| `user_id` | Auth user UUID, primary key |
| `email` | Normalized verified auth email, required and unique |
| `parent_name` | Parent or guardian display name |
| `student_phone` | Optional contact phone |
| `emergency_contact` | Optional emergency contact |
| `allergies` | Optional allergy or notes text |
| `created_at` | Creation timestamp |
| `updated_at` | Last profile change timestamp |

Parent-owned reads and writes are protected by user-isolation RLS on
`user_id`. The service role has an explicit bypass policy for admin management.

### `account_invitations`

At most one active invitation per parent:

| Column | Contract |
| --- | --- |
| `user_id` | Auth user UUID, primary key |
| `code_digest` | HMAC digest of user ID and code, never the readable code |
| `failed_attempts` | Consecutive incorrect attempts in the current window |
| `locked_until` | Temporary verification lock timestamp, nullable |
| `sent_at` | Timestamp of the most recent successful send |
| `created_at` | Invitation creation timestamp |
| `updated_at` | Last invitation change timestamp |

This table is backend-only. No browser role receives direct read or write
access.

## Invitation credential design

The readable invitation is a six-digit numeric code. It has no time-based
expiry and is deleted only after successful first login or replaced by a resend.

The database stores an HMAC digest keyed by `INVITATION_CODE_SECRET`. A plain
hash is insufficient because an attacker with a database copy could test all
one million possible codes quickly. Verification uses constant-time byte
comparison.

The auth account's internal password is derived with a separate
`INVITATION_AUTH_SECRET` and the auth user ID, then formatted to meet the
Butterbase password policy. The password is never returned to a browser or
stored in application data. After the initial invitation succeeds, normal
magic-link login remains the supported login method. A later password reset
does not affect an already-consumed invitation.

The two secrets are independent so compromise or rotation of one purpose does
not silently weaken the other. They are stored as encrypted backend environment
variables along with `INVITATION_GMAIL_USER_ID`.

## Email

Sender:

`OliVista Art Studio <olivistastudio@gmail.com>`

Subject:

`Your OliVista Art Studio account`

Body content:

> The admin of OliVista Art Studio has created an account for you. Please use
> the sign-in code below to log in:
>
> **123456**
>
> [Log in to your account]
>
> This code is for your initial login and remains valid until it is used. If
> you did not expect this email, please contact OliVista Art Studio.

The login URL points to the existing login page with invitation mode selected
and the email address prefilled. The code is not placed in the URL.

## First-login verification

A public `verify-account-invitation` function accepts the normalized email and
six-digit code. It:

1. Applies per-email and per-IP request throttling.
2. Loads the profile and active invitation without exposing whether either
   exists.
3. Rejects a currently locked invitation with the same generic public error.
4. Computes and compares the code digest in constant time.
5. On failure, increments the attempt count. Five consecutive failures create
   a 15-minute lock. When the lock ends, the attempt count resets and the same
   code can be tried again.
6. On success, derives the internal auth password and calls Butterbase login.
7. Deletes the invitation only after auth login succeeds.
8. Returns the standard access token, refresh token, expiry, and user shape to
   the browser.

Unknown email, wrong code, and temporary lock responses do not reveal account
existence. Logs omit the code, password, authorization tokens, and Gmail OAuth
details.

## Resending an invitation

`admin-manage` gains an admin-only `resend-invitation` action. It generates a
new code, replaces the stored digest, resets failed attempts and lock state,
and sends the branded email. The old code becomes invalid as soon as the new
invitation is stored.

The CMS displays invitation state for pending admin-created accounts and shows
`Resend invitation`. A successful resend confirms delivery. A failed send keeps
the new invitation available for another resend and shows an actionable error.

Consumed invitations are not recreated implicitly. Resending after first login
returns a clear `Invitation already used` error; the parent uses normal sign-in
codes instead.

## Profile source of truth

`parent_profiles` becomes the source of truth for the Accounts grid and parent
profile form.

- Admin account creation inserts the initial email and parent name.
- The account page loads the parent's profile alongside enrollments, students,
  and bookings.
- Saving the profile upserts the profile using `ctx.user.id` and the email from
  the verified bearer token. The browser cannot choose a different profile
  owner or account email.
- Existing enrollment contact columns continue to be updated for compatibility
  with registration, attendance, and other existing views.
- `list-accounts` starts with all profile rows, then aggregates student and
  enrollment counts by `user_id`.
- Legacy parents found only through students or enrollments remain visible.
  Enrollment name and email are fallback display values until a profile exists.
- When a legacy parent saves profile details, the verified auth email and saved
  parent name create the missing profile automatically. This repairs accounts
  such as `oliviartworld@gmail.com` through the normal parent workflow.

Email is displayed and persisted from the verified auth identity. The current
profile UI does not make the auth email editable.

## Frontend behavior

### Admin CMS

After account creation, the CMS reports one of:

- `Account created and invitation sent.`
- `Account created, but the invitation could not be sent. Resend invitation.`

The returned account immediately opens in the detail view. Pending invitations
show their send state and the resend action. The Accounts grid reads persistent
profile data, so refreshing the page does not lose a newly created account's
name or email.

### Parent login

The invitation link opens `login.html` in a dedicated initial-invitation mode:

- email is prefilled and remains editable in case an email client altered the
  query string;
- only the six-digit code field is shown;
- submission calls `verify-account-invitation` rather than Butterbase's
  magic-link verify endpoint;
- successful verification stores tokens using the same local-storage contract
  as existing login and redirects to `account.html` or the validated `next`
  destination;
- errors use generic wording and do not reveal whether the email exists.

Normal password and magic-link modes remain unchanged for later logins.

## Consistency and failure handling

Auth signup cannot be rolled back through a documented reversible API. Account
creation therefore treats the auth user and profile as durable once signup
succeeds. If a later profile, invitation, or Gmail step fails, the response
identifies that the account exists and directs the admin to retry the missing
step through resend rather than signup.

Database writes that replace an invitation are transactional. Invitation
deletion occurs only after Butterbase returns valid login tokens, so a transient
auth failure does not consume a correct code.

Gmail delivery is not claimed successful solely because an HTTP call returned
2xx. The integration response must also report `successful: true`.

## Testing

### Backend integration tests

- Account creation persists a profile before sending.
- The Gmail request uses `GMAIL_SEND_EMAIL`, the configured sender user ID,
  recipient, subject, login link, introduction, and generated code.
- Raw invitation codes and internal passwords never appear in persisted rows or
  logs.
- Gmail failure leaves a recoverable account and invitation.
- Resend replaces the previous digest, resets lock state, and invalidates the
  previous code.
- Verification rejects malformed, unknown, incorrect, locked, and reused codes
  with safe responses.
- Five failures create a 15-minute lock without expiring the invitation.
- Successful verification returns auth tokens and deletes the invitation once.
- An auth-login failure leaves the invitation intact.
- Profile saves use the authenticated user ID and verified auth email.
- A legacy account profile is created on first save.
- Account listing prefers profile name and email while preserving correct
  student and enrollment counts and legacy fallbacks.

### Frontend tests

- Invitation links select the correct login mode and prefill email.
- Invitation submission stores returned tokens and follows the validated
  redirect.
- Existing password and magic-link paths remain unchanged.
- The CMS reports invitation delivery status and wires the resend action.
- The account profile renders durable profile values and saves edits.

### Browser end-to-end test

Run the application against controlled auth, data, and Gmail boundaries:

1. Log in as admin and create a parent.
2. Capture the single outbound Gmail message and its code.
3. Follow its login link and sign in with that code.
4. Change the parent name in the profile.
5. Return to the admin Accounts grid and refresh.
6. Confirm the new parent name and auth email render instead of `-`.
7. Confirm the original invitation code cannot be used again.
8. Repeat invitation creation with a forced Gmail failure and verify the CMS
   resend recovery path.

Run the complete existing Node test suite afterward. Browser verification also
checks responsive layout, focus behavior, accessible labels, console errors,
and obvious visual regressions.

## Deployment requirements

Deployment requires:

1. Apply the two table migrations and RLS policies.
2. Configure the Gmail integration for the Butterbase app.
3. Complete one-time Google OAuth authorization for
   `olivistastudio@gmail.com`.
4. Store `INVITATION_GMAIL_USER_ID`, `INVITATION_CODE_SECRET`, and
   `INVITATION_AUTH_SECRET` as backend environment variables.
5. Deploy the updated `admin-manage`, `manage-account`, and new
   `verify-account-invitation` functions.
6. Deploy the static frontend changes.
7. Run a live smoke test with a disposable parent email before inviting a real
   family.

No invitation or Gmail secret is committed to this repository or shipped to
the frontend.
