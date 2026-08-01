# Final security remediation report

Date: 2026-08-01

Base commit: `5249be4de2f22fe4a42f211ed721a09eb2f51abc`

Implementation commits:

- `d4f2fee` (`fix: harden parent account management`)
- `f1ff2c9` (`fix: make admin account recovery durable`)
- `95fde13` (`fix: secure function deployment payloads`)
- `09abc60` (`fix: reject unknown deploy selections`)

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
- Every gateway read now sends an explicit `select` projection. An omitted query
  or omitted select defaults to the resource's complete read allowlist, so the
  service-key request can never fall back to an unrestricted row shape.
- Blank and whitespace-only nullable program descriptions, image URLs, and
  schedule notes are normalized to `null` at the function boundary.
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

Green evidence: `test/admin-data-gateway.test.mjs` passes 12 of 12, including
exact default projections for both omitted-query forms, nullable-field
normalization, non-admin rejection, disallowed resource and operation rejection,
fixed action validation, browser source checks, and the tracked
executable-source scan.

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
- After signup, `admin-manage` stores the normalized account identity in durable
  private `ctx.kv` under an email-keyed namespace with a 30-day TTL before
  attempting profile persistence. Butterbase documents function KV as durable
  and private by default, so the implementation never calls `expose` and clients
  cannot read the pending record. See the official
  [Butterbase KV documentation](https://docs.butterbase.ai/core-concepts/kv/).
- A later create retry or explicit `lookup-account-recovery` resolves that record
  without another signup. Normal `EMAIL_EXISTS` behavior remains when no pending
  record exists.
- Recovery requires the submitted user ID and normalized email to match the
  private pending record. The record is deleted only after profile persistence
  succeeds. KV lookup failures fail closed before signup, while set and delete
  failures are reported in structured recovery state.
- The CMS keeps the incomplete-profile warning visible, distinguishes partial
  outcomes, and offers `Complete setup and resend onboarding` without recreating
  the auth account.
- The incomplete-profile view renders before, and independently of, student,
  enrollment, schedule, and program reads. A Data API outage cannot hide the
  durable recovery action.
- Browser acceptance found and fixed a notice-lifecycle regression where a
  transient creation message removed the persistent recovery warning.

Red evidence: focused tests failed first for profile rejection, Gmail rejection,
missing recovery behavior, idempotent update behavior, persistent notice
rendering, missing KV persistence, second signup on retry, unknown lookup,
accepted tampering, KV failures, and missing successful cleanup. The
handler-backed browser test then failed after reload because nonessential account
detail reads hid the recovery UI during the simulated Data API outage.

Green evidence: the admin management suite passes 41 of 41, including reload
retry, one-signup behavior, explicit lookup, tampered user and email, get/set/del
failure semantics, 30-day TTL, idempotent profile persistence, and successful KV
clearing. The account messages and CMS suites pass all recovery and
partial-delivery cases.

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
- Added a source policy regression test using the escaped `\u2014` code point so
  the test itself follows the text rule. All files changed from the remediation
  base were scanned, and remaining changed-file comment literals were replaced
  with plain hyphens.
- Browser visual inspection at 390 px found the CMS navigation clipped after the
  first sections. A failing viewport assertion was added, then the mobile nav was
  changed to wrap so every section remains visible.
- Replaced the remaining prohibited literals in the changed `enroll.html` and
  `registration.html` metadata with plain hyphens.

### 6. Deployment payload security and environment scope

- `backend/deploy.sh` creates one unique payload with `mktemp` for each script
  invocation under the resolved temporary directory. It validates the exact
  six-character random-suffix path, rejects non-regular files and symlinks,
  applies and verifies mode `0600`, and installs an `EXIT` trap before creation.
- The trap removes only the exact validated payload on normal completion and on
  failures. The fixed `/tmp/bb-deploy-payload.json` path is never opened or
  reused.
- Curl reads its configuration from standard input. Authorization material is
  not present in curl process arguments, and failure output does not echo the
  response or payload.
- Sensitive function environment variables are now least privilege:
  - `SERVICE_KEY`: `admin-manage`, `enroll-guard`, `guest-enroll`,
    `manage-account`, `manage-artwork`, and `trigger-schedule-bake` only.
  - `GITHUB_TOKEN`: `trigger-schedule-bake` only.
  - `INVITATION_GMAIL_USER_ID`: `admin-manage` only.
- Selection-aware validation requires the Gmail user ID only when
  `admin-manage` is selected and the GitHub token only when
  `trigger-schedule-bake` is selected. The Butterbase API key remains mandatory
  for every deployment because it authenticates the deploy request itself.
- Every supplied function selection is validated against the configured
  function list before selection-specific secret checks, temporary payload
  creation, or network access. Any unknown value, including one mixed with a
  valid selection, produces a non-secret diagnostic and exits with status 1.
  Argument-bearing invocations must match at least one configuration.

Red evidence: the expanded shell integration test first failed because all
function payloads contained broad sensitive environment entries. Reordered
lifecycle assertions then failed because every function reused the fixed `/tmp`
payload instead of a validated private temporary file. The final selection tests
then showed that all-unknown input exited successfully after creating a temporary
payload, while mixed valid and unknown input also called curl and generated a
deployment payload.

Green evidence: `test/deploy.test.sh` intercepts the real script for all 13
configured functions and passes. It proves the exact environment map, 0600 mode,
unique paths between runs, cleanup after success and simulated curl failure,
rejection without deletion of an invalid `mktemp` result, selection-aware
fail-fast behavior, and absence of fixture authorization material from curl
arguments and failure logs. The suite also instruments both `mktemp` and curl for
all-unknown and mixed valid/unknown selections, proving that rejection occurs
with no temporary payload creation, captured payload, or network attempt.

## Final verification

All commands were run from the isolated feature worktree after the fixes:

| Check | Result |
| --- | --- |
| `node --test` | 203 passed, 0 failed |
| `bash test/deploy.test.sh` | all 13 payload scopes, private temp lifecycle, failure cleanup, selection validation, and fail-fast checks passed |
| `bash -n backend/deploy.sh test/deploy.test.sh` | passed |
| `node --check` for browser, deployed function, archived function, and browser verifier JavaScript | passed |
| `git diff --check` | passed |
| tracked `*.js` and `*.html` Butterbase service-credential scan | 0 matching files |
| all files changed from the remediation base scanned for prohibited em dash literals | 0 matching files |

The isolated Google Chrome acceptance script completed the real admin and parent
UI flows with a temporary browser profile. It invoked the real
`backend/functions/admin-manage.js` handler while mocking every external
boundary:

- 67 intercepted browser API requests and 54 handler outbound requests.
- Exactly 1 signup across initial creation and reload retry.
- Pending private KV recovery existed after the simulated profile failure and
  was absent after successful recovery.
- 0 nonessential Data API reads while the recovery-only view rendered during a
  simulated Data API outage.
- 0 direct admin Data API requests.
- 0 browser authorization headers containing a Butterbase service credential.
- Direct parent `parent_profiles` patch returned 403.
- Parent profile save succeeded through `manage-account` without browser-supplied
  `user_id` or `email`.
- Admin refresh displayed the updated parent name and verified email.
- Account creation failure state, explicit recovery, partial resend messaging,
  reload retry, welcome-link prefilling, and code focus all passed.
- Blank program description, blank program image URL, and blank schedule notes
  reached the handler and then the mocked Data API as `null`.
- Every handler-backed admin read carried an explicit `select` projection.
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
   Confirm the function runtime provides `ctx.kv`; no KV expose rule should be
   created because pending recovery records must remain function-private.
4. Deploy the remediated `admin-manage` and `manage-account` functions and the
   static browser assets as one coordinated release.
5. While the app is paused, apply and verify
   `backend/migrations/2026-08-01-parent-profiles-select-only-policy.md`. Require
   own-row SELECT, service bypass, and no end-user INSERT, UPDATE, DELETE, or ALL
   policy before resuming.
6. Run an approved disposable-user smoke test for admin creation, forced profile
   failure, browser reload and create retry, one-signup behavior, recovery, both
   onboarding deliveries, parent profile update, admin refresh, cross-user read
   denial, direct parent write denial, and pending KV deletion after profile
   success.
7. Resume traffic only after the policy, function, static asset, credential
   rotation, and smoke-test checks all pass. Retain the pre-migration RLS snapshot
   for the documented rollback procedure.
