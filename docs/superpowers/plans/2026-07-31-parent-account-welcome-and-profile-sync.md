# Parent Account Welcome and Profile Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send an explanatory Gmail welcome message alongside Butterbase's security-code email and make durable parent profiles drive the admin Accounts grid.

**Architecture:** Add one user-owned `parent_profiles` table as the identity and contact source of truth. Extend the existing single-file Butterbase functions so admin account creation and resend use the Gmail integration, while parent saves upsert the verified auth identity. Keep Butterbase responsible for all sign-in-code generation and verification.

**Tech Stack:** Static HTML/CSS, browser ES modules, Node's built-in test runner, Butterbase Auth API, Data API, serverless functions, PostgreSQL/RLS, and Butterbase Gmail integration.

## Global Constraints

- The onboarding flow intentionally sends two emails: a Butterbase security-code email and a branded Gmail welcome email.
- Sign-in codes retain Butterbase's documented 15-minute expiry and one-time-use behavior.
- The Gmail sender is `OliVista Art Studio <olivistastudio@gmail.com>` and the subject is `Your OliVista Art Studio account`.
- No Gmail credential or service key may be committed or shipped to new frontend code.
- The browser may not choose a profile owner or authoritative email; use `ctx.user.id` and the email returned by `/auth/{appId}/me`.
- `parent_profiles` is authoritative for CMS name/email, with enrollment values used only as legacy fallback.
- Existing enrollment contact fields continue to be updated for compatibility.
- Butterbase functions remain self-contained single files because `backend/deploy.sh` uploads each file as one source string.
- Do not edit `CHANGELOG.md` or any generated file.
- Never use an em dash in code, copy, documentation, or commit messages.

---

## File Structure

- `backend/functions/admin-manage.js`: admin account creation, profile-backed account listing, Gmail welcome delivery, and onboarding resend.
- `backend/functions/manage-account.js`: verified profile upsert plus compatibility updates to enrollment contact fields.
- `backend/deploy.sh`: inject the connected Gmail user ID only from the deployment environment.
- `backend/schema-notes.md`: record the applied `parent_profiles` schema and RLS policies after deployment.
- `js/login-flow.js`: pure parsing and redirect helpers for email links, independently testable without a DOM.
- `js/login.js`: initialize email-code mode from the welcome link and provide a direct resend-code control.
- `login.html`: accessible resend-code control and contextual code guidance.
- `js/account-profile.js`: pure precedence logic for draft, durable profile, and enrollment fallback values.
- `js/account.js`: load and render the durable parent profile.
- `js/admin-account-messages.js`: pure four-state onboarding delivery copy.
- `js/admin.js`: report welcome delivery, render profile-backed account details, and resend onboarding emails.
- `test/admin-manage.test.mjs`: backend account, Gmail, resend, and aggregation contracts.
- `test/manage-account-profile.test.mjs`: authenticated profile-upsert behavior and legacy enrollment compatibility.
- `test/login-flow.test.mjs`: welcome-link parsing and safe redirect behavior.
- `test/account-profile.test.mjs`: real profile value precedence behavior.
- `test/admin-account-messages.test.mjs`: real delivery-state copy behavior.
- `test/account-contact-save.test.mjs`: account-page durable-profile wiring.

---

### Task 1: Add the durable parent profile schema

**Files:**
- Modify after successful apply: `backend/schema-notes.md`
- Verify against: Butterbase app `app_48ul5eszfv7v`

**Interfaces:**
- Consumes: Butterbase declarative schema API and RLS policy tools.
- Produces: `parent_profiles(user_id, email, parent_name, student_phone, emergency_contact, allergies, created_at, updated_at)` plus user-isolation and service-bypass policies.

- [ ] **Step 1: Fetch the complete current schema and save it outside the repository**

Use the Butterbase schema introspection surface for `app_48ul5eszfv7v`. Do not hand-construct a full-schema payload and do not commit the live schema snapshot. The project has previously observed that the apply endpoint can interpret omissions destructively.

- [ ] **Step 2: Add this exact table definition to the complete schema payload**

```json
{
  "parent_profiles": {
    "columns": {
      "user_id": { "type": "uuid", "primary": true, "nullable": false },
      "email": { "type": "text", "nullable": false, "unique": true },
      "parent_name": { "type": "text", "nullable": false },
      "student_phone": { "type": "text" },
      "emergency_contact": { "type": "text" },
      "allergies": { "type": "text" },
      "created_at": { "type": "timestamptz", "nullable": false, "default": "now()" },
      "updated_at": { "type": "timestamptz", "nullable": false, "default": "now()" }
    }
  }
}
```

- [ ] **Step 3: Dry-run the complete schema**

Set `dry_run: true` and migration name `add parent profiles`. Expected SQL creates only `parent_profiles` and its indexes. Stop if the preview contains `DROP`, alters an existing table, or changes an existing column.

- [ ] **Step 4: Obtain explicit deployment approval before applying production state**

The schema apply and policy creation mutate the live Butterbase app. If approval is not granted during execution, leave this task pending and continue only with mock-backed local implementation.

- [ ] **Step 5: Apply the schema and create RLS policies**

Create user-isolation policies for SELECT, INSERT, and UPDATE using:

```sql
user_id = current_user_id()::uuid
```

Create the existing project-standard service bypass for all operations:

```sql
USING (true) WITH CHECK (true)
```

scoped only to `butterbase_service`. Do not create DELETE access for end users.

- [ ] **Step 6: Verify real policy behavior**

As parent A, insert/select/update a row whose `user_id` is parent A and confirm success. Attempt parent B's ID and confirm denial. With the service key, read the table and confirm cross-parent access. Delete any disposable verification row through the service role.

- [ ] **Step 7: Record the migration**

Append a dated section to `backend/schema-notes.md` containing the migration ID returned by Butterbase, the columns above, and the exact user/service policy intent. Do not write secrets or live user data.

- [ ] **Step 8: Commit**

```bash
git add backend/schema-notes.md
git commit -m "docs: record parent profile schema"
```

---

### Task 2: Persist profiles and send the welcome email during account creation

**Files:**
- Modify: `backend/functions/admin-manage.js:1-150`
- Modify: `test/admin-manage.test.mjs:1-155`

**Interfaces:**
- Consumes: `data(ctx, path, options)`, `apiBase(ctx)`, `ctx.env.SERVICE_KEY`, `ctx.env.INVITATION_GMAIL_USER_ID`, and signup response `{ user: { id } }`.
- Produces: `sendWelcomeEmail(ctx, { email, parentName }): Promise<boolean>` and create response `{ account, welcome_sent }`.

- [ ] **Step 1: Extend the test context with non-secret fixture configuration**

```js
env: {
  BUTTERBASE_APP_ID: "app_test",
  BUTTERBASE_API_URL: "https://api.test",
  SERVICE_KEY: "bb_sk_test",
  INVITATION_GMAIL_USER_ID: "sender-user-1",
  SITE_URL: "https://olivistart.test",
},
```

Update the fetch stub so `/integrations/execute` can return `{ successful: true }` independently of data-table calls.

- [ ] **Step 2: Write a failing creation integration test**

```js
test("create-account persists the profile before sending the branded welcome email", async () => {
  const res = await callHandler(
    request({ action: "create-account", email: "New@Example.com ", display_name: "New Parent" }),
    {
      respond: (url) => {
        if (url.includes("/signup")) return { body: { user: { id: "user-9" } } };
        if (url.includes("/integrations/execute")) return { body: { successful: true } };
        return { body: { user_id: "user-9" } };
      },
    },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.welcome_sent, true);
  const profile = res.calls.find((call) => call.url.endsWith("/parent_profiles"));
  const welcome = res.calls.find((call) => call.url.endsWith("/integrations/execute"));
  assert.ok(res.calls.indexOf(profile) < res.calls.indexOf(welcome));
  assert.deepEqual(profile.body, {
    user_id: "user-9", email: "new@example.com", parent_name: "New Parent",
  });
  assert.equal(welcome.body.toolName, "GMAIL_SEND_EMAIL");
  assert.equal(welcome.body.userId, "sender-user-1");
  assert.equal(welcome.body.params.to, "new@example.com");
  assert.equal(welcome.body.params.subject, "Your OliVista Art Studio account");
  assert.match(welcome.body.params.body, /admin of OliVista Art Studio has created an account for you/);
  assert.match(welcome.body.params.body, /separate security email/);
  assert.match(welcome.body.params.body, /login\.html\?mode=magic-verify&email=new%40example\.com/);
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="persists the profile" test/admin-manage.test.mjs`

Expected: FAIL because no profile or Gmail calls exist and `welcome_sent` is absent.

- [ ] **Step 4: Implement minimal profile persistence and Gmail delivery**

Add `sendWelcomeEmail` using the documented integrations endpoint:

```js
async function sendWelcomeEmail(ctx, { email, parentName }) {
  const loginUrl = `${ctx.env.SITE_URL || "https://olivistart.com"}/login.html?mode=magic-verify&email=${encodeURIComponent(email)}`;
  const body = [
    `Hello${parentName ? ` ${parentName}` : ""},`,
    "",
    "The admin of OliVista Art Studio has created an account for you. Butterbase has sent a separate security email containing your sign-in code. Please use that code to log in:",
    "",
    loginUrl,
    "",
    "Sign-in codes expire after 15 minutes and can be used only once. If your code has expired, request a new one from the login page.",
    "",
    "If you did not expect these emails, please contact OliVista Art Studio.",
  ].join("\n");
  const res = await fetch(`${apiBase(ctx)}/v1/${ctx.env.BUTTERBASE_APP_ID}/integrations/execute`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.env.SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      toolName: "GMAIL_SEND_EMAIL",
      userId: ctx.env.INVITATION_GMAIL_USER_ID,
      params: { to: email, subject: "Your OliVista Art Studio account", body },
    }),
  });
  const result = await res.json().catch(() => ({}));
  return res.ok && result.successful === true;
}
```

After successful signup, POST `{ user_id, email, parent_name }` to `parent_profiles`, then call `sendWelcomeEmail`. Return the current `account` object plus `welcome_sent`.

- [ ] **Step 5: Add and run the Gmail failure test**

```js
test("create-account returns the durable account when welcome delivery fails", async () => {
  const res = await callHandler(request({
    action: "create-account", email: "parent@example.com", display_name: "Parent",
  }), {
    respond: (url) => {
      if (url.includes("/signup")) return { body: { user: { id: "parent-1" } } };
      if (url.includes("/integrations/execute")) return { ok: false, status: 502, body: { error: "gmail down" } };
      return { body: { user_id: "parent-1" } };
    },
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).welcome_sent, false);
  assert.ok(res.calls.some((call) => call.url.endsWith("/parent_profiles")));
});
```

Run: `node --test test/admin-manage.test.mjs`

Expected: PASS with no console output containing upstream response bodies.

- [ ] **Step 6: Commit**

```bash
git add backend/functions/admin-manage.js test/admin-manage.test.mjs
git commit -m "feat: send branded parent welcome emails"
```

---

### Task 3: List profile-backed accounts and resend onboarding emails

**Files:**
- Modify: `backend/functions/admin-manage.js:20-310`
- Modify: `test/admin-manage.test.mjs:285-360`

**Interfaces:**
- Consumes: `sendWelcomeEmail(ctx, { email, parentName })` from Task 2 and `parent_profiles` from Task 1.
- Produces: `resend-invitation` response `{ code_sent, welcome_sent }`; `list-accounts` still returns `{ accounts }` with the existing account shape.

- [ ] **Step 1: Write failing profile-precedence aggregation tests**

Add profile fixtures to the existing `list-accounts` test:

```js
if (url.includes("parent_profiles?")) {
  return { body: [
    { user_id: "p1", email: "profile@e.com", parent_name: "Profile Alice" },
    { user_id: "p4", email: "fresh@e.com", parent_name: "Fresh Parent" },
  ] };
}
```

Assert `p1` uses `Profile Alice/profile@e.com` despite different enrollment values, `p4` appears with zero counts, and legacy `p2/p3` behavior remains unchanged.

- [ ] **Step 2: Run the aggregation test and verify RED**

Run: `node --test --test-name-pattern="aggregates parents" test/admin-manage.test.mjs`

Expected: FAIL because `parent_profiles` is not queried and `p4` is absent.

- [ ] **Step 3: Implement profile-first aggregation**

Change `listAccounts` to fetch profiles, students, and ordered enrollments concurrently. Seed the map from profile rows first. Add student and enrollment counts afterward, and assign enrollment email/name only when the profile value is still null.

- [ ] **Step 4: Write failing resend tests**

```js
test("resend-invitation uses the stored profile email for both messages", async () => {
  const res = await callHandler(request({ action: "resend-invitation", user_id: "parent-7", email: "attacker@example.com" }), {
    respond: (url) => {
      if (url.includes("parent_profiles?")) return { body: [{ email: "real@example.com", parent_name: "Real Parent" }] };
      if (url.includes("/magic-link")) return { body: { message: "sent" } };
      if (url.includes("/integrations/execute")) return { body: { successful: true } };
      return { body: [] };
    },
  });
  assert.deepEqual(await res.json(), { code_sent: true, welcome_sent: true });
  const magic = res.calls.find((call) => call.url.endsWith("/magic-link"));
  const gmail = res.calls.find((call) => call.url.endsWith("/integrations/execute"));
  assert.equal(magic.body.email, "real@example.com");
  assert.equal(gmail.body.params.to, "real@example.com");
});
```

Add table-driven cases for magic success/Gmail failure, magic failure/Gmail success, and both failures. Expected booleans must match each real boundary result.

- [ ] **Step 5: Run resend tests and verify RED**

Run: `node --test --test-name-pattern="resend-invitation" test/admin-manage.test.mjs`

Expected: FAIL with `Unknown action`.

- [ ] **Step 6: Implement resend with independent delivery results**

Add the switch case and `resendInvitation`. Fetch the profile by encoded `user_id`, return 404 when absent, then use `Promise.allSettled` for:

```js
fetch(`${apiBase(ctx)}/auth/${ctx.env.BUTTERBASE_APP_ID}/magic-link`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: profile.email }),
})
```

and `sendWelcomeEmail`. Treat the magic-link result as successful only when its HTTP response is OK. Return both booleans with status 200 so the CMS can describe partial delivery accurately.

- [ ] **Step 7: Run backend tests**

Run: `node --test test/admin-manage.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/functions/admin-manage.js test/admin-manage.test.mjs
git commit -m "feat: resend parent onboarding emails"
```

---

### Task 4: Upsert verified parent profiles on account save

**Files:**
- Modify: `backend/functions/manage-account.js:1-65`
- Create: `test/manage-account-profile.test.mjs`

**Interfaces:**
- Consumes: bearer token, `currentUser(req, ctx, apiBase, appId)`, and editable contact fields.
- Produces: `update-contact` response `{ profile, updated_enrollments }`.

- [ ] **Step 1: Create a real handler harness and failing legacy-account test**

```js
test("update-contact creates a durable profile from verified auth identity", async (t) => {
  const calls = [];
  const ctx = {
    user: { id: "parent-1" },
    env: { BUTTERBASE_API_URL: "https://api.test", BUTTERBASE_APP_ID: "app_test" },
    db: { query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ user_id: "parent-1", email: "parent@example.com", parent_name: "Updated Parent" }], rowCount: 1 };
    } },
  };
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async () => ({ ok: true, json: async () => ({ user: {
    id: "parent-1", email: "parent@example.com", display_name: "Old Parent",
  } }) });
  const req = new Request("https://example.test/manage-account", {
    method: "POST",
    headers: { Authorization: "Bearer parent-jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update-contact", parent_name: "Updated Parent", student_phone: "555-0100" }),
  });

  const res = await handler(req, ctx);
  assert.equal(res.status, 200);
  assert.match(calls[0].sql, /INSERT INTO parent_profiles/);
  assert.match(calls[0].sql, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.deepEqual(calls[0].values.slice(0, 3), ["parent-1", "parent@example.com", "Updated Parent"]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/manage-account-profile.test.mjs`

Expected: FAIL because `update-contact` does not verify `/me` and only updates enrollments.

- [ ] **Step 3: Implement verified profile upsert and compatibility update**

Move `currentUser` before the `update-contact` branch. Pass `me` into `updateContact`. Use one CTE statement so the profile upsert and enrollment update commit together:

```sql
WITH saved_profile AS (
  INSERT INTO parent_profiles
    (user_id, email, parent_name, student_phone, emergency_contact, allergies, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, now())
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    parent_name = EXCLUDED.parent_name,
    student_phone = EXCLUDED.student_phone,
    emergency_contact = EXCLUDED.emergency_contact,
    allergies = EXCLUDED.allergies,
    updated_at = now()
  RETURNING *
), updated_enrollments AS (
  UPDATE enrollments SET
    parent_name = $3,
    student_phone = $4,
    emergency_contact = $5,
    allergies = $6
  WHERE user_id = $1
  RETURNING id
)
SELECT saved_profile.*, (SELECT count(*)::int FROM updated_enrollments) AS updated_enrollments
FROM saved_profile
```

Use the verified `me.email`. Require a non-empty parent name, with `me.display_name` or `me.email` as the legacy fallback when no name is supplied. Convert empty optional contact fields to `null` so parents can clear them.

- [ ] **Step 4: Add authorization and cross-user regression tests**

Cover missing bearer, `/me` ID mismatch, and a request body containing a forged `user_id/email`. Assert the SQL values still use `ctx.user.id` and verified `me.email`.

- [ ] **Step 5: Run focused and existing account tests**

Run: `node --test test/manage-account-profile.test.mjs test/account-contact-save.test.mjs test/password-reset-code.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/functions/manage-account.js test/manage-account-profile.test.mjs
git commit -m "fix: persist verified parent profiles"
```

---

### Task 5: Load durable profiles on the parent account page

**Files:**
- Create: `js/account-profile.js`
- Create: `test/account-profile.test.mjs`
- Modify: `js/account.js:15-40,450-590,1080-1130`

**Interfaces:**
- Consumes: `parent_profiles` RLS GET and `manage-account` response from Task 4.
- Produces: `getContactValue({ draft, profile, enrollment }, key): string`, `state.profile`, and profile-first form values with enrollment fallback.

- [ ] **Step 1: Write failing profile precedence tests**

Create `test/account-profile.test.mjs`:

```js
test("contact values prefer drafts, then profiles, then legacy enrollments", () => {
  const source = {
    draft: { parent_name: "Typed Name", student_phone: "" },
    profile: { parent_name: "Profile Name", student_phone: "555-0100", allergies: null },
    enrollment: { parent_name: "Legacy Name", student_phone: "555-9999", allergies: "None" },
  };
  assert.equal(getContactValue(source, "parent_name"), "Typed Name");
  assert.equal(getContactValue(source, "student_phone"), "");
  assert.equal(getContactValue(source, "allergies"), "None");
  assert.equal(getContactValue(source, "emergency_contact"), "");
});
```

This fails if profile precedence is reversed or an intentionally cleared draft is discarded.

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/account-profile.test.mjs`

Expected: FAIL because `js/account-profile.js` does not exist.

- [ ] **Step 3: Implement the helper, profile loading, and rendering**

Implement `getContactValue` using own-property checks for drafts, nullish checks for profile/enrollment values, and an empty-string fallback. Import it into `account.js`.

Add `profile: null` to state. In `loadData`, fetch:

```js
apiGet("parent_profiles?select=user_id,email,parent_name,student_phone,emergency_contact,allergies&limit=1", token)
```

Assign `state.profile = profiles[0] || null`. For each profile form value call `getContactValue({ draft: state.contactDraft, profile: state.profile, enrollment: en }, key)`. After save, accept `result.profile` immediately and still call `loadData` to refresh all compatibility data.

- [ ] **Step 4: Run account tests**

Run: `node --test test/account-profile.test.mjs test/account-contact-save.test.mjs test/password-reset-code.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/account-profile.js js/account.js test/account-profile.test.mjs
git commit -m "fix: render parent contact data from profiles"
```

---

### Task 6: Open welcome links directly in email-code mode

**Files:**
- Create: `js/login-flow.js`
- Create: `test/login-flow.test.mjs`
- Modify: `js/login.js:1-100`
- Modify: `login.html:45-78`

**Interfaces:**
- Produces: `getInitialLoginState(search): { mode, email }` and `safeNextPath(candidate, fallback): string`.
- Consumes: query `mode=magic-verify&email=...`, existing `sendMagicLink`, and existing `verifyMagicLink`.

- [ ] **Step 1: Write failing pure flow tests**

```js
test("welcome links open code verification with a normalized prefilled email", () => {
  assert.deepEqual(
    getInitialLoginState("?mode=magic-verify&email=Parent%40Example.com"),
    { mode: "magic-verify", email: "parent@example.com" },
  );
});

test("unknown modes fall back to password login", () => {
  assert.deepEqual(getInitialLoginState("?mode=unknown&email=x%40e.com"), {
    mode: "password", email: "x@e.com",
  });
});

test("safeNextPath allows only same-site relative destinations", () => {
  assert.equal(safeNextPath("registration.html?id=1", "account.html"), "registration.html?id=1");
  assert.equal(safeNextPath("https://evil.test", "account.html"), "account.html");
  assert.equal(safeNextPath("//evil.test", "account.html"), "account.html");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/login-flow.test.mjs`

Expected: FAIL because `js/login-flow.js` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Use `URLSearchParams`, allow only `password`, `magic-send`, and `magic-verify`, normalize email with `trim().toLowerCase()`, and reject next values whose parsed URL origin differs from `https://olivistart.local` or whose raw value starts with `//`.

- [ ] **Step 4: Wire initial mode and resend control**

Import both helpers in `login.js`. Prefill `#email`, call `setMode(initial.mode)`, and show:

`Enter the code from the separate security email. Codes expire after 15 minutes.`

Add this accessible control under the code field:

```html
<button type="button" class="auth-link-button" id="resend-code" hidden>
  Send a new code
</button>
```

Show it in `magic-verify`; on click call `sendMagicLink(currentEmail)` and show the existing sent confirmation. Use `safeNextPath(getQueryParam("next"), "account.html")` in `finishLogin`.

- [ ] **Step 5: Run flow and auth tests**

Run: `node --test test/login-flow.test.mjs test/auth.test.mjs test/signup.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/login-flow.js js/login.js login.html test/login-flow.test.mjs
git commit -m "feat: open parent welcome links in code mode"
```

---

### Task 7: Surface delivery and resend behavior in the admin CMS

**Files:**
- Create: `js/admin-account-messages.js`
- Create: `test/admin-account-messages.test.mjs`
- Modify: `js/admin.js:390-560`

**Interfaces:**
- Consumes: create response `{ account, welcome_sent }` and resend response `{ code_sent, welcome_sent }`.
- Produces: `getOnboardingDeliveryMessage({ code_sent, welcome_sent }): string`, accurate admin notifications, and `resend-invitation` using only `user_id`.

- [ ] **Step 1: Write failing delivery behavior tests**

Create a table-driven real behavior test:

```js
test("onboarding delivery copy distinguishes every partial result", () => {
  const cases = [
    [{ code_sent: true, welcome_sent: true }, "Security code and welcome email sent."],
    [{ code_sent: true, welcome_sent: false }, "Security code sent, but the welcome email failed. Try resending again."],
    [{ code_sent: false, welcome_sent: true }, "Welcome email sent, but the security code failed. Try resending again."],
    [{ code_sent: false, welcome_sent: false }, "Neither onboarding email could be sent. Try again."],
  ];
  for (const [result, expected] of cases) {
    assert.equal(getOnboardingDeliveryMessage(result), expected);
  }
});
```

The real browser end-to-end test in Task 9 verifies that the CMS calls the
`resend-invitation` boundary using only `user_id`. Do not add a source-text test
for UI wiring.

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/admin-account-messages.test.mjs`

Expected: FAIL because the message module does not exist.

- [ ] **Step 3: Implement creation messaging**

Replace the unconditional creation toast with the two exact messages from the spec, then continue routing to `accountDetail` with the returned account.

- [ ] **Step 4: Implement resend UI and four-state result copy**

Add `Resend onboarding emails` to the detail header. Call `adminFn("resend-invitation", { user_id: userId })`. Put this exact mapping in `getOnboardingDeliveryMessage` and call the helper from the CMS:

```js
const message = result.code_sent && result.welcome_sent
  ? "Security code and welcome email sent."
  : result.code_sent
    ? "Security code sent, but the welcome email failed. Try resending again."
    : result.welcome_sent
      ? "Welcome email sent, but the security code failed. Try resending again."
      : "Neither onboarding email could be sent. Try again.";
```

Disable the button while the request is active and restore it in `finally`.

- [ ] **Step 5: Run admin frontend tests**

Run: `node --test test/admin-account-messages.test.mjs test/admin-manage.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/admin-account-messages.js js/admin.js test/admin-account-messages.test.mjs
git commit -m "feat: show parent onboarding delivery status"
```

---

### Task 8: Make deployment configuration explicit and safe

**Files:**
- Modify: `backend/deploy.sh:20-95`
- Modify: `backend/README.md`
- Test: existing shell execution with a dry environment

**Interfaces:**
- Consumes: deployment environment `INVITATION_GMAIL_USER_ID`.
- Produces: encrypted function env entry for `admin-manage`; no frontend exposure.

- [ ] **Step 1: Write the failing deployment precondition check**

Run:

```bash
env -u INVITATION_GMAIL_USER_ID BUTTERBASE_API_KEY=test ./backend/deploy.sh admin-manage
```

Expected after implementation: exit before any network call with `error: set INVITATION_GMAIL_USER_ID when deploying admin-manage`. Before implementation it proceeds to a network request, demonstrating the missing guard. Interrupt before it can mutate anything if needed.

- [ ] **Step 2: Add the scoped shell guard**

When selected functions include `admin-manage`, require a non-empty `INVITATION_GMAIL_USER_ID`. Pass it into the generated `envVars` object as:

```python
"INVITATION_GMAIL_USER_ID": os.environ.get("INVITATION_GMAIL_USER_ID", ""),
```

Do not place a real ID in the script or README.

- [ ] **Step 3: Document one-time Gmail setup**

In `backend/README.md`, document enabling the Gmail toolkit, connecting `olivistastudio@gmail.com` through OAuth, setting its Gmail display name to `OliVista Art Studio`, identifying the connected Butterbase user ID, and exporting it only for deployment.

- [ ] **Step 4: Verify shell syntax and guard behavior**

Run:

```bash
bash -n backend/deploy.sh
env -u INVITATION_GMAIL_USER_ID BUTTERBASE_API_KEY=test ./backend/deploy.sh admin-manage
```

Expected: syntax check passes; second command exits locally with the exact guard error and makes no network request.

- [ ] **Step 5: Commit**

```bash
git add backend/deploy.sh backend/README.md
git commit -m "chore: require Gmail sender for admin deployment"
```

---

### Task 9: Run end-to-end and full regression verification

**Files:**
- Verify: all modified files
- Do not modify generated files or production data without explicit approval.

**Interfaces:**
- Consumes: completed Tasks 1-8.
- Produces: evidence that admin creation, two-email onboarding, parent save, and CMS refresh work as one user journey.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
node --test
bash -n backend/deploy.sh
git diff --check
```

Expected: all tests pass, shell syntax passes, and diff check is clean with no warnings.

- [ ] **Step 2: Inspect the full branch diff and secret surface**

Run:

```bash
git diff main...HEAD --stat
git diff main...HEAD
git grep -n "INVITATION_GMAIL_USER_ID" -- ':!docs/superpowers/**'
```

Confirm only the environment variable name appears, never its value. Confirm no service key or OAuth data was added.

- [ ] **Step 3: Start a local static server and browser session**

Serve the repository without writing generated output:

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Use a real browser with controlled network responses for Butterbase auth, Data API, admin-manage, manage-account, and Gmail integration boundaries.

- [ ] **Step 4: Reproduce the admin-to-parent journey**

1. Open `admin.html`, authenticate as the controlled admin, and create `parent.e2e@example.com` with name `Original Parent`.
2. Assert exactly one signup request and one Gmail integration request occurred.
3. Inspect the captured Gmail body for the approved introduction and welcome URL.
4. Confirm the CMS success or failure message matches the mocked Gmail result.
5. Follow the welcome URL. Confirm email is prefilled, the code form is active, the separate-security-email guidance is visible, focus is sensible, and password is not required.
6. Complete magic-link verification with the controlled Butterbase response.
7. On `account.html`, edit the name to `Updated Parent` and save.
8. Confirm the manage-account request body contains the edited fields but no user ID or authoritative email.
9. Return to the Accounts grid, refresh, and confirm `Updated Parent` plus `parent.e2e@example.com` replace both dashes.
10. Trigger `Resend onboarding emails` and exercise all four response combinations.

- [ ] **Step 5: Perform pixel and accessibility checks**

At desktop and 390px mobile widths, inspect the login card, code input, resend control, admin notification, and account grid. Confirm no clipping, overlap, unexpected scroll, inaccessible unlabeled control, broken focus indicator, console error, failed request, or obvious unrelated visual defect.

- [ ] **Step 6: Run live smoke testing only after deployment approval and Gmail OAuth setup**

Use a disposable inbox, not a real family. Confirm the two actual emails arrive, the Gmail sender displays as OliVista Art Studio, the code works within 15 minutes, profile save persists, and the production Accounts grid refreshes correctly. Remove disposable profile rows only through a scoped service-role operation after resolving their exact IDs.

- [ ] **Step 7: Final verification commit if E2E required code corrections**

If verification required source changes, repeat the relevant RED/GREEN cycle and commit only the correction. If no source changed, do not create an empty commit.
