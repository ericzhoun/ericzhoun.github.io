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
- `migrate.py` / `create_users.py` - copy an app's data to another app. Used
  for the 2026-08-05 herfield -> olivista-studio cutover; see "Migrating".

## Deploying

```bash
BUTTERBASE_API_KEY=bb_sk_... ./backend/deploy.sh                # all
BUTTERBASE_API_KEY=bb_sk_... ./backend/deploy.sh guest-enroll   # one
```

The key is the app service key (Butterbase dashboard). It bypasses RLS;
never commit it or ship it to the frontend.

### Deploy from WSL, not Git Bash, on Windows

`deploy.sh` does not run under Git Bash. Two independent reasons:

- It writes the deploy payload, which contains `SERVICE_KEY`, to a temp file
  and aborts with `deploy payload permissions are not private` unless the mode
  is `0600`. Windows reports `0666` however the file is created, so the check
  can never pass there. The check is right and Windows genuinely cannot offer
  the protection it wants - do not relax it to work around this.
- With `core.autocrlf` on, the working tree is CRLF and Linux bash fails on
  `set -o pipefail\r`, so the script also needs its line endings normalized
  before a Linux shell will read it.

Run it from WSL against a CR-stripped copy. `$0` sets the functions directory,
so the copy has to sit in `backend/`:

```bash
set -a; . ./.env; set +a
tr -d '\r' < backend/deploy.sh > backend/.deploy-lf.sh
wsl.exe -d Ubuntu-22.04 -- bash -c "cd /mnt/d/workplace/ericzhoun.github.io && \
  BUTTERBASE_API_KEY='$BUTTERBASE_API_KEY' \
  INVITATION_GMAIL_USER_ID='$INVITATION_GMAIL_USER_ID' \
  bash ./backend/.deploy-lf.sh admin-manage"
rm -f backend/.deploy-lf.sh
```

The payload lands in WSL's `/tmp`, which is ext4, so `0600` holds there. From
Git Bash, prefix the `wsl.exe` call with `MSYS_NO_PATHCONV=1` or it rewrites
`/mnt/...` into a Windows path. On macOS or Linux, none of this applies - just
run `./backend/deploy.sh` directly.

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

### Pending families

A family the admin has recorded but that owns no account yet lives in
`pending_parents`; its students carry `pending_parent_id` with `user_id` NULL.
`create-pending-parent` needs only a name. An enrollment needs an email,
because `enrollments.student_email` is NOT NULL. `promote-pending-parent`
creates the real account and folds the placeholder in; `claim-enrollments`
does the same automatically when the family signs up with that email itself.
`update-account` edits a real profile but never its email, which is the
account's sign-in identity.

`pending_parents` is admin-only: RLS is enabled with no end-user policies, just
the service bypass. Note that `schema/apply` creates tables with RLS **off** -
call `POST /v1/{app_id}/rls/enable` after adding any table, then confirm an
unauthenticated `GET /v1/{app_id}/{table}` returns `[]`.

### Family broadcasts

`send-broadcast` sends one plain-text email per family through the same
`GMAIL_SEND_EMAIL` toolkit the invitations use. Recipients are always
resolved server-side from the studio's own records - the admin browser sends
only `{subject, message, audience}`, never a recipient list. Audiences:
`test` (the admin caller's own address), `all` (every parent profile and
pending family with an email, deduplicated), `program:<id>` (families with a
non-cancelled enrollment in that program, falling back to the enrollment's
`student_email` when no parent account exists). Broadcasts are capped at 500
recipients; individual failures are reported per address and never abort the
remaining deliveries.

### Student deletion

`delete-students` permanently removes roster students by id (max 100 per
call, deduplicated; a student already deleted elsewhere counts as deleted).
Enrollments survive with `student_id` set to NULL so payment and attendance
history stay intact; artwork photos cascade away with the student via the
schema. The CMS roster exposes it as checkbox multi-select plus a bulk
"Delete selected" action with an explicit confirmation, alongside per-row
View profile / Edit menus, client-side search, sorting, and CSV export.
ClassManager additionally soft-deletes (restorable) students; that needs an
`archived_at` column plus filtered reads everywhere, so it is a possible
follow-up rather than part of this action.

## Google sign-in

End users can sign up and log in with Google through Butterbase's managed
OAuth flow. Password and magic-link sign-in keep working unchanged.

- **Provider registration.** Create a Google Cloud OAuth client (type
  "Web application") with authorized redirect URI
  `https://api.butterbase.ai/auth/app_0otd4vmczvu8/oauth/google/callback`,
  then register it (the service key authorizes the call; the frontend list
  mirrors the platform callback plus the static-site landing page):

  ```
  POST /v1/app_0otd4vmczvu8/auth/oauth-config
  Authorization: Bearer $BUTTERBASE_API_KEY
  {
    "provider": "google",
    "client_id": "\u2026apps.googleusercontent.com",
    "client_secret": "\u2026",
    "redirect_uris": [
      "https://api.butterbase.ai/auth/app_0otd4vmczvu8/oauth/google/callback",
      "https://olivistart.com/auth-callback.html"
    ]
  }
  ```

  `GET /v1/{app_id}/auth/oauth-config` lists registered providers.

- **Frontend flow.** The login/signup pages call `beginGoogleSignIn(next)`
  (js/auth.js), which saves the destination and sends the browser to
  `/auth/{app_id}/oauth/google?redirect_to=https://olivistart.com/auth-callback.html`.
  Butterbase redirects back with `?access_token=\u2026&refresh_token=\u2026`;
  js/auth-callback.js stores the session under the same localStorage keys as
  password/magic-link login, claims enrollments, and continues to the saved
  destination. Tokens ride in the callback URL by platform design; the page
  leaves it with `location.replace` so they do not linger in back/forward.

- **Account linking.** A Google sign-in whose email already owns an account
  (magic-link, password, or guest-checkout) is expected to land in that same
  account. Verify after enabling: sign in both ways with one address and
  confirm the enrollment/claim paths (keyed on verified email) still resolve
  to one profile. Admin access keeps working by email allowlist - a Google
  login with an allowlisted address gets the CMS.

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

## Migrating to another app

`migrate.py` copies table rows between two Butterbase apps, preserving primary
keys, `created_at`, and dates so foreign keys keep resolving. `create_users.py`
recreates the end users first, because their ids necessarily change.

Order matters - parents before children, or the foreign keys reject the insert:

```bash
export SRC=app_old DST=app_new SRC_KEY=bb_sk_... DST_KEY=bb_sk_...

# 1. Recreate accounts. Roster is a JSON file of {old_id, email, display_name},
#    built from manage_auth_users list on the source app. It holds customer
#    email addresses, so it is gitignored - this repo is public.
ROSTER=backend/roster.json ./backend/create_users.py --out backend/user_map.json

# 2. Catalog tables carry no user data and can move any time.
./backend/migrate.py semesters programs class_schedules class_sessions

# 3. User-scoped tables, with ids remapped.
USER_MAP=backend/user_map.json \
SKIP_USERS=<comma-separated source user ids to exclude> \
  ./backend/migrate.py parent_profiles students enrollments bookings artwork_photos
```

Both scripts are idempotent - rows and accounts already present are skipped, so
a partial run (signup is rate limited to roughly 5 per 15 minutes) can be
re-run. `migrate.py` refuses any row whose `user_id` is missing from the map
rather than writing a dangling reference, and skips child rows whose parent was
deliberately excluded.

Two things it does not carry:

- **Passwords.** Butterbase exposes no hash export, so users sign in with a
  magic-link code afterwards. Recreated accounts start `email_verified: false`,
  which `claim-enrollments` rejects until they verify.
- **Storage objects.** Re-upload them and rewrite the referencing column
  (`artwork_photos.storage_object_id`) via `REMAP`, since re-upload mints a new
  object id.
