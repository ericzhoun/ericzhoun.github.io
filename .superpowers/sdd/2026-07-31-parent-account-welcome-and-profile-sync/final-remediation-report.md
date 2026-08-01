# Final security remediation report

Date: 2026-08-01

Base commit: `5249be4de2f22fe4a42f211ed721a09eb2f51abc`

Implementation commit: `d4f2fee` (`fix: harden parent account management`)

## Safety boundary

This remediation was implemented and verified only in the isolated
`codex/fix-parent-account-sync` worktree. It did not read or mutate live schema,
rotate credentials, deploy, use OAuth, or send email. All browser network calls
were intercepted and mocked on localhost.

## Remediation results

### 1. Browser credential and admin data access

- Removed the browser `ADMIN_KEY` and direct `adminApi` implementation.
- Added a structured browser client that calls `admin-manage` with the admin's
  refreshed end-user JWT.
- Added a server-side data gateway with fixed resource, operation, field,
  identifier, filter, select, order, and limit allowlists.
- Kept schedule publishing and attendance behind separate explicit actions.
- Preserved dashboard, CRUD, attendance, account detail, and schedule publish
  behavior.
- Removed the remaining embedded Butterbase service credential from archived
  executable source. The archived billing function now fails closed when its
  server environment key is absent.

Red evidence: the new gateway suite first failed because the browser client did
not exist, then because requests were not yet constrained. The repository-wide
executable-source credential test also failed until the archived fallback was
removed.

Green evidence: `test/admin-data-gateway.test.mjs` passes 9 of 9, including
non-admin rejection, disallowed resource and operation rejection, fixed action
validation, browser source checks, and the tracked executable-source scan.

### 2. Server-authoritative parent profile identity

- `manage-account` now re-verifies `/me`, requires the verified user ID to match
  `ctx.user.id`, normalizes and validates the verified email, and writes the
  profile with its server-only service credential.
- Browser-provided `user_id` and `email` are ignored. Update requests omit the
  identity fields, while create requests use only server-verified values.
- The implementation uses documented Data API operations: read by primary key,
  then patch or create, with a conflict-safe patch retry.
- Legacy enrollment compatibility updates remain under the parent's RLS context,
  and the function returns the persisted profile row.
- Added the specified, not applied, idempotent select-only RLS migration runbook
  at `backend/migrations/2026-08-01-parent-profiles-select-only-policy.md`.

Red evidence: the rewritten profile tests initially failed against the former
parent-context SQL persistence path.

Green evidence: `test/manage-account-profile.test.mjs` passes 5 of 5, covering
verified persistence, legacy create, forged identity fields, invalid verified
identity, and verified-name fallback.

### 3. Recoverable account creation

- Once signup succeeds, account creation always returns durable structured state
  with independent profile, security-code, and welcome-email outcomes.
- Profile HTTP rejection and Gmail network rejection are caught independently.
- Added an idempotent admin-only `recover-account` action that creates or updates
  the missing profile and retries both onboarding deliveries independently.
- The CMS keeps the incomplete-profile warning visible, distinguishes partial
  outcomes, and offers `Complete setup and resend onboarding` without recreating
  the auth account.
- Browser acceptance found and fixed a notice-lifecycle regression where a
  transient creation message removed the persistent recovery warning.

Red evidence: focused tests failed first for profile rejection, Gmail rejection,
missing recovery behavior, idempotent update behavior, and persistent notice
rendering.

Green evidence: the admin management, account messages, and CMS source suites
pass all recovery and partial-delivery cases.

### 4. Safe return paths

- `safeNextPath` now accepts only normalized site-relative paths and returns only
  pathname, query, and fragment.
- It rejects schemes, authority forms, raw backslashes, encoded and repeatedly
  encoded slash or backslash bypasses, malformed percent escapes, control
  characters, empty input, and absolute `.local` URLs.

Red evidence: the expanded adversarial cases failed against the prior parser.

Green evidence: `test/login-flow.test.mjs` passes 6 of 6.

### 5. Copy and responsive UI

- Replaced prohibited em dashes in `js/account.js` with plain hyphens.
- Added a source policy regression test.
- Browser visual inspection at 390 px found the CMS navigation clipped after the
  first sections. A failing viewport assertion was added, then the mobile nav was
  changed to wrap so every section remains visible.

## Final verification

All commands were run from the isolated feature worktree after the fixes:

| Check | Result |
| --- | --- |
| `node --test` | 193 passed, 0 failed |
| `bash test/deploy.test.sh` | passed |
| `bash -n backend/deploy.sh test/deploy.test.sh` | passed |
| `node --check` for browser, deployed function, and archived function JavaScript | passed |
| `git diff --check` | passed |
| tracked `*.js` and `*.html` Butterbase service-credential scan | 0 matching files |

The isolated Google Chrome acceptance script completed the real admin and parent
UI flows with a temporary browser profile and mocked external boundaries:

- 50 intercepted API requests.
- 13 admin function requests.
- 0 direct admin Data API requests.
- 0 browser authorization headers containing a Butterbase service credential.
- Direct parent `parent_profiles` patch returned 403.
- Parent profile save succeeded through `manage-account` without browser-supplied
  `user_id` or `email`.
- Admin refresh displayed the updated parent name and verified email.
- Account creation failure state, explicit recovery, partial resend messaging,
  welcome-link prefilling, and code focus all passed.
- 390 by 844 viewport had no document overflow and all admin navigation links
  were on-screen.
- 0 unexpected console warnings or errors.

The browser verifier is reproducible with
`scripts/verify-final-remediation-browser.mjs`. It requires `playwright-core` and
Google Chrome, starts an isolated localhost server, mocks every external request,
and removes its temporary browser profile when complete.

## Live rollout prerequisites

1. Obtain explicit production approval and schedule a maintenance window.
2. Inventory every server-side consumer of the exposed Butterbase service key.
   Because the credential was previously shipped to browsers and remains in Git
   history, rotate or revoke it during the approved rollout and update all
   encrypted server function environments. Do not restore it to client source.
3. Confirm `SERVICE_KEY`, app ID, API URL, site URL, and approved Gmail integration
   settings are present in the affected server functions without printing their
   values.
4. Deploy the remediated `admin-manage` and `manage-account` functions and the
   static browser assets as one coordinated release.
5. While the app is paused, apply and verify
   `backend/migrations/2026-08-01-parent-profiles-select-only-policy.md`. Require
   own-row SELECT, service bypass, and no end-user INSERT, UPDATE, DELETE, or ALL
   policy before resuming.
6. Run an approved disposable-user smoke test for admin creation, forced profile
   recovery, both onboarding deliveries, parent profile update, admin refresh,
   cross-user read denial, and direct parent write denial.
7. Resume traffic only after the policy, function, static asset, credential
   rotation, and smoke-test checks all pass. Retain the pre-migration RLS snapshot
   for the documented rollback procedure.
