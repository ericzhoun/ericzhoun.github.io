# Butterbase backend

The site's backend is Butterbase app `app_0otd4vmczvu8` (api.butterbase.ai):
Postgres with RLS, auth (password + magic-link codes), managed Stripe Connect
billing, and the serverless functions in `functions/`.

## Layout

- `functions/*.js` - source of truth for the deployed serverless functions.
  Edit here, then deploy. Never edit only in production.
- `functions/originals/*.js` - snapshots of the functions as deployed before
  the 2026-07-15 guest-checkout work (`book-class`, `generate-sessions`,
  `mark-attendance` are unchanged and still live from these sources).
- `deploy.sh` - deploys from `functions/` via the management API.
- `schema-notes.md` - log of schema migrations applied via `schema/apply`.

## Deploying

```bash
BUTTERBASE_API_KEY=bb_sk_... ./backend/deploy.sh                # all
BUTTERBASE_API_KEY=bb_sk_... ./backend/deploy.sh guest-enroll   # one
```

The key is the app service key (Butterbase dashboard). It bypasses RLS;
never commit it or ship it to the frontend.

`trigger-schedule-bake` additionally needs a `GITHUB_TOKEN` (a fine-grained
PAT scoped to this repo with Actions: write) in the environment when
deploying it, so it can dispatch the `bake-schedule.yml` workflow on the
admin's behalf:

```bash
BUTTERBASE_API_KEY=bb_sk_... GITHUB_TOKEN=github_pat_... ./backend/deploy.sh trigger-schedule-bake
```

### Gmail sender for parent invitations

Before first deploying `admin-manage`, enable the Gmail toolkit in Butterbase
and connect `olivistastudio@gmail.com` through its OAuth flow. In the connected
Gmail account settings, set the display name to `OliVista Art Studio`. Find the
connected account's Butterbase user ID, then export it only in the shell used
for the deployment:

```bash
export INVITATION_GMAIL_USER_ID=your_connected_butterbase_user_id
BUTTERBASE_API_KEY=bb_sk_... ./backend/deploy.sh admin-manage
```

Do not commit the user ID, add it to frontend configuration, or store it in
source files. `deploy.sh` sends it as encrypted function environment
configuration for `admin-manage`.

## Checkout flows

- Logged-in: `enroll-guard` (auth required) creates a pending enrollment for
  the user and a Stripe Checkout session; success returns to
  `registration.html`.
- Guest: `guest-enroll` (public) creates a provisional account for the email
  (random password, never stored; billing purchases require an end-user JWT,
  which is why the account exists at checkout time), an enrollment owned by
  it, and a checkout session. Existing emails get 409 `EMAIL_EXISTS` and the
  frontend routes to login. On `checkout-success.html` a magic-link code signs
  the buyer into that account; `claim-enrollments` additionally attaches any
  legacy `user_id NULL` rows matching the verified email after every login.
- Fulfillment happens only in `stripe-webhook`, idempotent across duplicate
  deliveries. The payload cannot be re-verified (billing order reads are
  user-scoped; no delivery signature), so order ids are treated as secrets
  and never returned to clients.
- Capacity counts `confirmed` plus `pending` holds younger than 60 minutes,
  in `guest-enroll`, `enroll-guard`, and `class-availability`.
