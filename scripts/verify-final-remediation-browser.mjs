import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_CORE_PATH || "playwright-core";
const { chromium } = require(playwrightPath);

const origin = "http://127.0.0.1:4173";
const apiOrigin = "https://api.butterbase.ai";
const appId = "app_48ul5eszfv7v";
const parentId = "11111111-1111-4111-8111-111111111111";
const browserProfile = await mkdtemp(join(tmpdir(), "olivistart-browser-"));
const server = spawn("python3", ["-m", "http.server", "4173", "--bind", "127.0.0.1"], {
  cwd: new URL("../", import.meta.url),
  stdio: "ignore",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${origin}/admin.html`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local test server did not start");
}

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launchPersistentContext(browserProfile, {
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  const page = browser.pages()[0] || await browser.newPage();
  const apiRequests = [];
  const consoleProblems = [];
  let expectedDirectDenial = false;
  let expectedDirectDenialMessages = 0;
  let activeRole = "admin";
  let accountExists = false;
  let profileName = "Original Parent";

  page.on("console", (message) => {
    if (!["warning", "error"].includes(message.type())) return;
    if (expectedDirectDenial && message.text().includes("403 (Forbidden)")) {
      expectedDirectDenialMessages += 1;
      return;
    }
    consoleProblems.push(message.text());
  });
  page.on("pageerror", (error) => consoleProblems.push(error.message));

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      await route.continue();
      return;
    }

    const record = {
      role: activeRole,
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body: request.postDataJSON?.() || null,
    };
    apiRequests.push(record);

    if (url.origin !== apiOrigin) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (url.pathname === `/auth/${appId}/refresh`) {
      const user = activeRole === "admin"
        ? { id: "admin-1", email: "herfield8@gmail.com", display_name: "Admin" }
        : { id: parentId, email: "parent.e2e@example.com", display_name: profileName };
      await route.fulfill(json({
        access_token: `${activeRole}-access-fresh`,
        refresh_token: `${activeRole}-refresh-fresh`,
        user,
      }));
      return;
    }

    if (url.pathname === `/v1/${appId}/fn/admin-manage`) {
      const body = record.body || {};
      if (body.action === "list-accounts") {
        await route.fulfill(json({ accounts: accountExists ? [{
          user_id: parentId,
          email: "parent.e2e@example.com",
          name: profileName,
          student_count: 0,
          enrollment_count: 0,
        }] : [] }));
        return;
      }
      if (body.action === "admin-data") {
        await route.fulfill(json({ rows: [] }));
        return;
      }
      if (body.action === "create-account") {
        accountExists = true;
        profileName = body.display_name;
        await route.fulfill(json({
          account_exists: true,
          account: { user_id: parentId, email: "parent.e2e@example.com", name: profileName },
          profile_saved: false,
          code_sent: true,
          welcome_sent: false,
          recovery_required: true,
        }));
        return;
      }
      if (body.action === "recover-account") {
        await route.fulfill(json({
          account_exists: true,
          account: { user_id: parentId, email: "parent.e2e@example.com", name: profileName },
          profile_saved: true,
          code_sent: true,
          welcome_sent: true,
          recovery_required: false,
        }));
        return;
      }
      if (body.action === "resend-invitation") {
        await route.fulfill(json({ code_sent: true, welcome_sent: false }));
        return;
      }
      await route.fulfill(json({ error: "unexpected admin action" }, 400));
      return;
    }

    if (url.pathname === `/v1/${appId}/fn/manage-account`) {
      const body = record.body || {};
      profileName = body.parent_name;
      await route.fulfill(json({
        profile: {
          user_id: parentId,
          email: "parent.e2e@example.com",
          parent_name: profileName,
          student_phone: body.student_phone || null,
          emergency_contact: body.emergency_contact || null,
          allergies: body.allergies || null,
        },
        updated_enrollments: 0,
      }));
      return;
    }

    if (url.pathname === `/v1/${appId}/fn/manage-students`) {
      await route.fulfill(json({ students: [] }));
      return;
    }
    if (url.pathname === `/v1/${appId}/fn/claim-enrollments`) {
      await route.fulfill(json({ claimed: [] }));
      return;
    }

    if (url.pathname.startsWith(`/v1/${appId}/parent_profiles`)) {
      if (request.method() !== "GET") {
        await route.fulfill(json({ error: "RLS denied direct profile write" }, 403));
        return;
      }
      await route.fulfill(json([{
        user_id: parentId,
        email: "parent.e2e@example.com",
        parent_name: profileName,
        student_phone: null,
        emergency_contact: null,
        allergies: null,
      }]));
      return;
    }

    if (url.pathname.startsWith(`/v1/${appId}/`)) {
      await route.fulfill(json([]));
      return;
    }

    await route.fulfill(json({ error: "unexpected request" }, 404));
  });

  async function setAuth(role) {
    activeRole = role;
    await page.goto(`${origin}/index.html`);
    const user = role === "admin"
      ? { id: "admin-1", email: "herfield8@gmail.com", display_name: "Admin" }
      : { id: parentId, email: "parent.e2e@example.com", display_name: profileName };
    await page.evaluate(({ currentRole, currentUser }) => {
      localStorage.clear();
      localStorage.setItem("olivistart_access_token", `${currentRole}-access`);
      localStorage.setItem("olivistart_refresh_token", `${currentRole}-refresh`);
      localStorage.setItem("olivistart_user", JSON.stringify(currentUser));
    }, { currentRole: role, currentUser: user });
  }

  async function waitForText(text) {
    try {
      await page.getByText(text).waitFor({ timeout: 10_000 });
    } catch (error) {
      const state = await page.locator("#admin-app").innerText().catch(() => "<admin app unavailable>");
      const actions = apiRequests.slice(-8).map((request) => request.body?.action || request.method);
      throw new Error(`${error.message}\nAdmin state: ${state}\nRecent actions: ${actions.join(", ")}`);
    }
  }

  await setAuth("admin");
  await page.goto(`${origin}/admin.html#accounts`);
  await page.getByRole("heading", { name: "Accounts" }).waitFor();
  await page.getByRole("button", { name: "+ New account" }).click();
  await page.getByLabel("Email").fill("parent.e2e@example.com");
  await page.getByLabel("Parent name").fill("Original Parent");
  await page.getByRole("button", { name: "Create account" }).click();
  await waitForText("This account exists, but its profile setup is incomplete.");
  await page.getByRole("button", { name: "Complete setup and resend onboarding" }).click();
  await page.getByText("Profile setup completed. Security code and welcome email sent.").waitFor();
  await page.getByRole("button", { name: "Resend onboarding emails" }).click();
  await page.getByText("Security code sent, but the welcome email failed.").waitFor();

  const createRequest = apiRequests.find((request) => request.body?.action === "create-account");
  const recoveryRequest = apiRequests.find((request) => request.body?.action === "recover-account");
  assert.deepEqual(createRequest.body, {
    action: "create-account",
    email: "parent.e2e@example.com",
    display_name: "Original Parent",
  });
  assert.deepEqual(recoveryRequest.body, {
    action: "recover-account",
    user_id: parentId,
    email: "parent.e2e@example.com",
    parent_name: "Original Parent",
  });

  await page.goto(`${origin}/login.html?mode=magic-verify&email=Parent.E2E%40Example.com&next=account.html`);
  assert.equal(await page.getByLabel("Email").inputValue(), "parent.e2e@example.com");
  assert.equal(await page.locator("#code").evaluate((element) => document.activeElement === element), true);
  await page.getByText("Enter the code from the separate security email.").waitFor();

  await setAuth("parent");
  await page.goto(`${origin}/account.html`);
  await page.getByRole("button", { name: "Profile & Security" }).click();
  await page.getByLabel("Parent / Guardian Name").fill("Updated Parent");
  const profileSaveResponse = page.waitForResponse((response) => {
    if (new URL(response.url()).pathname !== `/v1/${appId}/fn/manage-account`) return false;
    try {
      return response.request().postDataJSON()?.action === "update-contact";
    } catch {
      return false;
    }
  });
  await page.getByRole("button", { name: "Save Contact Info" }).click();
  await profileSaveResponse;
  await page.getByRole("button", { name: "Save Contact Info" }).waitFor();
  assert.equal(await page.getByLabel("Parent / Guardian Name").inputValue(), "Updated Parent");

  expectedDirectDenial = true;
  const directWriteStatus = await page.evaluate(async ({ target, token, id }) => {
    const response = await fetch(`${target}/v1/${id}/parent_profiles/11111111-1111-4111-8111-111111111111`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "forged@example.com" }),
    });
    return response.status;
  }, { target: apiOrigin, token: "parent-access-fresh", id: appId });
  await page.waitForTimeout(0);
  expectedDirectDenial = false;
  assert.equal(directWriteStatus, 403);

  const profileSave = apiRequests.find((request) => request.body?.action === "update-contact");
  assert.equal(new URL(profileSave.url).pathname, `/v1/${appId}/fn/manage-account`);
  assert.equal(profileSave.body.parent_name, "Updated Parent");
  assert.equal(Object.hasOwn(profileSave.body, "user_id"), false);
  assert.equal(Object.hasOwn(profileSave.body, "email"), false);

  await setAuth("admin");
  await page.goto(`${origin}/admin.html#accounts`);
  await page.getByRole("cell", { name: "Updated Parent" }).waitFor();
  await page.getByRole("cell", { name: "parent.e2e@example.com" }).waitFor();

  const adminRequests = apiRequests.filter((request) => request.role === "admin" && new URL(request.url).origin === apiOrigin);
  const directAdminDataRequests = adminRequests.filter((request) => {
    const pathname = new URL(request.url).pathname;
    return pathname.startsWith(`/v1/${appId}/`) && !pathname.startsWith(`/v1/${appId}/fn/`);
  });
  assert.deepEqual(directAdminDataRequests, []);
  for (const request of apiRequests) {
    assert.doesNotMatch(request.headers.authorization || "", /^Bearer\s+bb_sk_/i);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/admin.html#accounts`);
  await page.getByRole("heading", { name: "Accounts" }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  const brandBox = await page.getByRole("link", { name: "OliVista CMS" }).boundingBox();
  const accountsNavBox = await page.getByRole("link", { name: "Accounts" }).boundingBox();
  assert.ok(brandBox && brandBox.y >= 0 && brandBox.y + brandBox.height <= 844);
  assert.ok(accountsNavBox && accountsNavBox.x >= 0 && accountsNavBox.x + accountsNavBox.width <= 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: join(tmpdir(), "olivistart-final-remediation-admin.png"), fullPage: true });

  assert.deepEqual(consoleProblems, []);
  assert.equal(expectedDirectDenialMessages, 1);
  process.stdout.write(JSON.stringify({
    browser: "Google Chrome isolated headless profile",
    api_requests: apiRequests.length,
    admin_function_requests: adminRequests.filter((request) => new URL(request.url).pathname.includes("/fn/admin-manage")).length,
    direct_admin_data_requests: directAdminDataRequests.length,
    direct_parent_profile_write_status: directWriteStatus,
    console_problems: consoleProblems.length,
    screenshot: join(tmpdir(), "olivistart-final-remediation-admin.png"),
  }, null, 2) + "\n");
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await rm(browserProfile, { recursive: true, force: true });
}
