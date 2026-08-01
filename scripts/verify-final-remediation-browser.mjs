import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handler as adminManageHandler } from "../backend/functions/admin-manage.js";

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_CORE_PATH || "playwright-core";
const { chromium } = require(playwrightPath);

const origin = "http://127.0.0.1:4173";
const apiOrigin = "https://api.butterbase.ai";
const appId = "app_48ul5eszfv7v";
const parentId = "11111111-1111-4111-8111-111111111111";
const recoveryKey = "admin-account-recovery:parent.e2e@example.com";
const browserProfile = await mkdtemp(join(tmpdir(), "olivistart-browser-"));
const server = spawn("python3", ["-m", "http.server", "4173", "--bind", "127.0.0.1"], {
  cwd: new URL("../", import.meta.url),
  stdio: "ignore",
});
const originalFetch = global.fetch;
const originalConsoleError = console.error;
const handlerErrors = [];

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await originalFetch(`${origin}/admin.html`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local test server did not start");
}

function routeJson(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function nodeJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestBody(options = {}) {
  return options.body ? JSON.parse(options.body) : null;
}

const kvValues = new Map();
const kvCalls = [];
const functionKv = {
  async get(key) {
    kvCalls.push({ operation: "get", key });
    return kvValues.get(key) ?? null;
  },
  async set(key, value, options) {
    kvCalls.push({ operation: "set", key, value, options });
    kvValues.set(key, value);
  },
  async del(key) {
    kvCalls.push({ operation: "del", key });
    kvValues.delete(key);
  },
};

const backendRequests = [];
const programs = [];
const semesters = [{
  id: "22222222-2222-4222-8222-222222222222",
  name: "Fall 2026",
  start_date: "2026-09-01",
  end_date: "2026-12-18",
  active: true,
}];
const schedules = [];
let accountExists = false;
let profile = null;
let profileName = "Original Parent";
let failNextProfileCreate = true;
let failAdminResourceReads = false;
let signupCalls = 0;
let welcomeShouldSucceed = true;
let nextProgramId = 1;
let nextScheduleId = 1;

function collectionFor(resource) {
  if (resource === "programs") return programs;
  if (resource === "semesters") return semesters;
  if (resource === "class_schedules") return schedules;
  return [];
}

async function handlerFetch(url, options = {}) {
  const target = new URL(String(url));
  const method = options.method || "GET";
  const body = requestBody(options);
  backendRequests.push({ url: target.toString(), method, headers: options.headers || {}, body });

  if (target.pathname === `/auth/${appId}/me`) {
    return nodeJson({ user: { id: "admin-1", email: "herfield8@gmail.com" } });
  }
  if (target.pathname === `/auth/${appId}/signup`) {
    signupCalls += 1;
    if (accountExists) return nodeJson({ error: "User already exists" }, 409);
    accountExists = true;
    return nodeJson({ user: { id: parentId } });
  }
  if (target.pathname === `/auth/${appId}/magic-link`) {
    return nodeJson({ message: "sent" });
  }
  if (target.pathname === `/v1/${appId}/integrations/execute`) {
    return nodeJson({ successful: welcomeShouldSucceed });
  }

  const prefix = `/v1/${appId}/`;
  if (!target.pathname.startsWith(prefix)) return nodeJson({ error: "unexpected handler fetch" }, 404);
  const segments = target.pathname.slice(prefix.length).split("/");
  const resource = segments[0];
  const recordId = segments[1] || null;

  if (resource === "parent_profiles") {
    if (method === "GET") return nodeJson(profile ? [profile] : []);
    if (method === "POST") {
      if (failNextProfileCreate) {
        failNextProfileCreate = false;
        return nodeJson({ error: "simulated profile outage" }, 503);
      }
      profile = { ...body };
      profileName = profile.parent_name;
      return nodeJson(profile);
    }
    if (method === "PATCH" && recordId === parentId) {
      profile = { ...(profile || { user_id: parentId }), ...body };
      profileName = profile.parent_name;
      return nodeJson(profile);
    }
  }

  if (failAdminResourceReads && method === "GET") {
    return nodeJson({ error: "simulated admin data outage" }, 503);
  }

  const collection = collectionFor(resource);
  if (method === "GET") return nodeJson(collection);
  if (method === "POST") {
    const id = resource === "programs"
      ? `33333333-3333-4333-8333-${String(nextProgramId++).padStart(12, "0")}`
      : `44444444-4444-4444-8444-${String(nextScheduleId++).padStart(12, "0")}`;
    const created = { id, ...body };
    collection.push(created);
    return nodeJson(created);
  }
  if (method === "PATCH") {
    const index = collection.findIndex((item) => item.id === recordId);
    const updated = { ...(collection[index] || { id: recordId }), ...body };
    if (index === -1) collection.push(updated);
    else collection[index] = updated;
    return nodeJson(updated);
  }
  if (method === "DELETE") return new Response(null, { status: 204 });
  return nodeJson({ error: "unexpected data operation" }, 400);
}

const adminContext = {
  user: null,
  env: {
    BUTTERBASE_APP_ID: appId,
    BUTTERBASE_API_URL: apiOrigin,
    SERVICE_KEY: "service-key-browser-fixture",
    INVITATION_GMAIL_USER_ID: "sender-user-1",
    SITE_URL: origin,
  },
  kv: functionKv,
};

let browser;
try {
  await waitForServer();
  global.fetch = handlerFetch;
  console.error = (...args) => handlerErrors.push(args.map(String).join(" "));
  browser = await chromium.launchPersistentContext(browserProfile, {
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  const page = browser.pages()[0] || await browser.newPage();
  const browserRequests = [];
  const consoleProblems = [];
  let expectedDirectDenial = false;
  let expectedDirectDenialMessages = 0;
  let activeRole = "admin";

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

    let body = null;
    try { body = request.postDataJSON(); } catch {}
    const record = {
      role: activeRole,
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body,
    };
    browserRequests.push(record);

    if (url.origin !== apiOrigin) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (url.pathname === `/auth/${appId}/refresh`) {
      const user = activeRole === "admin"
        ? { id: "admin-1", email: "herfield8@gmail.com", display_name: "Admin" }
        : { id: parentId, email: "parent.e2e@example.com", display_name: profileName };
      await route.fulfill(routeJson({
        access_token: `${activeRole}-access-fresh`,
        refresh_token: `${activeRole}-refresh-fresh`,
        user,
      }));
      return;
    }

    if (url.pathname === `/v1/${appId}/fn/admin-manage`) {
      const handlerRequest = new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.postData(),
      });
      const response = await adminManageHandler(handlerRequest, adminContext);
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      });
      return;
    }

    if (url.pathname === `/v1/${appId}/fn/manage-account`) {
      profileName = body.parent_name;
      profile = {
        user_id: parentId,
        email: "parent.e2e@example.com",
        parent_name: profileName,
        student_phone: body.student_phone || null,
        emergency_contact: body.emergency_contact || null,
        allergies: body.allergies || null,
      };
      await route.fulfill(routeJson({ profile, updated_enrollments: 0 }));
      return;
    }
    if (url.pathname === `/v1/${appId}/fn/manage-students`) {
      await route.fulfill(routeJson({ students: [] }));
      return;
    }
    if (url.pathname === `/v1/${appId}/fn/claim-enrollments`) {
      await route.fulfill(routeJson({ claimed: [] }));
      return;
    }

    if (url.pathname.startsWith(`/v1/${appId}/parent_profiles`)) {
      if (request.method() !== "GET") {
        await route.fulfill(routeJson({ error: "RLS denied direct profile write" }, 403));
        return;
      }
      await route.fulfill(routeJson(profile ? [profile] : []));
      return;
    }
    if (url.pathname.startsWith(`/v1/${appId}/`)) {
      await route.fulfill(routeJson([]));
      return;
    }
    await route.fulfill(routeJson({ error: "unexpected browser request" }, 404));
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
      const actions = browserRequests.slice(-8).map((request) => request.body?.action || request.method);
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
  assert.equal(kvValues.has(recoveryKey), true);
  assert.equal(signupCalls, 1);

  await page.reload();
  await page.getByRole("heading", { name: "Accounts" }).waitFor();
  const countNonessentialReads = () => backendRequests.filter((request) =>
    request.method === "GET" && ["students", "enrollments", "class_schedules", "programs"].some((resource) =>
      new URL(request.url).pathname.includes(`/v1/${appId}/${resource}`),
    ),
  ).length;
  const readsBeforeRecoveryView = countNonessentialReads();
  failAdminResourceReads = true;
  await page.getByRole("button", { name: "+ New account" }).click();
  await page.getByLabel("Email").fill(" PARENT.E2E@example.com ");
  await page.getByLabel("Parent name").fill("Tampered Retry Name");
  await page.getByRole("button", { name: "Create account" }).click();
  await waitForText("This account exists, but its profile setup is incomplete.");
  assert.equal(signupCalls, 1);
  assert.equal(countNonessentialReads(), readsBeforeRecoveryView);

  failAdminResourceReads = false;
  await page.getByRole("button", { name: "Complete setup and resend onboarding" }).click();
  await page.getByText("Profile setup completed. Security code and welcome email sent.").waitFor();
  assert.equal(kvValues.has(recoveryKey), false);
  welcomeShouldSucceed = false;
  await page.getByRole("button", { name: "Resend onboarding emails" }).click();
  await page.getByText("Security code sent, but the welcome email failed.").waitFor();

  const createRequests = browserRequests.filter((request) => request.body?.action === "create-account");
  const recoveryRequest = browserRequests.find((request) => request.body?.action === "recover-account");
  assert.equal(createRequests.length, 2);
  assert.deepEqual(recoveryRequest.body, {
    action: "recover-account",
    user_id: parentId,
    email: "parent.e2e@example.com",
    parent_name: "Original Parent",
  });

  await page.goto(`${origin}/admin.html#programs`);
  await page.getByRole("heading", { name: "Programs" }).waitFor();
  await page.getByRole("button", { name: "+ New Program" }).click();
  await page.getByLabel("Name").fill("Browser Program");
  await page.getByLabel("Slug").fill("browser-program");
  await page.getByLabel("Description").fill("");
  await page.getByLabel("Image URL").fill("   ");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Program created.").waitFor();

  await page.goto(`${origin}/admin.html#schedules`);
  await page.getByRole("heading", { name: "Class Schedules" }).waitFor();
  await page.getByRole("button", { name: "+ New Class Schedule" }).click();
  await page.getByLabel("Program").selectOption({ label: "Browser Program" });
  await page.getByLabel("Semester").selectOption({ label: "Fall 2026" });
  await page.getByLabel("Monday").check();
  await page.getByLabel("Age group").fill("Ages 6-10");
  await page.getByLabel("Notes").fill("   ");
  await page.getByRole("button", { name: "Create schedules" }).click();
  await page.getByText("Class Schedule created.").waitFor();

  const programCreate = backendRequests.find((request) =>
    request.method === "POST" && new URL(request.url).pathname === `/v1/${appId}/programs`,
  );
  const scheduleCreate = backendRequests.find((request) =>
    request.method === "POST" && new URL(request.url).pathname === `/v1/${appId}/class_schedules`,
  );
  assert.equal(programCreate.body.description, null);
  assert.equal(programCreate.body.image_url, null);
  assert.equal(scheduleCreate.body.notes, null);

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
    try { return response.request().postDataJSON()?.action === "update-contact"; } catch { return false; }
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

  const profileSave = browserRequests.find((request) => request.body?.action === "update-contact");
  assert.equal(new URL(profileSave.url).pathname, `/v1/${appId}/fn/manage-account`);
  assert.equal(profileSave.body.parent_name, "Updated Parent");
  assert.equal(Object.hasOwn(profileSave.body, "user_id"), false);
  assert.equal(Object.hasOwn(profileSave.body, "email"), false);

  await setAuth("admin");
  await page.goto(`${origin}/admin.html#accounts`);
  await page.getByRole("cell", { name: "Updated Parent" }).waitFor();
  await page.getByRole("cell", { name: "parent.e2e@example.com" }).waitFor();

  const adminBrowserRequests = browserRequests.filter((request) =>
    request.role === "admin" && new URL(request.url).origin === apiOrigin,
  );
  const directAdminDataRequests = adminBrowserRequests.filter((request) => {
    const pathname = new URL(request.url).pathname;
    return pathname.startsWith(`/v1/${appId}/`) && !pathname.startsWith(`/v1/${appId}/fn/`);
  });
  assert.deepEqual(directAdminDataRequests, []);
  for (const request of browserRequests) {
    assert.doesNotMatch(request.headers.authorization || "", /^Bearer\s+bb_sk_/i);
  }

  const adminReadUrls = backendRequests
    .filter((request) => request.method === "GET" && new URL(request.url).pathname.startsWith(`/v1/${appId}/`))
    .map((request) => new URL(request.url));
  assert.ok(adminReadUrls.length > 0);
  for (const url of adminReadUrls) assert.equal(url.searchParams.has("select"), true, url.toString());

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/admin.html#accounts`);
  await page.getByRole("heading", { name: "Accounts" }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  const brandBox = await page.getByRole("link", { name: "OliVista CMS" }).boundingBox();
  const accountsNavBox = await page.getByRole("link", { name: "Accounts" }).boundingBox();
  assert.ok(brandBox && brandBox.y >= 0 && brandBox.y + brandBox.height <= 844);
  assert.ok(accountsNavBox && accountsNavBox.x >= 0 && accountsNavBox.x + accountsNavBox.width <= 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const screenshot = join(tmpdir(), "olivistart-final-remediation-admin.png");
  await page.screenshot({ path: screenshot, fullPage: true });

  assert.deepEqual(consoleProblems, []);
  assert.equal(expectedDirectDenialMessages, 1);
  assert.deepEqual(
    handlerErrors.filter((message) => !message.includes("admin create-account profile save failed:")),
    [],
  );
  process.stdout.write(JSON.stringify({
    browser: "Google Chrome isolated headless profile",
    admin_handler: "real backend/functions/admin-manage.js",
    browser_api_requests: browserRequests.length,
    backend_requests: backendRequests.length,
    signup_requests: signupCalls,
    pending_recovery_after_success: kvValues.has(recoveryKey),
    nonessential_reads_during_recovery_view: 0,
    direct_admin_data_requests: directAdminDataRequests.length,
    direct_parent_profile_write_status: directWriteStatus,
    console_problems: consoleProblems.length,
    screenshot,
  }, null, 2) + "\n");
} finally {
  global.fetch = originalFetch;
  console.error = originalConsoleError;
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await rm(browserProfile, { recursive: true, force: true });
}
