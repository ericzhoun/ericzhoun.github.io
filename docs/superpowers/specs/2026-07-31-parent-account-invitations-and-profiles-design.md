# Parent account welcome emails and profiles

## Problem

Admin-created parent accounts currently depend on two unrelated side effects:

1. Butterbase signup sends a generic security-code email. The message does not
   identify OliVista Art Studio or explain why the recipient received it.
2. Parent contact information is stored only on enrollment rows. A parent with
   no enrollment has no durable application profile, so the admin Accounts grid
   can show `-` for both name and email even though the auth account has those
   values.

The desired behavior is:

- An admin-created parent receives a branded welcome email from
  `OliVista Art Studio <olivistastudio@gmail.com>` explaining that the admin
  created the account and linking to login.
- Butterbase sends the separate security email containing the sign-in code.
- The welcome email clearly tells the parent to use the code from that separate
  security email.
- Butterbase's normal 15-minute code expiry and one-time-use behavior remain in
  effect. A parent can request a fresh code from the login page.
- The admin can resend the onboarding emails when necessary.
- Parent profile changes become the authoritative name and email shown in the
  admin Accounts grid.

## Platform constraints

Butterbase's signup flow automatically sends the current security email. Its
documented Auth API does not expose sender or template configuration, a way to
suppress the signup email, or the generated code. Application code therefore
cannot place that same code in a separately sent Gmail message.

Butterbase does document Gmail sending through its connected-account
integrations API. A service-key caller executes `GMAIL_SEND_EMAIL` on behalf of
a connected user by supplying that user's ID. OliVista will connect
`olivistastudio@gmail.com` once through Google OAuth and store the corresponding
sender user ID in backend configuration.

The supported solution deliberately sends two complementary emails: the
Butterbase security email carries the code, and the Gmail welcome email provides
the missing business context and login link.

References:

- https://docs.butterbase.ai/api-reference/auth-api/#magic-link-send
- https://docs.butterbase.ai/api-reference/auth-api/#magic-link-verify
- https://docs.butterbase.ai/api-reference/integrations-api/#post-v1-appid-integrationsexecute
- https://docs.butterbase.ai/core-concepts/functions/#environment-variables

## Chosen architecture

Account creation performs these operations in order:

1. Validate and normalize the submitted email and parent name.
2. Create the Butterbase auth account through the existing signup endpoint.
   Butterbase sends its security-code email as part of this flow.
3. Create the parent's durable application profile.
4. Send the branded welcome email through the connected Gmail account.
5. Return the account and welcome-email delivery status to the CMS.

If Gmail delivery fails, the auth account and profile remain valid. The CMS
reports the delivery failure and offers a resend action instead of encouraging
the admin to create a duplicate account.

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

Parent-owned reads are protected by user-isolation RLS on `user_id`. End users
have no direct INSERT, UPDATE, or DELETE policy. The verified `manage-account`
function persists identity-bound profile changes with its server-only service
credential. The service role has an explicit bypass policy for trusted profile
management.

No invitation-code table is required. Code generation, expiry, attempt limits,
and verification remain entirely inside Butterbase auth.

## Email

### Branded welcome email

Sender:

`OliVista Art Studio <olivistastudio@gmail.com>`

Subject:

`Your OliVista Art Studio account`

Body content:

> The admin of OliVista Art Studio has created an account for you. Butterbase
> has sent a separate security email containing your sign-in code. Please use
> that code to log in:
>
> [Log in to your account]
>
> Sign-in codes expire after 15 minutes and can be used only once. If your code
> has expired, request a new one from the login page. If you did not expect
> these emails, please contact OliVista Art Studio.

The login URL points to the existing login page with email-code mode selected
and the parent's email address prefilled. No code is placed in the URL.

### Security-code email

Butterbase remains solely responsible for generating, delivering, expiring,
and verifying the code. The application does not read, store, log, or reproduce
it.

## Resending onboarding emails

`admin-manage` gains an admin-only `resend-invitation` action. It:

1. Validates the target email against the stored parent profile.
2. Calls Butterbase's magic-link endpoint to send a fresh 15-minute sign-in
   code.
3. Sends the branded welcome email again through Gmail.
4. Returns separate `code_sent` and `welcome_sent` delivery states so the CMS
   never claims full success when only one message was sent.

The CMS displays `Resend onboarding emails` on the parent detail view. The
action remains useful after the parent's first login because it simply starts
the standard email-code login flow again. It does not reset or alter the
account.

## Profile source of truth

`parent_profiles` becomes the source of truth for the Accounts grid and parent
profile form.

- Admin account creation inserts the initial email and parent name.
- The account page loads the parent's profile alongside enrollments, students,
  and bookings.
- Saving the profile re-verifies the bearer token against `/me`, requires its
  user ID to match `ctx.user.id`, normalizes and validates the verified email,
  then persists through server-only service access. The browser cannot choose
  a different profile owner or account email.
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

- `Account created and welcome email sent.`
- `Account created, but the welcome email could not be sent. Resend onboarding emails.`

The returned account immediately opens in the detail view. The Accounts grid
reads persistent profile data, so refreshing the page does not lose a newly
created account's name or email.

The detail view includes `Resend onboarding emails`. Its result distinguishes:

- both messages sent;
- security code sent but welcome email failed;
- welcome email sent but security code failed;
- neither message sent.

### Parent login

The branded email opens `login.html` in email-code mode:

- email is prefilled from the query string;
- the page tells the parent to enter the code from the separate Butterbase
  security email;
- the parent can request a fresh code if the current one has expired;
- successful verification uses the existing Butterbase magic-link verification
  flow and redirects to `account.html` or the validated `next` destination.

Normal password login remains unchanged.

## Consistency and failure handling

Auth signup cannot be rolled back through a documented reversible API. Account
creation therefore treats the auth user and profile as durable once signup
succeeds. If the later profile or Gmail step fails, the response identifies
that the account exists and directs the admin to resend rather than signup.

The welcome email is considered delivered only when the Gmail integration
returns both an HTTP success and `successful: true`. Logs omit authorization
tokens, Gmail OAuth details, and user security codes.

If the two emails arrive out of order, each remains understandable on its own:
the branded email refers to the separate security email, and the security email
contains the code and its normal auth context.

## Testing

### Backend integration tests

- Account creation persists a profile before sending the welcome email.
- The Gmail request uses `GMAIL_SEND_EMAIL`, the configured sender user ID,
  recipient, subject, login link, and approved introduction.
- Gmail failure leaves a recoverable account and profile.
- Resend reads the stored profile email rather than trusting a client-supplied
  address.
- Resend calls the Butterbase magic-link endpoint and Gmail exactly once each.
- Partial resend failures return accurate `code_sent` and `welcome_sent` states.
- Profile saves use the authenticated user ID and verified auth email.
- A legacy account profile is created on first save.
- Account listing prefers profile name and email while preserving correct
  student and enrollment counts and legacy fallbacks.

### Frontend tests

- Welcome-email links select email-code mode and prefill email.
- The login page explains which email contains the code and allows requesting a
  fresh code.
- Existing password and magic-link verification paths remain unchanged.
- The CMS reports welcome delivery status and wires the resend action.
- The account profile renders durable profile values and saves edits.

### Browser end-to-end test

Run the application against controlled auth, data, and Gmail boundaries:

1. Log in as admin and create a parent.
2. Capture the Butterbase security-email request and the single Gmail welcome
   message.
3. Follow the welcome email's login link and confirm email-code mode and the
   prefilled email.
4. Complete login with the Butterbase code.
5. Change the parent name in the profile.
6. Return to the admin Accounts grid and refresh.
7. Confirm the new parent name and auth email render instead of `-`.
8. Force a Gmail failure and verify the CMS resend recovery path and partial
   delivery messaging.

Run the complete existing Node test suite afterward. Browser verification also
checks responsive layout, focus behavior, accessible labels, console errors,
and obvious visual regressions.

## Deployment requirements

Deployment requires:

1. Apply the `parent_profiles` table migration and RLS policies.
2. Configure the Gmail integration for the Butterbase app.
3. Complete one-time Google OAuth authorization for
   `olivistastudio@gmail.com` and ensure its Gmail display name is
   `OliVista Art Studio`.
4. Store `INVITATION_GMAIL_USER_ID` as an encrypted backend environment
   variable.
5. Deploy the updated `admin-manage` and `manage-account` functions.
6. Deploy the static frontend changes.
7. Run a live smoke test with a disposable parent email before inviting a real
   family.

No Gmail credential is committed to this repository or shipped to the
frontend.
