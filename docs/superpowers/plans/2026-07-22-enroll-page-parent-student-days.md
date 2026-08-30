# Enroll Page: Parent Name, Student Dropdown, Multi-Day Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the enroll page, pre-fill an editable Parent Name field, let a parent pick from their existing students (or add a new one) instead of retyping a name every time, and let them enroll in more than one day per week for classes that meet multiple days, billing and reserving seats correctly per selected day, with the resulting group of enrollment rows treated as one unit everywhere downstream (registration, account page).

**Architecture:** Reuses existing bundle-grouping helpers (`campBundleQuery`, `scheduleBundleKey`, `compareDayOfWeek`, `apiGetByIds` in `js/api.js`) to detect sibling same-bundle schedules for any program type, not just camps. Backend functions (`enroll-guard.js`, `guest-enroll.js`) gain a `schedule_ids` array code path alongside the existing single-`schedule_id` path, creating one `enrollments` row per selected day and stamping them all with the same `stripe_order_id` from one checkout — a pattern `stripe-webhook.js` already relies on. Downstream pages (`registration.html`, `account.html`) group rows by `stripe_order_id` to present them as one unit; `complete-registration.js` writes the registration form to every row in the group at once.

**Tech Stack:** Vanilla JS (ES modules, no framework) for `js/*.js` page scripts; Butterbase serverless functions (`backend/functions/*.js`, each deployed as one self-contained file — no cross-file imports); Postgres via `ctx.db.query`; `node:test` for unit tests (run with `node --test test/<file>.test.mjs`, no test framework/package.json in this repo).

## Global Constraints

- Backend function files under `backend/functions/` must remain self-contained (no `import` statements pulling in other project files) — Butterbase deploys each as one source file. Duplicate small helpers (e.g. bundle-signature check) across files rather than sharing them.
- Never trust client-sent pricing, schedule groupings, or ownership — every price, bundle-signature, capacity, and `student_id` ownership check must be re-verified server-side against the database.
- No new database columns or migrations — `enrollments.parent_name`, `enrollments.student_id`, and `enrollments.stripe_order_id` already exist.
- Follow existing test conventions exactly: backend function tests mock `ctx.db.query` (and `global.fetch` where a function calls out) and assert on captured SQL/values; frontend page-script tests read the file as text and assert with regex, since these scripts run top-level DOM/auth side effects at import time and are not otherwise unit-testable in Node.
- Run tests with `node --test test/<file>.test.mjs` (no build step, no package.json).

---

### Task 1: `enroll-guard.js` — persist `parent_name` and a verified `student_id`

**Files:**
- Modify: `backend/functions/enroll-guard.js:21` (body destructure), `backend/functions/enroll-guard.js:66-74` (INSERT)
- Test: `test/enroll-guard.test.mjs` (new file)

**Interfaces:**
- Produces: `enroll-guard` now accepts optional `parent_name` (string) and `student_id` (string, must belong to `ctx.user.id`) in the request body; both are persisted onto the created `enrollments` row. Rejects with `400 { error: "Student not found" }` when `student_id` is provided but doesn't belong to the caller.

- [ ] **Step 1: Write the failing tests**

Create `test/enroll-guard.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/enroll-guard.js";

function request(body) {
  return new Request("https://example.test/enroll-guard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx(queryResults, user = { id: "parent-1", email: "parent@example.com" }) {
  const queries = [];
  let i = 0;
  return {
    ctx: {
      user,
      env: { SERVICE_KEY: "sk_test", BUTTERBASE_APP_ID: "app_test", SITE_URL: "https://example.test" },
      db: {
        async query(sql, values) {
          queries.push({ sql, values });
          const result = queryResults[i] ?? { rows: [] };
          i += 1;
          return result;
        },
      },
    },
    queries,
  };
}

function stubFetch(responses) {
  let i = 0;
  return async () => {
    const body = responses[i];
    i += 1;
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
  };
}

test("enroll-guard persists parent_name and a verified student_id", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", program_name: "Ballet", program_num_classes: 8, price_cents: 3000, max_seats: 10 }] },
    { rows: [{ held: "2" }] },
    { rows: [{ id: "student-1" }] },
    { rows: [{ id: "enrollment-1" }] },
    { rows: [] },
  ]);
  const originalFetch = global.fetch;
  global.fetch = stubFetch([
    { id: "product-1" },
    { orderId: "order-1", url: "https://stripe.test/checkout" },
  ]);

  try {
    const response = await handler(request({
      schedule_id: "sched-1",
      student_name: "Ada",
      student_phone: "555-1234",
      parent_name: "Grace Hopper",
      student_id: "student-1",
      num_classes_enrolled: 4,
    }), ctx);

    assert.equal(response.status, 200);
    const insertQuery = queries.find((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.match(insertQuery.sql, /parent_name/);
    assert.match(insertQuery.sql, /student_id/);
    assert.deepEqual(insertQuery.values.slice(-2), ["Grace Hopper", "student-1"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("enroll-guard rejects a student_id that does not belong to the caller", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", program_name: "Ballet", program_num_classes: 8, price_cents: 3000, max_seats: 10 }] },
    { rows: [{ held: "2" }] },
    { rows: [] },
  ]);

  const response = await handler(request({
    schedule_id: "sched-1",
    student_name: "Ada",
    student_id: "someone-elses-student",
  }), ctx);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Student not found" });
  assert.equal(queries.some((q) => /INSERT INTO enrollments/.test(q.sql)), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/enroll-guard.test.mjs`
Expected: FAIL — `parent_name`/`student_id` not present in the INSERT SQL, and no student-ownership check exists yet (second test currently would insert regardless).

- [ ] **Step 3: Implement**

In `backend/functions/enroll-guard.js`, change the body destructure at line 21:

```js
  const { schedule_id, student_name, student_email, student_phone, parent_name } = body;
```

Immediately after the schedule lookup block (after the `const schedule = scheduleRes.rows[0];` line, before the capacity check), add:

```js
  // Student ownership: a parent may only attach one of their own students.
  let studentId = null;
  if (body.student_id) {
    const studentRes = await ctx.db.query(
      `SELECT id FROM students WHERE id = $1 AND user_id = $2`,
      [body.student_id, ctx.user.id]
    );
    if (studentRes.rows.length === 0) {
      return json({ error: "Student not found" }, 400);
    }
    studentId = body.student_id;
  }
```

Replace the INSERT block (lines 66-74) with:

```js
  const enrollRes = await ctx.db.query(
    `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                              status, num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents,
                              parent_name, student_id)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [schedule_id, ctx.user.id, student_name || "", student_email || "", student_phone || "",
     numClasses, perClass, isEarlyBird ? ebPct : 0, total, parent_name || "", studentId]
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/enroll-guard.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/functions/enroll-guard.js test/enroll-guard.test.mjs
git commit -m "enroll-guard: persist parent_name and a verified student_id"
```

---

### Task 2: `guest-enroll.js` — persist `parent_name`

**Files:**
- Modify: `backend/functions/guest-enroll.js:20-24` (body parsing), `backend/functions/guest-enroll.js:111-119` (INSERT)
- Test: `test/guest-enroll.test.mjs` (new file)

**Interfaces:**
- Produces: `guest-enroll` now accepts optional `parent_name` (string) in the request body and persists it onto the created `enrollments` row. Guests never send `student_id` (they have no student profiles yet).

- [ ] **Step 1: Write the failing test**

Create `test/guest-enroll.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/guest-enroll.js";

function request(body) {
  return new Request("https://example.test/guest-enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx(queryResults) {
  const queries = [];
  let i = 0;
  return {
    ctx: {
      env: { SERVICE_KEY: "sk_test", BUTTERBASE_APP_ID: "app_test", SITE_URL: "https://example.test" },
      db: {
        async query(sql, values) {
          queries.push({ sql, values });
          const result = queryResults[i] ?? { rows: [] };
          i += 1;
          return result;
        },
      },
    },
    queries,
  };
}

function stubFetch(responses) {
  let i = 0;
  return async () => {
    const body = responses[i];
    i += 1;
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
  };
}

test("guest-enroll persists parent_name onto the created enrollment", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", program_name: "Ballet", program_num_classes: 8, price_cents: 3000, max_seats: 10 }] },
    { rows: [{ held: "2" }] },
    { rows: [{ id: "enrollment-1" }] },
    { rows: [] },
  ]);
  const originalFetch = global.fetch;
  global.fetch = stubFetch([
    { user: { id: "guest-user-1" } },
    { access_token: "guest-token" },
    { id: "product-1" },
    { orderId: "order-1", url: "https://stripe.test/checkout" },
  ]);

  try {
    const response = await handler(request({
      schedule_id: "sched-1",
      student_name: "Ada",
      student_email: "ada@example.com",
      parent_name: "Grace Hopper",
    }), ctx);

    assert.equal(response.status, 200);
    const insertQuery = queries.find((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.match(insertQuery.sql, /parent_name/);
    assert.equal(insertQuery.values.at(-1), "Grace Hopper");
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/guest-enroll.test.mjs`
Expected: FAIL — `parent_name` absent from the INSERT.

- [ ] **Step 3: Implement**

In `backend/functions/guest-enroll.js`, after line 23 (`const student_phone = ...`), add:

```js
  const parent_name = String(body.parent_name || "").trim();
```

Replace the INSERT block (lines 111-119) with:

```js
  const enrollRes = await ctx.db.query(
    `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                              status, num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents,
                              parent_name)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
     RETURNING id`,
    [schedule_id, guestUser.id, student_name, student_email, student_phone,
     numClasses, perClass, isEarlyBird ? ebPct : 0, total, parent_name]
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/guest-enroll.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/functions/guest-enroll.js test/guest-enroll.test.mjs
git commit -m "guest-enroll: persist parent_name"
```

---

### Task 3: `enroll-guard.js` — multi-day `schedule_ids` enrollment

**Files:**
- Modify: `backend/functions/enroll-guard.js` (add a `schedule_ids` branch at the top of `handler`, add a new `handleMultiDay` function)
- Test: `test/enroll-guard.test.mjs` (extend from Task 1)

**Interfaces:**
- Consumes: the `parent_name`/`student_id` handling added in Task 1 (same validation rules apply per created row).
- Produces: when the request body has `schedule_ids: string[]` (2+ ids), `enroll-guard` verifies every schedule shares one bundle signature (`program_id, semester_id, session_type, start_time, end_time, age_group, price_cents, max_seats`), checks capacity independently per id, creates one `enrollments` row per id (`num_classes_enrolled = 1` each), and stamps every created row with the same `stripe_order_id` from one combined Stripe checkout. Response shape unchanged: `{ enrollment_id, checkout_url, total_cents }` (`enrollment_id` is the first row created).

- [ ] **Step 1: Write the failing tests**

Add to `test/enroll-guard.test.mjs`:

```js
test("enroll-guard rejects schedule_ids that don't share one bundle signature", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", semester_id: "sem-1", session_type: "standard", start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3000, max_seats: 10, day_of_week: "Monday" }] },
    { rows: [{ id: "sched-2", program_id: "prog-1", semester_id: "sem-1", session_type: "standard", start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3500, max_seats: 10, day_of_week: "Wednesday" }] },
  ]);

  const response = await handler(request({
    schedule_ids: ["sched-1", "sched-2"],
    student_name: "Ada",
  }), ctx);

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /same class bundle/);
  assert.equal(queries.length, 2);
});

test("enroll-guard rejects the whole multi-day request when any selected day is full", async () => {
  const bundleRow = (id, day) => ({
    id, program_id: "prog-1", semester_id: "sem-1", session_type: "standard",
    start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3000, max_seats: 10,
    day_of_week: day, program_name: "Ballet", program_num_classes: 8,
  });
  const { ctx, queries } = makeCtx([
    { rows: [bundleRow("sched-1", "Monday")] },
    { rows: [bundleRow("sched-2", "Wednesday")] },
    { rows: [{ held: "3" }] },
    { rows: [{ held: "10" }] },
  ]);

  const response = await handler(request({
    schedule_ids: ["sched-1", "sched-2"],
    student_name: "Ada",
  }), ctx);

  assert.equal(response.status, 409);
  assert.equal(queries.some((q) => /INSERT INTO enrollments/.test(q.sql)), false);
});

test("enroll-guard creates one enrollment row per selected day, all sharing one stripe_order_id", async () => {
  const bundleRow = (id, day) => ({
    id, program_id: "prog-1", semester_id: "sem-1", session_type: "standard",
    start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3000, max_seats: 10,
    day_of_week: day, program_name: "Ballet", program_num_classes: 8,
  });
  const { ctx, queries } = makeCtx([
    { rows: [bundleRow("sched-1", "Monday")] },
    { rows: [bundleRow("sched-2", "Wednesday")] },
    { rows: [{ held: "2" }] },
    { rows: [{ held: "2" }] },
    { rows: [{ id: "enrollment-1" }] },
    { rows: [{ id: "enrollment-2" }] },
    { rows: [] },
  ]);
  const originalFetch = global.fetch;
  global.fetch = stubFetch([
    { id: "product-1" },
    { orderId: "order-1", url: "https://stripe.test/checkout" },
  ]);

  try {
    const response = await handler(request({
      schedule_ids: ["sched-1", "sched-2"],
      student_name: "Ada",
      parent_name: "Grace Hopper",
    }), ctx);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      enrollment_id: "enrollment-1",
      checkout_url: "https://stripe.test/checkout",
      total_cents: 6000,
    });

    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts.length, 2);
    assert.match(inserts[0].sql, /'pending', 1,/);
    assert.equal(inserts[0].values[5], 3000); // price_per_class_cents
    assert.equal(inserts[0].values[7], 3000); // this row's total_paid_cents share

    const updateOrder = queries.find((q) => /UPDATE enrollments SET stripe_order_id/.test(q.sql));
    assert.match(updateOrder.sql, /WHERE id = ANY\(\$2\)/);
    assert.deepEqual(updateOrder.values, ["order-1", ["enrollment-1", "enrollment-2"]]);
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/enroll-guard.test.mjs`
Expected: FAIL — no `schedule_ids` handling exists yet.

- [ ] **Step 3: Implement**

In `backend/functions/enroll-guard.js`, change the top of `handler` to branch before the existing single-schedule logic:

```js
export async function handler(req, ctx) {
  if (!ctx.user) {
    return json({ error: "Authentication required" }, 401);
  }

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (Array.isArray(body.schedule_ids)) {
    return handleMultiDay(req, body, ctx);
  }

  const { schedule_id, student_name, student_email, student_phone, parent_name } = body;
  // ... rest of the existing single-schedule handler body is unchanged from Task 1 ...
```

Add a new function (after `handler`, before the trailing `function json(...)` helper):

```js
async function handleMultiDay(req, body, ctx) {
  const scheduleIds = [...new Set(body.schedule_ids)];
  if (scheduleIds.length === 0) {
    return json({ error: "schedule_ids must be a non-empty array" }, 400);
  }
  if (scheduleIds.length !== body.schedule_ids.length) {
    return json({ error: "schedule_ids must not contain duplicates" }, 400);
  }

  const { student_name, student_email, student_phone, parent_name } = body;

  let studentId = null;
  if (body.student_id) {
    const studentRes = await ctx.db.query(
      `SELECT id FROM students WHERE id = $1 AND user_id = $2`,
      [body.student_id, ctx.user.id]
    );
    if (studentRes.rows.length === 0) {
      return json({ error: "Student not found" }, 400);
    }
    studentId = body.student_id;
  }

  // 1. Fetch every schedule + program row and verify they share one bundle signature.
  const schedules = [];
  for (const scheduleId of scheduleIds) {
    const res = await ctx.db.query(
      `SELECT cs.*, p.name AS program_name, p.num_classes AS program_num_classes
       FROM class_schedules cs
       JOIN programs p ON cs.program_id = p.id
       WHERE cs.id = $1 AND cs.active = true`,
      [scheduleId]
    );
    if (res.rows.length === 0) {
      return json({ error: `Class schedule not found: ${scheduleId}` }, 404);
    }
    schedules.push(res.rows[0]);
  }
  const bundleKey = (s) => [s.program_id, s.semester_id, s.session_type, s.start_time, s.end_time,
    s.age_group, s.price_cents, s.max_seats].join("|");
  const firstKey = bundleKey(schedules[0]);
  if (!schedules.every((s) => bundleKey(s) === firstKey)) {
    return json({ error: "All selected days must belong to the same class bundle" }, 400);
  }

  // 2. Capacity: one check per selected day, all-or-nothing.
  for (const schedule of schedules) {
    const countRes = await ctx.db.query(
      `SELECT COUNT(*) AS held FROM enrollments
       WHERE schedule_id = $1
         AND (status = 'confirmed'
              OR (status = 'pending' AND created_at > now() - interval '60 minutes'))`,
      [schedule.id]
    );
    if (parseInt(countRes.rows[0].held, 10) >= schedule.max_seats) {
      return json({ error: `Class is full: ${schedule.day_of_week}`, spots_available: 0 }, 409);
    }
  }

  // 3. Pricing: one session per selected day (mirrors how camp bundles already price).
  const perClass = schedules[0].price_cents;
  const numClasses = schedules.length;
  const isEarlyBird = numClasses >= EARLY_BIRD_MIN_CLASSES && new Date() <= new Date(EARLY_BIRD_DEADLINE);
  const ebPct = EARLY_BIRD_PCT;
  const subtotal = perClass * numClasses;
  const discountAmount = isEarlyBird ? Math.round((subtotal * ebPct) / 100) : 0;
  const total = subtotal - discountAmount;
  const perDayDiscounted = perClass - Math.round((perClass * (isEarlyBird ? ebPct : 0)) / 100);

  // 4. One enrollments row per selected day; the last row absorbs any rounding remainder.
  const enrollmentIds = [];
  for (let i = 0; i < schedules.length; i += 1) {
    const schedule = schedules[i];
    const isLast = i === schedules.length - 1;
    const rowTotal = isLast ? total - perDayDiscounted * i : perDayDiscounted;
    const enrollRes = await ctx.db.query(
      `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                                status, num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents,
                                parent_name, student_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', 1, $6, $7, $8, $9, $10)
       RETURNING id`,
      [schedule.id, ctx.user.id, student_name || "", student_email || "", student_phone || "",
       perClass, isEarlyBird ? ebPct : 0, rowTotal, parent_name || "", studentId]
    );
    enrollmentIds.push(enrollRes.rows[0].id);
  }

  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;
  const siteUrl = ctx.env.SITE_URL || "https://olivistart.com";
  const serviceHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${ctx.env.SERVICE_KEY}` };

  // 5. One Stripe product/checkout for the combined total.
  const dayList = schedules.map((s) => s.day_of_week).join(", ");
  const productName = `${schedules[0].program_name} - ${numClasses} day${numClasses > 1 ? "s" : ""} (${dayList})` +
    (isEarlyBird ? ` (${ebPct}% early-bird)` : "");
  const productRes = await fetch(`${apiBase}/v1/${appId}/billing/products`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      name: productName,
      priceCents: total,
      description: `${schedules[0].program_name} art class - ${numClasses} day${numClasses > 1 ? "s" : ""} x $${(perClass / 100).toFixed(2)}` +
        (isEarlyBird ? `, ${ebPct}% early-bird discount` : ""),
      metadata: {
        enrollment_ids: enrollmentIds.join(","),
        schedule_ids: scheduleIds.join(","),
        num_classes: String(numClasses),
        price_per_class_cents: String(perClass),
        discount_pct: String(isEarlyBird ? ebPct : 0),
        total_cents: String(total),
      },
    }),
  });
  if (!productRes.ok) {
    const errText = await productRes.text();
    console.error("Failed to create product:", errText);
    await ctx.db.query(`DELETE FROM enrollments WHERE id = ANY($1)`, [enrollmentIds]);
    return json({ error: "Failed to create payment product" }, 502);
  }
  const product = await productRes.json();

  const authHeader = req.headers.get("authorization");
  const purchaseRes = await fetch(`${apiBase}/v1/${appId}/billing/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({
      productId: product.id,
      successUrl: `${siteUrl}/registration.html?enrollment=${enrollmentIds[0]}&payment=success`,
      cancelUrl: `${siteUrl}/enroll.html?schedule=${scheduleIds[0]}&payment=cancelled`,
    }),
  });
  if (!purchaseRes.ok) {
    const errText = await purchaseRes.text();
    console.error("Failed to create checkout session:", errText);
    await ctx.db.query(`DELETE FROM enrollments WHERE id = ANY($1)`, [enrollmentIds]);
    return json({ error: "Failed to create checkout session" }, 502);
  }
  const purchase = await purchaseRes.json();

  await ctx.db.query(
    `UPDATE enrollments SET stripe_order_id = $1 WHERE id = ANY($2)`,
    [purchase.orderId, enrollmentIds]
  );

  return json({
    enrollment_id: enrollmentIds[0],
    checkout_url: purchase.url,
    total_cents: total,
  }, 200);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/enroll-guard.test.mjs`
Expected: PASS (5 tests total)

- [ ] **Step 5: Commit**

```bash
git add backend/functions/enroll-guard.js test/enroll-guard.test.mjs
git commit -m "enroll-guard: support multi-day enrollment via schedule_ids"
```

---

### Task 4: `guest-enroll.js` — multi-day `schedule_ids` enrollment

**Files:**
- Modify: `backend/functions/guest-enroll.js` (add a `schedule_ids` branch, add a new `handleMultiDay` function)
- Test: `test/guest-enroll.test.mjs` (extend from Task 2)

**Interfaces:**
- Consumes: `parent_name` handling from Task 2; same bundle-signature/capacity rules as Task 3's `enroll-guard` version (duplicated, since this file must stay self-contained).
- Produces: same `schedule_ids` contract as Task 3, but for guests — one provisional guest account is created, then one `enrollments` row per selected day is created under it, then one combined checkout.

- [ ] **Step 1: Write the failing tests**

Add to `test/guest-enroll.test.mjs`:

```js
test("guest-enroll rejects schedule_ids that don't share one bundle signature", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", semester_id: "sem-1", session_type: "standard", start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3000, max_seats: 10, day_of_week: "Monday" }] },
    { rows: [{ id: "sched-2", program_id: "prog-1", semester_id: "sem-1", session_type: "standard", start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3500, max_seats: 10, day_of_week: "Wednesday" }] },
  ]);

  const response = await handler(request({
    schedule_ids: ["sched-1", "sched-2"],
    student_name: "Ada",
    student_email: "ada@example.com",
  }), ctx);

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /same class bundle/);
  assert.equal(queries.length, 2);
});

test("guest-enroll creates one enrollment row per selected day under one guest account, sharing one stripe_order_id", async () => {
  const bundleRow = (id, day) => ({
    id, program_id: "prog-1", semester_id: "sem-1", session_type: "standard",
    start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3000, max_seats: 10,
    day_of_week: day, program_name: "Ballet", program_num_classes: 8,
  });
  const { ctx, queries } = makeCtx([
    { rows: [bundleRow("sched-1", "Monday")] },
    { rows: [bundleRow("sched-2", "Wednesday")] },
    { rows: [{ held: "2" }] },
    { rows: [{ held: "2" }] },
    { rows: [{ id: "enrollment-1" }] },
    { rows: [{ id: "enrollment-2" }] },
    { rows: [] },
  ]);
  const originalFetch = global.fetch;
  global.fetch = stubFetch([
    { user: { id: "guest-user-1" } },
    { access_token: "guest-token" },
    { id: "product-1" },
    { orderId: "order-1", url: "https://stripe.test/checkout" },
  ]);

  try {
    const response = await handler(request({
      schedule_ids: ["sched-1", "sched-2"],
      student_name: "Ada",
      student_email: "ada@example.com",
      parent_name: "Grace Hopper",
    }), ctx);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      enrollment_id: "enrollment-1",
      checkout_url: "https://stripe.test/checkout",
      total_cents: 6000,
    });

    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts.length, 2);
    assert.equal(inserts[0].values[1], "guest-user-1");

    const updateOrder = queries.find((q) => /UPDATE enrollments SET stripe_order_id/.test(q.sql));
    assert.deepEqual(updateOrder.values, ["order-1", ["enrollment-1", "enrollment-2"]]);
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/guest-enroll.test.mjs`
Expected: FAIL — no `schedule_ids` handling exists yet.

- [ ] **Step 3: Implement**

In `backend/functions/guest-enroll.js`, change the top of `handler`:

```js
export async function handler(req, ctx) {
  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (Array.isArray(body.schedule_ids)) {
    return handleMultiDay(body, ctx);
  }

  const schedule_id = body.schedule_id;
  // ... rest of the existing single-schedule handler body is unchanged from Task 2 ...
```

Add a new function (after `handler`, before `randomPassword`):

```js
async function handleMultiDay(body, ctx) {
  const scheduleIds = [...new Set(body.schedule_ids)];
  if (scheduleIds.length === 0) {
    return json({ error: "schedule_ids must be a non-empty array" }, 400);
  }
  if (scheduleIds.length !== body.schedule_ids.length) {
    return json({ error: "schedule_ids must not contain duplicates" }, 400);
  }

  const student_name = String(body.student_name || "").trim();
  const student_email = String(body.student_email || "").trim().toLowerCase();
  const student_phone = String(body.student_phone || "").trim();
  const parent_name = String(body.parent_name || "").trim();
  if (!student_name) return json({ error: "Student name is required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student_email)) {
    return json({ error: "A valid email is required" }, 400);
  }

  const schedules = [];
  for (const scheduleId of scheduleIds) {
    const res = await ctx.db.query(
      `SELECT cs.*, p.name AS program_name, p.num_classes AS program_num_classes
       FROM class_schedules cs
       JOIN programs p ON cs.program_id = p.id
       WHERE cs.id = $1 AND cs.active = true`,
      [scheduleId]
    );
    if (res.rows.length === 0) {
      return json({ error: `Class schedule not found: ${scheduleId}` }, 404);
    }
    schedules.push(res.rows[0]);
  }
  const bundleKey = (s) => [s.program_id, s.semester_id, s.session_type, s.start_time, s.end_time,
    s.age_group, s.price_cents, s.max_seats].join("|");
  const firstKey = bundleKey(schedules[0]);
  if (!schedules.every((s) => bundleKey(s) === firstKey)) {
    return json({ error: "All selected days must belong to the same class bundle" }, 400);
  }

  for (const schedule of schedules) {
    const countRes = await ctx.db.query(
      `SELECT COUNT(*) AS held FROM enrollments
       WHERE schedule_id = $1
         AND (status = 'confirmed'
              OR (status = 'pending' AND created_at > now() - interval '60 minutes'))`,
      [schedule.id]
    );
    if (parseInt(countRes.rows[0].held, 10) >= schedule.max_seats) {
      return json({ error: `Class is full: ${schedule.day_of_week}`, spots_available: 0 }, 409);
    }
  }

  const perClass = schedules[0].price_cents;
  const numClasses = schedules.length;
  const isEarlyBird = numClasses >= EARLY_BIRD_MIN_CLASSES && new Date() <= new Date(EARLY_BIRD_DEADLINE);
  const ebPct = EARLY_BIRD_PCT;
  const subtotal = perClass * numClasses;
  const discountAmount = isEarlyBird ? Math.round((subtotal * ebPct) / 100) : 0;
  const total = subtotal - discountAmount;
  const perDayDiscounted = perClass - Math.round((perClass * (isEarlyBird ? ebPct : 0)) / 100);

  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;
  const siteUrl = ctx.env.SITE_URL || "https://olivistart.com";

  const password = randomPassword();
  const signupRes = await fetch(`${apiBase}/auth/${appId}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: student_email, password, display_name: student_name }),
  });
  const signupData = await signupRes.json();
  if (!signupRes.ok) {
    const msg = String(signupData.error || signupData.message || "");
    if (/already exists|already registered/i.test(msg)) {
      return json({
        error: "An account with this email already exists. Please log in to enroll.",
        code: "EMAIL_EXISTS",
      }, 409);
    }
    console.error("Failed to create guest account:", msg);
    return json({ error: "Could not start checkout. Please try again." }, 502);
  }
  const guestUser = signupData.user;

  const loginRes = await fetch(`${apiBase}/auth/${appId}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: student_email, password }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error("Failed to sign in guest account:", loginData.error || loginData.message);
    return json({ error: "Could not start checkout. Please try again." }, 502);
  }
  const guestToken = loginData.access_token;

  const enrollmentIds = [];
  for (let i = 0; i < schedules.length; i += 1) {
    const schedule = schedules[i];
    const isLast = i === schedules.length - 1;
    const rowTotal = isLast ? total - perDayDiscounted * i : perDayDiscounted;
    const enrollRes = await ctx.db.query(
      `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                                status, num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents,
                                parent_name)
       VALUES ($1, $2, $3, $4, $5, 'pending', 1, $6, $7, $8, $9)
       RETURNING id`,
      [schedule.id, guestUser.id, student_name, student_email, student_phone,
       perClass, isEarlyBird ? ebPct : 0, rowTotal, parent_name]
    );
    enrollmentIds.push(enrollRes.rows[0].id);
  }

  const dayList = schedules.map((s) => s.day_of_week).join(", ");
  const productName = `${schedules[0].program_name} - ${numClasses} day${numClasses > 1 ? "s" : ""} (${dayList})` +
    (isEarlyBird ? ` (${ebPct}% early-bird)` : "");
  const productRes = await fetch(`${apiBase}/v1/${appId}/billing/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.env.SERVICE_KEY}` },
    body: JSON.stringify({
      name: productName,
      priceCents: total,
      description: `${schedules[0].program_name} art class - ${numClasses} day${numClasses > 1 ? "s" : ""} x $${(perClass / 100).toFixed(2)}` +
        (isEarlyBird ? `, ${ebPct}% early-bird discount` : ""),
      metadata: {
        enrollment_ids: enrollmentIds.join(","),
        schedule_ids: scheduleIds.join(","),
        guest: "true",
        num_classes: String(numClasses),
        price_per_class_cents: String(perClass),
        discount_pct: String(isEarlyBird ? ebPct : 0),
        total_cents: String(total),
      },
    }),
  });
  if (!productRes.ok) {
    const errText = await productRes.text();
    console.error("Failed to create product:", errText);
    await ctx.db.query(`DELETE FROM enrollments WHERE id = ANY($1)`, [enrollmentIds]);
    return json({ error: "Failed to create payment product" }, 502);
  }
  const product = await productRes.json();

  const purchaseRes = await fetch(`${apiBase}/v1/${appId}/billing/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${guestToken}` },
    body: JSON.stringify({
      productId: product.id,
      successUrl: `${siteUrl}/checkout-success.html?enrollment=${enrollmentIds[0]}`,
      cancelUrl: `${siteUrl}/enroll.html?schedule=${scheduleIds[0]}&payment=cancelled`,
    }),
  });
  if (!purchaseRes.ok) {
    const errText = await purchaseRes.text();
    console.error("Failed to create checkout session:", errText);
    await ctx.db.query(`DELETE FROM enrollments WHERE id = ANY($1)`, [enrollmentIds]);
    return json({ error: "Failed to create checkout session" }, 502);
  }
  const purchase = await purchaseRes.json();

  await ctx.db.query(
    `UPDATE enrollments SET stripe_order_id = $1 WHERE id = ANY($2)`,
    [purchase.orderId, enrollmentIds]
  );

  return json({
    enrollment_id: enrollmentIds[0],
    checkout_url: purchase.url,
    total_cents: total,
  }, 200);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/guest-enroll.test.mjs`
Expected: PASS (3 tests total)

- [ ] **Step 5: Commit**

```bash
git add backend/functions/guest-enroll.js test/guest-enroll.test.mjs
git commit -m "guest-enroll: support multi-day enrollment via schedule_ids"
```

---

### Task 5: `complete-registration.js` — apply the form to every row sharing a `stripe_order_id`

**Files:**
- Modify: `backend/functions/complete-registration.js:38-45`
- Test: `test/enrollment-group-registration.test.mjs` (new file)

**Interfaces:**
- Produces: `complete-registration` now updates every `enrollments` row sharing the target row's `stripe_order_id` (still scoped to `ctx.user.id`), not just the single row named by `enrollment_id`. Rows with a `NULL` `stripe_order_id` still update via the direct `id` match, so today's single-row behavior is unchanged when there's no group.

- [ ] **Step 1: Write the failing test**

Create `test/enrollment-group-registration.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { handler as completeRegistration } from "../backend/functions/complete-registration.js";

function request(body) {
  return new Request("https://example.test/complete-registration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("complete-registration applies the form to every enrollment sharing the same stripe_order_id", async () => {
  const queries = [];
  const response = await completeRegistration(request({
    enrollment_id: "enrollment-1",
    child_name: "Student Example",
    child_dob: "2015-10-20",
    parent_name: "Grace Hopper",
  }), {
    user: { id: "parent-1" },
    db: {
      async query(sql, values) {
        queries.push({ sql, values });
        return { rows: [{ id: "enrollment-1" }, { id: "enrollment-2" }] };
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /WHERE user_id = \$\d+/);
  assert.match(
    queries[0].sql,
    /OR stripe_order_id = \(SELECT stripe_order_id FROM enrollments WHERE id = \$\d+ AND user_id = \$\d+\)/
  );
  assert.deepEqual(await response.json(), { id: "enrollment-1" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/enrollment-group-registration.test.mjs`
Expected: FAIL — current WHERE clause doesn't reference `stripe_order_id`.

- [ ] **Step 3: Implement**

Replace the UPDATE block in `backend/functions/complete-registration.js` (lines 38-45):

```js
  const res = await ctx.db.query(
    `UPDATE enrollments
     SET ${sets.length ? sets.join(", ") + "," : ""}
         agreement_signed = true, agreement_date = now(), registration_complete = true
     WHERE user_id = $${values.length}
       AND (
         id = $${values.length - 1}
         OR stripe_order_id = (SELECT stripe_order_id FROM enrollments WHERE id = $${values.length - 1} AND user_id = $${values.length})
       )
     RETURNING id`,
    values
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/enrollment-group-registration.test.mjs`
Expected: PASS

Also run the pre-existing age test to confirm no regression:

Run: `node --test test/student-age.test.mjs`
Expected: PASS (unchanged — same bound values, only the WHERE clause text changed)

- [ ] **Step 5: Commit**

```bash
git add backend/functions/complete-registration.js test/enrollment-group-registration.test.mjs
git commit -m "complete-registration: apply the form to every row in a stripe_order_id group"
```

---

### Task 6: `js/enroll.js` — Parent Name field

**Files:**
- Modify: `js/enroll.js` (state, init, render, handleEnroll)
- Test: `test/enroll.test.mjs` (extend)

**Interfaces:**
- Produces: `state.parentName` (string), pre-filled from `state.user.display_name || state.user.email || ""` for logged-in users, empty for guests; rendered as a required, editable text input; sent as `parent_name` to both `enroll-guard` and `guest-enroll`.

- [ ] **Step 1: Write the failing tests**

Add to `test/enroll.test.mjs`:

```js
test("enroll.js pre-fills an editable Parent Name field from the account, not the Student Name field", async () => {
  const script = await readEnroll();
  assert.match(script, /parentName: ""/);
  assert.match(script, /state\.parentName = state\.user\.display_name \|\| state\.user\.email \|\| ""/);
  assert.match(script, /oninput = \(e\) => \(state\.parentName = e\.target\.value\)/);
  assert.doesNotMatch(script, /state\.studentName = state\.user\.display_name/);
});

test("enroll.js sends parent_name to both enroll-guard and guest-enroll", async () => {
  const script = await readEnroll();
  const matches = script.match(/parent_name: state\.parentName/g) || [];
  assert.equal(matches.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/enroll.test.mjs`
Expected: FAIL — no `parentName` state or field exists yet; `enroll.js:349` still wrongly sets `state.studentName` from `display_name`.

- [ ] **Step 3: Implement**

In `js/enroll.js`, add `parentName: ""` to the `state` object (after `studentName: ""` at line 18... place it before `studentName`):

```js
const state = {
  user: null,
  schedule: null,
  program: null,
  enrollmentCount: 0,
  loading: true,
  error: "",
  enrolling: false,
  parentName: "",
  studentName: "",
  studentEmail: "",
  studentPhone: "",
  numClasses: 8,
  isCamp: false,
  campDays: [],
};
```

In `render()`, add a Parent Name field to the form, right before the "Student Name" label block (before line 219's `const lblName = ...`):

```js
    const lblParent = el("label", "", "Parent Name");
    const inpParent = document.createElement("input");
    inpParent.type = "text";
    inpParent.value = state.parentName;
    inpParent.required = true;
    inpParent.placeholder = "Parent/guardian full name";
    inpParent.oninput = (e) => (state.parentName = e.target.value);
    lblParent.appendChild(inpParent);
    form.appendChild(lblParent);
```

In `handleEnroll`, add `parent_name: state.parentName` to both `callFunction` calls:

```js
      result = await callFunction(
        "enroll-guard",
        {
          schedule_id: scheduleId,
          student_name: state.studentName,
          student_email: state.user.email || "",
          student_phone: state.studentPhone,
          parent_name: state.parentName,
          num_classes_enrolled: state.numClasses,
        },
        getToken()
      );
```

```js
      result = await callFunction("guest-enroll", {
        schedule_id: scheduleId,
        student_name: state.studentName,
        student_email: email,
        student_phone: state.studentPhone,
        parent_name: state.parentName,
        num_classes_enrolled: state.numClasses,
      });
```

In `init()`, replace the buggy pre-fill:

```js
    if (isLoggedIn()) {
      state.user = getUser();
      state.parentName = state.user.display_name || state.user.email || "";
    }
```

(This removes the old `state.studentName = state.user.display_name || state.user.email || "";` line entirely — Student Name starts empty for logged-in users until Task 7 wires up the students dropdown.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/enroll.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/enroll.js test/enroll.test.mjs
git commit -m "enroll.js: add editable Parent Name field pre-filled from the account"
```

---

### Task 7: `js/enroll.js` — Student dropdown from the account's existing students

**Files:**
- Modify: `js/enroll.js` (state, init, render)
- Modify: `css/style.css` (style the new `<select>`)
- Test: `test/enroll.test.mjs` (extend)

**Interfaces:**
- Consumes: `manage-students` function's `{ action: "list" }` response shape `{ students: [{ id, name, ... }] }` (see `backend/functions/manage-students.js`'s `list()`).
- Produces: `state.students` (array), `state.studentId` (string id of a selected existing student, or `null`). When `state.students.length > 0`, the form shows a `<select>` of student names plus "Other / New student"; choosing "Other / New student" reveals a free-text input and clears `state.studentId`.

- [ ] **Step 1: Write the failing tests**

Add to `test/enroll.test.mjs`:

```js
test("enroll.js loads the account's students for logged-in parents", async () => {
  const script = await readEnroll();
  assert.match(script, /callFunction\("manage-students", \{ action: "list" \}, token\)/);
  assert.match(script, /state\.students = data\.students \|\| \[\]/);
});

test("enroll.js offers a student dropdown with an Other / New student fallback", async () => {
  const script = await readEnroll();
  assert.match(script, /Other \/ New student/);
  assert.match(script, /state\.studentId = null/);
  assert.match(script, /state\.students\.length > 0/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/enroll.test.mjs`
Expected: FAIL — no student list loading or dropdown exists yet.

- [ ] **Step 3: Implement**

Add `students: []` and `studentId: null` to `state` in `js/enroll.js` (after `parentName: ""`):

```js
  parentName: "",
  students: [],
  studentId: null,
  studentName: "",
```

In `init()`, extend the logged-in branch to fetch students:

```js
    if (isLoggedIn()) {
      state.user = getUser();
      state.parentName = state.user.display_name || state.user.email || "";
      const token = getToken();
      try {
        const data = await callFunction("manage-students", { action: "list" }, token);
        state.students = data.students || [];
      } catch {
        state.students = [];
      }
    }
```

In `render()`, replace the Student Name block (lines 219-227) with:

```js
    const lblName = el("label", "", "Student Name");
    if (state.students.length > 0) {
      const select = document.createElement("select");
      state.students.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        if (state.studentId === s.id) opt.selected = true;
        select.appendChild(opt);
      });
      const optOther = document.createElement("option");
      optOther.value = "__other__";
      optOther.textContent = "Other / New student";
      if (!state.studentId) optOther.selected = true;
      select.appendChild(optOther);
      select.onchange = (e) => {
        if (e.target.value === "__other__") {
          state.studentId = null;
          state.studentName = "";
        } else {
          const chosen = state.students.find((s) => s.id === e.target.value);
          state.studentId = chosen.id;
          state.studentName = chosen.name;
        }
        render();
      };
      lblName.appendChild(select);
      form.appendChild(lblName);

      if (!state.studentId) {
        const lblOther = el("label", "", "New Student Name");
        const inpOther = document.createElement("input");
        inpOther.type = "text";
        inpOther.value = state.studentName;
        inpOther.required = true;
        inpOther.placeholder = "Student's full name";
        inpOther.oninput = (e) => (state.studentName = e.target.value);
        lblOther.appendChild(inpOther);
        form.appendChild(lblOther);
      }
    } else {
      const inpName = document.createElement("input");
      inpName.type = "text";
      inpName.value = state.studentName;
      inpName.required = true;
      inpName.placeholder = "Student's full name";
      inpName.oninput = (e) => (state.studentName = e.target.value);
      lblName.appendChild(inpName);
      form.appendChild(lblName);
    }
```

Add `student_id: state.studentId` to the `enroll-guard` call only (guests never send it):

```js
      result = await callFunction(
        "enroll-guard",
        {
          schedule_id: scheduleId,
          student_name: state.studentName,
          student_email: state.user.email || "",
          student_phone: state.studentPhone,
          parent_name: state.parentName,
          student_id: state.studentId,
          num_classes_enrolled: state.numClasses,
        },
        getToken()
      );
```

In `css/style.css`, after the `.enroll-form input` rule (line 2102), add:

```css
.enroll-form select {
  width: 100%;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--color-text);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 0.95rem;
  border-radius: 6px;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/enroll.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/enroll.js css/style.css test/enroll.test.mjs
git commit -m "enroll.js: offer a student dropdown from the account's existing students"
```

---

### Task 8: `js/enroll.js` — day-of-week checkboxes and multi-day submission

**Files:**
- Modify: `js/enroll.js` (state, init, render, handleEnroll)
- Modify: `css/style.css` (style `.day-checkboxes`)
- Test: `test/enroll.test.mjs` (extend)

**Interfaces:**
- Consumes: `campBundleQuery`, `compareDayOfWeek` from `js/api.js` (already imported at the top of `enroll.js`, unchanged).
- Produces: `state.siblingSchedules` (sorted sibling `class_schedules` rows sharing this schedule's bundle signature, only populated for non-camp programs with 2+ siblings), `state.selectedScheduleIds` (a `Set` of selected schedule ids, defaulting to just the clicked one), `function getNumClasses()` (returns `selectedScheduleIds.size` in multi-day mode, else `state.numClasses`). `handleEnroll` sends `schedule_ids: [...state.selectedScheduleIds]` instead of `schedule_id` when in multi-day mode.

- [ ] **Step 1: Write the failing tests**

Add to `test/enroll.test.mjs`:

```js
test("enroll.js detects non-camp sibling schedules and defaults to only the clicked day selected", async () => {
  const script = await readEnroll();
  assert.match(script, /\} else if \(siblings\.length > 1\) \{/);
  assert.match(script, /state\.selectedScheduleIds = new Set\(\[scheduleId\]\)/);
  assert.match(script, /function getNumClasses\(\)/);
});

test("enroll.js prevents unchecking the only remaining selected day", async () => {
  const script = await readEnroll();
  assert.match(script, /cb\.disabled = cb\.checked && state\.selectedScheduleIds\.size === 1/);
});

test("enroll.js submits schedule_ids instead of schedule_id when multiple days are selected", async () => {
  const script = await readEnroll();
  assert.match(script, /schedule_ids: \[\.\.\.state\.selectedScheduleIds\]/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/enroll.test.mjs`
Expected: FAIL — no sibling-day detection, checkboxes, or multi-day submission exist yet.

- [ ] **Step 3: Implement**

Add `siblingSchedules: []` and `selectedScheduleIds: new Set()` to `state`:

```js
  numClasses: 8,
  isCamp: false,
  campDays: [],
  siblingSchedules: [],
  selectedScheduleIds: new Set(),
```

In `init()`, replace the camp-detection block:

```js
    const siblings = await apiGet(campBundleQuery(state.schedule));
    if (state.program?.program_type === "camp") {
      state.isCamp = true;
      state.campDays = siblings.map((s) => s.day_of_week).sort(compareDayOfWeek);
      state.numClasses = siblings.length || 1;
    } else if (siblings.length > 1) {
      state.siblingSchedules = [...siblings].sort((a, b) => compareDayOfWeek(a.day_of_week, b.day_of_week));
      state.selectedScheduleIds = new Set([scheduleId]);
    }
```

Add a helper function near the top of the file (after the `el()` helper):

```js
function getNumClasses() {
  if (state.siblingSchedules.length > 1) return Math.max(1, state.selectedScheduleIds.size);
  return state.numClasses;
}

function selectedDayNames() {
  return state.siblingSchedules
    .filter((s) => state.selectedScheduleIds.has(s.id))
    .map((s) => s.day_of_week);
}
```

In `render()`, replace every pricing use of `state.numClasses` with `getNumClasses()`:

```js
  const isEarlyBird = computeEarlyBird(getNumClasses());

  const subtotal = pricePerClass * getNumClasses();
```

Update the "Day" detail row:

```js
    const rowDay = el("div", "detail-row");
    rowDay.appendChild(el("span", "detail-label", "Day"));
    rowDay.appendChild(el("span", "", state.isCamp ? state.campDays.join(", ")
      : state.siblingSchedules.length > 1 ? selectedDayNames().join(", ")
      : schedule.day_of_week));
    details.appendChild(rowDay);
```

Replace the number-of-classes control block to add a third branch (checkboxes) between the camp branch and the stepper branch:

```js
  if (state.isCamp) {
    rowClasses.appendChild(el("span", "num-classes-value",
      `${state.numClasses} (${state.campDays.join(", ")} - included, not adjustable)`));
  } else if (state.siblingSchedules.length > 1) {
    const dayCheckboxes = el("div", "day-checkboxes");
    state.siblingSchedules.forEach((sib) => {
      const lbl = el("label", "checkbox-label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.selectedScheduleIds.has(sib.id);
      cb.disabled = cb.checked && state.selectedScheduleIds.size === 1;
      cb.onchange = (e) => {
        if (e.target.checked) state.selectedScheduleIds.add(sib.id);
        else state.selectedScheduleIds.delete(sib.id);
        render();
      };
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(` ${sib.day_of_week}`));
      dayCheckboxes.appendChild(lbl);
    });
    rowClasses.appendChild(dayCheckboxes);
  } else {
    const ctrl = el("div", "num-classes-control");
    const minusBtn = el("button", "", "−");
    minusBtn.type = "button";
    minusBtn.disabled = state.numClasses <= 1 || isFull;
    minusBtn.onclick = () => { state.numClasses = Math.max(1, state.numClasses - 1); render(); };
    ctrl.appendChild(minusBtn);

    ctrl.appendChild(el("span", "num-classes-value", String(state.numClasses)));

    const plusBtn = el("button", "", "+");
    plusBtn.type = "button";
    plusBtn.disabled = state.numClasses >= maxClasses || isFull;
    plusBtn.onclick = () => { state.numClasses = Math.min(maxClasses, state.numClasses + 1); render(); };
    ctrl.appendChild(plusBtn);

    ctrl.appendChild(el("span", "muted num-classes-max", `of ${maxClasses}`));
    rowClasses.appendChild(ctrl);
  }
```

In `handleEnroll`, build the schedule params once and spread them into both calls:

```js
  state.enrolling = true;
  render();
  try {
    const multiDay = state.siblingSchedules.length > 1;
    const scheduleParams = multiDay
      ? { schedule_ids: [...state.selectedScheduleIds] }
      : { schedule_id: scheduleId, num_classes_enrolled: state.numClasses };

    let result;
    if (state.user) {
      result = await callFunction(
        "enroll-guard",
        {
          ...scheduleParams,
          student_name: state.studentName,
          student_email: state.user.email || "",
          student_phone: state.studentPhone,
          parent_name: state.parentName,
          student_id: state.studentId,
        },
        getToken()
      );
    } else {
      const email = state.studentEmail.trim().toLowerCase();
      result = await callFunction("guest-enroll", {
        ...scheduleParams,
        student_name: state.studentName,
        student_email: email,
        student_phone: state.studentPhone,
        parent_name: state.parentName,
      });
      try { sessionStorage.setItem("olivistart_pending_email", email); } catch { /* private mode */ }
    }
    window.location.href = result.checkout_url;
  } catch (err) {
    state.error = err.message;
    state.enrolling = false;
    render();
  }
```

In `css/style.css`, after the `.num-classes-max` rule (line 2212), add:

```css
.day-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.day-checkboxes .checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/enroll.test.mjs`
Expected: PASS (all enroll.js tests, including the pre-existing camp tests from before this plan)

- [ ] **Step 5: Commit**

```bash
git add js/enroll.js css/style.css test/enroll.test.mjs
git commit -m "enroll.js: add day-of-week checkboxes for multi-day classes"
```

---

### Task 9: `js/registration.js` — group display for multi-row orders

**Files:**
- Modify: `js/registration.js:3` (imports), `js/registration.js:50-70` (state), `js/registration.js:131-149` (Class Summary render), `js/registration.js:273-310` (`init`)
- Test: `test/registration-group.test.mjs` (new file)

**Interfaces:**
- Produces: `state.group` (array of every `enrollments` row sharing the loaded enrollment's `stripe_order_id`, or `[enrollment]` when there is no group), `state.schedules` (the corresponding `class_schedules` rows, replacing the old singular `state.schedule`). The Class Summary section shows a combined day list and totals across the group; a single form submission (unchanged — still posts one `enrollment_id`) relies on Task 5's backend change to apply to the whole group.

- [ ] **Step 1: Write the failing tests**

Create `test/registration-group.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readRegistration = () => readFile(new URL("../js/registration.js", import.meta.url), "utf8");

test("registration.js loads every enrollment sharing the same stripe_order_id as one group", async () => {
  const script = await readRegistration();
  assert.match(script, /import \{ apiGet, apiGetByIds, callFunction, formatPrice, formatTime, getQueryParam, compareDayOfWeek \} from "\.\/api\.js"/);
  assert.match(script, /state\.group = en\.stripe_order_id/);
  assert.match(script, /enrollments\?stripe_order_id=eq\.\$\{en\.stripe_order_id\}&order=created_at\.asc/);
  assert.match(script, /apiGetByIds\("class_schedules", scheduleIds\)/);
});

test("registration.js shows a combined day list and totals across the group", async () => {
  const script = await readRegistration();
  assert.match(script, /state\.schedules\.map\(\(s\) => s\.day_of_week\)\.sort\(compareDayOfWeek\)\.join\(", "\)/);
  assert.match(script, /state\.group\.reduce\(\(sum, row\) => sum \+ \(row\.num_classes_enrolled \|\| 0\), 0\)/);
  assert.match(script, /state\.group\.reduce\(\(sum, row\) => sum \+ \(row\.total_paid_cents \|\| 0\), 0\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/registration-group.test.mjs`
Expected: FAIL — `registration.js` still fetches and displays a single schedule.

- [ ] **Step 3: Implement**

Change the import at `js/registration.js:3`:

```js
import { apiGet, apiGetByIds, callFunction, formatPrice, formatTime, getQueryParam, compareDayOfWeek } from "./api.js";
```

In `state` (around line 50-54), replace `schedule: null,` with:

```js
  group: [],
  schedules: [],
```

Replace the Class Summary block (lines 132-149) with:

```js
  if (state.enrollment) {
    const sum = el("div", "registration-summary");
    sum.appendChild(el("h4", "", "Class Summary"));
    if (state.program) sum.appendChild(el("p", "", `<strong>${state.program.name}</strong>`));
    if (state.schedules.length > 0) {
      const days = state.schedules.map((s) => s.day_of_week).sort(compareDayOfWeek).join(", ");
      const first = state.schedules[0];
      sum.appendChild(el("p", "muted",
        `${days} ${formatTime(first.start_time)}–${formatTime(first.end_time)} · ${first.age_group}`));
    }
    const pricing = el("div", "registration-summary-pricing");
    const totalClasses = state.group.reduce((sum, row) => sum + (row.num_classes_enrolled || 0), 0);
    const totalPaid = state.group.reduce((sum, row) => sum + (row.total_paid_cents || 0), 0);
    if (totalClasses) pricing.appendChild(el("span", "", `${totalClasses} classes`));
    if (totalPaid) pricing.appendChild(el("span", "price-highlight", `${formatPrice(totalPaid)} paid`));
    sum.appendChild(pricing);
    root.appendChild(sum);
  }
```

Replace the schedule/program lookup in `init()` (lines 297-303):

```js
    state.group = en.stripe_order_id
      ? await apiGet(`enrollments?stripe_order_id=eq.${en.stripe_order_id}&order=created_at.asc`, token)
      : [en];

    const scheduleIds = [...new Set(state.group.map((row) => row.schedule_id).filter(Boolean))];
    state.schedules = await apiGetByIds("class_schedules", scheduleIds);
    if (state.schedules.length > 0) {
      const prog = await apiGet(`programs?id=eq.${state.schedules[0].program_id}`);
      if (prog.length > 0) state.program = prog[0];
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/registration-group.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/registration.js test/registration-group.test.mjs
git commit -m "registration.js: show a combined summary for multi-day enrollment groups"
```

---

### Task 10: `js/enrollment-grouping.js` + `js/account.js` — group cards by `stripe_order_id`

**Files:**
- Create: `js/enrollment-grouping.js`
- Test: `test/enrollment-grouping.test.mjs` (new file)
- Modify: `js/account.js:3-4` (imports), `js/account.js:206-232` (`renderEnrollmentsTab`), `js/account.js:234-329` (`renderEnrollmentCard`, split)
- Modify: `css/style.css` (style the new group card elements)
- Test: `test/enrollment-group-account.test.mjs` (new file)

**Interfaces:**
- Produces (`js/enrollment-grouping.js`): `groupEnrollmentsByOrder(enrollments)` — a pure function returning an array of groups (arrays), grouping rows by `stripe_order_id` (falling back to the row's own `id` when null), preserving first-seen order.
- Produces (`js/account.js`): `renderEnrollmentCardHeader(rows, program)` (shared header used by both single and grouped cards, reads status/registration state from `rows[0]` since all rows in a real group are always kept in sync by `stripe-webhook.js` and Task 5's `complete-registration.js` change), `renderEnrollmentDayDetail(en)` (the credit-balance/upcoming-classes/make-up section for one row, unchanged behavior, now reusable), `renderEnrollmentGroupCard(rows)` (wraps one shared header + one student-assignment block + one `renderEnrollmentDayDetail` per row, each under a day label).

- [ ] **Step 1: Write the failing test for the pure grouping helper**

Create `test/enrollment-grouping.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupEnrollmentsByOrder } from "../js/enrollment-grouping.js";

test("groups rows sharing a stripe_order_id together, preserving first-seen order", () => {
  const rows = [
    { id: "e1", stripe_order_id: "order-1" },
    { id: "e2", stripe_order_id: "order-2" },
    { id: "e3", stripe_order_id: "order-1" },
  ];
  assert.deepEqual(groupEnrollmentsByOrder(rows), [
    [{ id: "e1", stripe_order_id: "order-1" }, { id: "e3", stripe_order_id: "order-1" }],
    [{ id: "e2", stripe_order_id: "order-2" }],
  ]);
});

test("rows without a stripe_order_id each form their own single-row group", () => {
  const rows = [
    { id: "e1", stripe_order_id: null },
    { id: "e2", stripe_order_id: null },
  ];
  assert.deepEqual(groupEnrollmentsByOrder(rows), [
    [{ id: "e1", stripe_order_id: null }],
    [{ id: "e2", stripe_order_id: null }],
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/enrollment-grouping.test.mjs`
Expected: FAIL — `js/enrollment-grouping.js` doesn't exist yet.

- [ ] **Step 3: Implement the pure helper**

Create `js/enrollment-grouping.js`:

```js
// Groups enrollment rows created in the same checkout (sharing one
// stripe_order_id) so the account page can render them as one card. Rows
// without a stripe_order_id (not yet paid, or predating this grouping)
// each form their own single-row group.
export function groupEnrollmentsByOrder(enrollments) {
  const order = [];
  const byKey = new Map();
  enrollments.forEach((en) => {
    const key = en.stripe_order_id || en.id;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key).push(en);
  });
  return order.map((key) => byKey.get(key));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/enrollment-grouping.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit the pure helper**

```bash
git add js/enrollment-grouping.js test/enrollment-grouping.test.mjs
git commit -m "add groupEnrollmentsByOrder helper for multi-day enrollment groups"
```

- [ ] **Step 6: Write the failing test for account.js wiring**

Create `test/enrollment-group-account.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readAccount = () => readFile(new URL("../js/account.js", import.meta.url), "utf8");

test("account.js groups enrollments by stripe_order_id before rendering cards", async () => {
  const account = await readAccount();
  assert.match(account, /import \{ groupEnrollmentsByOrder \} from "\.\/enrollment-grouping\.js"/);
  assert.match(account, /groupEnrollmentsByOrder\(state\.enrollments\)\.forEach\(\(rows\) => \{/);
  assert.match(account, /rows\.length > 1 \? renderEnrollmentGroupCard\(rows\) : renderEnrollmentCard\(rows\[0\]\)/);
});

test("account.js has a shared card header and a reusable per-row day-detail section", async () => {
  const account = await readAccount();
  assert.match(account, /function renderEnrollmentCardHeader\(rows, program\)/);
  assert.match(account, /function renderEnrollmentDayDetail\(en\)/);
  assert.match(account, /function renderEnrollmentGroupCard\(rows\)/);
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `node --test test/enrollment-group-account.test.mjs`
Expected: FAIL — `account.js` still renders one ungrouped card per row.

- [ ] **Step 8: Implement account.js changes**

Add the import at `js/account.js:3-5`:

```js
import { apiGet, apiGetByIds, callFunction, formatPrice, formatTime, getQueryParam, compareDayOfWeek } from "./api.js";
import { isLoggedIn, getUser, isAdmin, logout, getToken, refreshToken, requireAuth, claimEnrollments } from "./auth.js";
import { calculateStudentAge } from "./student-age.js";
import { groupEnrollmentsByOrder } from "./enrollment-grouping.js";
```

Replace `renderEnrollmentsTab()` (lines 206-232):

```js
function renderEnrollmentsTab() {
  root.appendChild(el("h3", "", "My Enrollments"));

  if (state.loading) {
    root.appendChild(el("p", "muted", "Loading…"));
    return;
  }
  if (state.error) {
    root.appendChild(el("p", "auth-error", state.error));
    return;
  }
  if (state.enrollments.length === 0) {
    const empty = el("div", "empty-state");
    empty.appendChild(el("p", "", "You haven't enrolled in any classes yet."));
    const browse = el("a", "btn", "Browse Classes");
    browse.href = "schedule.html";
    empty.appendChild(browse);
    root.appendChild(empty);
    return;
  }

  const list = el("div", "enrollment-list");
  groupEnrollmentsByOrder(state.enrollments).forEach((rows) => {
    list.appendChild(rows.length > 1 ? renderEnrollmentGroupCard(rows) : renderEnrollmentCard(rows[0]));
  });
  root.appendChild(list);
}
```

Replace `renderEnrollmentCard(en)` (lines 234-329) with three functions — a shared header, the extracted per-row detail section, the single-row card, and the new group card:

```js
function renderEnrollmentCardHeader(rows, program) {
  const first = rows[0];
  const cardHeader = el("div", "enrollment-card-header");
  const info = el("div", "enrollment-info");
  info.appendChild(el("h4", "", program ? program.name : first.student_name));
  info.appendChild(el("p", "muted", first.student_email || ""));
  if (rows.length > 1) {
    const days = rows
      .map((en) => state.schedules.find((s) => s.id === en.schedule_id)?.day_of_week)
      .filter(Boolean)
      .sort(compareDayOfWeek);
    info.appendChild(el("p", "muted enrollment-group-days", days.join(", ")));
  }
  const totalClasses = rows.reduce((sum, en) => sum + (en.num_classes_enrolled || 0), 0);
  const totalPaid = rows.reduce((sum, en) => sum + (en.total_paid_cents || 0), 0);
  if (totalClasses) {
    info.appendChild(el("p", "muted",
      `${totalClasses} classes purchased` + (totalPaid ? ` · ${formatPrice(totalPaid)} paid` : "")));
  }
  cardHeader.appendChild(info);

  const statusCol = el("div", "enrollment-status");
  statusCol.appendChild(el("span", `status-badge status-${first.status}`, first.status));
  if (first.registration_complete) {
    statusCol.appendChild(el("span", "status-badge status-registered", "Registered"));
  } else {
    const reg = el("a", "btn btn-sm", "Complete Registration");
    reg.href = `registration.html?enrollment=${first.id}`;
    statusCol.appendChild(reg);
  }
  cardHeader.appendChild(statusCol);
  return cardHeader;
}

function renderEnrollmentDayDetail(en) {
  const creditBalance = getCreditBalance(en);
  const upcoming = getUpcomingBookings(en.id);
  const frag = document.createDocumentFragment();

  if (en.status === "confirmed") {
    const credit = el("div", `credit-balance ${creditBalance < 0 ? "credit-negative" : "credit-positive"}`);
    credit.appendChild(el("span", "credit-label", "Credits Remaining"));
    credit.appendChild(el("span", "credit-value", String(creditBalance)));
    frag.appendChild(credit);
  } else if (en.status === "pending") {
    frag.appendChild(el("p", "muted",
      "Payment pending — credits will be available once payment is confirmed."));
  } else {
    frag.appendChild(el("p", "muted", "This enrollment was cancelled."));
  }

  if (en.status === "confirmed" && upcoming.length > 0) {
    const wrap = el("div", "upcoming-classes");
    wrap.appendChild(el("h5", "", "Upcoming Classes"));
    upcoming.forEach((b) => {
      const within24 = isWithin24h(b.session_id);
      const sess = state.sessions.find((s) => s.id === b.session_id);
      const row = el("div", "upcoming-class-row");

      const left = el("div", "upcoming-class-info");
      left.appendChild(el("span", "upcoming-class-date",
        new Date(b.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })));
      left.appendChild(el("span", "muted",
        b.schedule ? `${formatTime(b.schedule.start_time)}–${formatTime(b.schedule.end_time)}` : ""));
      left.appendChild(el("span", `booking-type-badge booking-type-${b.type}`,
        b.type === "home" ? "Home" : "Make-up"));
      row.appendChild(left);

      const actions = el("div", "upcoming-class-actions");
      if (b.type === "home") {
        const skipBtn = el("button", "btn btn-sm btn-secondary", "Skip");
        skipBtn.disabled = within24;
        skipBtn.title = within24 ? "Cannot skip within 24h of class" : "";
        skipBtn.onclick = () => handleSkip(en.id, b.session_id);
        actions.appendChild(skipBtn);
      } else {
        const cancelBtn = el("button", "btn btn-sm btn-danger", "Cancel");
        cancelBtn.disabled = within24;
        cancelBtn.title = within24 ? "Cannot cancel within 24h of class" : "";
        cancelBtn.onclick = () => handleCancelMakeup(en.id, b.session_id);
        actions.appendChild(cancelBtn);
      }
      row.appendChild(actions);

      if (sess?.status === "cancelled") {
        row.appendChild(el("span", "status-badge status-cancelled", "Session Cancelled"));
      }
      wrap.appendChild(row);
    });
    frag.appendChild(wrap);
  }

  if (en.status === "confirmed") {
    frag.appendChild(renderMakeupSection(en));
  }

  return frag;
}

function renderEnrollmentCard(en) {
  const sched = state.schedules.find((s) => s.id === en.schedule_id);
  const program = state.programs.find((p) => p.id === sched?.program_id);

  const card = el("div", "enrollment-card enrollment-card-expanded");
  card.appendChild(renderEnrollmentCardHeader([en], program));
  card.appendChild(renderEnrollmentStudentAssignment(en));
  card.appendChild(renderEnrollmentDayDetail(en));
  return card;
}

function renderEnrollmentGroupCard(rows) {
  const first = rows[0];
  const sched = state.schedules.find((s) => s.id === first.schedule_id);
  const program = state.programs.find((p) => p.id === sched?.program_id);

  const card = el("div", "enrollment-card enrollment-card-expanded enrollment-group-card");
  card.appendChild(renderEnrollmentCardHeader(rows, program));
  card.appendChild(renderEnrollmentStudentAssignment(first));

  rows.forEach((en) => {
    const daySched = state.schedules.find((s) => s.id === en.schedule_id);
    const dayBlock = el("div", "enrollment-day-block");
    if (daySched?.day_of_week) {
      dayBlock.appendChild(el("h5", "enrollment-day-label", daySched.day_of_week));
    }
    dayBlock.appendChild(renderEnrollmentDayDetail(en));
    card.appendChild(dayBlock);
  });

  return card;
}
```

(Note: linking a group's underlying students happens through `renderEnrollmentStudentAssignment(first)` — only the first row is offered for manual re-assignment from this page. New multi-day purchases already get the same `student_id` on every row at creation time via Tasks 3-4, so this is only a gap for pre-existing single rows retroactively linked before this feature shipped, which is out of scope here.)

In `css/style.css`, after `.enrollment-student-assignment p` (around line 1849), add:

```css
.enrollment-group-days {
  font-weight: 600;
}

.enrollment-day-block {
  border-top: 1px solid var(--color-border);
  padding-top: 1rem;
  margin-top: 1rem;
}

.enrollment-day-label {
  font-family: var(--font-heading);
  font-weight: 500;
  font-size: 1rem;
  margin: 0 0 0.5rem;
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `node --test test/enrollment-group-account.test.mjs`
Expected: PASS

Also run the pre-existing student-association test to confirm no regression:

Run: `node --test test/enrollment-student-association.test.mjs`
Expected: PASS (still finds `function renderEnrollmentStudentAssignment(en)` and the "Associate with student" text, both untouched)

- [ ] **Step 10: Commit**

```bash
git add js/account.js css/style.css test/enrollment-group-account.test.mjs
git commit -m "account.js: group enrollment cards by stripe_order_id"
```

---

## Final verification

- [ ] Run the full test suite: `node --test test/*.test.mjs`
Expected: PASS (all files, including every pre-existing test)
- [ ] Manual E2E check (per project standards): as a logged-in parent with an existing student, enroll in a class that has Mon/Wed/Fri siblings, check two of the three days, confirm the price breakdown and Stripe test-mode checkout total match `2 x price_per_class`, then confirm `registration.html` shows both days and one registration submission marks both rows complete on `account.html`. Repeat once as a guest to confirm the claim + registration flow still groups correctly.
