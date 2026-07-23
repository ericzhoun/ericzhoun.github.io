# Enroll page: Class Time + independent class count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the enroll page's single "Number of classes" control into two independent things: a "Class Time" picker (which weekly day/time slot(s) - unchanged matching logic) and a "Number of Classes" stepper (total sessions purchased, default 15, minimum 10).

**Architecture:** Backend (`enroll-guard.js`, `guest-enroll.js`) stops deriving the purchased class count from how many day-parts were selected in multi-day mode, and instead reads an explicit `num_classes_enrolled` from the request in every mode, splitting it evenly across selected day-parts when there's more than one. Frontend (`js/enroll.js`) relabels the existing single-match "Time" detail row to "Class Time", moves the multi-match day checkboxes into their own "Class Time" pricing row, and adds an always-present "Number of Classes" stepper (default 15, min 10) independent of day selection.

**Tech Stack:** Vanilla JS (no framework), `node:test` + `node:assert/strict` for both backend (behavioral) and frontend (source-regex) tests, run via `node --test test/<file>.test.mjs`.

## Global Constraints

- "Number of Classes" default is 15, minimum is 10 (from the spec).
- Upper cap is `max(program.num_classes || 15, 15)` - the default of 15 is always reachable; a program configured for more than 15 sessions is still not oversellable beyond its configured count.
- Camp programs (`program_type = 'camp'`) are unchanged: fixed `campDays`, fixed non-adjustable count. Do not touch camp branches.
- The "Day" detail row above the pricing section is unchanged.
- The single-match "Time" detail row is relabeled "Class Time" and is the *only* place that slot is shown (no duplicate row in the pricing section).
- The 2+-match day checkboxes move into their own "Class Time" pricing row (previously they lived inside the "Number of classes" row).
- No change to `EARLY_BIRD_MIN_CLASSES` (15) / `EARLY_BIRD_PCT` (10) in `js/pricing.js` or the duplicated constants in both backend functions.
- Full spec: `docs/superpowers/specs/2026-07-23-enroll-page-class-time-and-class-count-design.md`.

---

### Task 1: Backend single-schedule path - floor 10 / default 15 / cap `max(program.num_classes, 15)`

**Files:**
- Modify: `backend/functions/enroll-guard.js:44-46`
- Modify: `backend/functions/guest-enroll.js:50-52`
- Test: `test/enroll-guard.test.mjs`
- Test: `test/guest-enroll.test.mjs`

**Interfaces:**
- Consumes: nothing new - reads `body.num_classes_enrolled` and `schedule.program_num_classes`, exactly as today.
- Produces: `numClasses` local variable used by the rest of the single-schedule handler (pricing, insert, product metadata) - unchanged downstream usage, only the clamp rules change.

- [ ] **Step 1: Write failing tests for the new clamp rules (both files)**

Add to `test/enroll-guard.test.mjs` (after the existing `"enroll-guard persists parent_name..."` test):

```js
test("enroll-guard floors an out-of-range low num_classes_enrolled to the 15 default", async () => {
  const { ctx } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", program_name: "Ballet", program_num_classes: 8, price_cents: 3000, max_seats: 10 }] },
    { rows: [{ held: "2" }] },
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
      num_classes_enrolled: 4,
    }), ctx);

    assert.equal(response.status, 200);
    // 15 classes hits the early-bird threshold (>= 15, before the 2026-08-15
    // deadline), so this is 3000 x 15 with the 10% discount applied, not a
    // bare 3000 x 15 - a deliberate side effect of the new default landing
    // exactly on EARLY_BIRD_MIN_CLASSES.
    assert.equal((await response.json()).total_cents, 40500);
  } finally {
    global.fetch = originalFetch;
  }
});

test("enroll-guard caps num_classes_enrolled at max(program.num_classes, 15)", async () => {
  const { ctx } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", program_name: "Ballet", program_num_classes: 20, price_cents: 3000, max_seats: 10 }] },
    { rows: [{ held: "2" }] },
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
      num_classes_enrolled: 99,
    }), ctx);

    assert.equal(response.status, 200);
    // 20 also clears the early-bird threshold: 3000 x 20 with 10% off.
    assert.equal((await response.json()).total_cents, 54000);
  } finally {
    global.fetch = originalFetch;
  }
});
```

Add the mirrored pair to `test/guest-enroll.test.mjs` (after the existing `"guest-enroll persists parent_name..."` test):

```js
test("guest-enroll floors an out-of-range low num_classes_enrolled to the 15 default", async () => {
  const { ctx } = makeCtx([
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
      num_classes_enrolled: 4,
    }), ctx);

    assert.equal(response.status, 200);
    // Same early-bird interaction as the enroll-guard test above: 15 classes
    // clears the >= 15 threshold, so this is 3000 x 15 with 10% off.
    assert.equal((await response.json()).total_cents, 40500);
  } finally {
    global.fetch = originalFetch;
  }
});

test("guest-enroll caps num_classes_enrolled at max(program.num_classes, 15)", async () => {
  const { ctx } = makeCtx([
    { rows: [{ id: "sched-1", program_id: "prog-1", program_name: "Ballet", program_num_classes: 20, price_cents: 3000, max_seats: 10 }] },
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
      num_classes_enrolled: 99,
    }), ctx);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).total_cents, 54000);
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/enroll-guard.test.mjs test/guest-enroll.test.mjs`
Expected: the two new tests in each file FAIL (`total_cents` will be `3000 * 4` / `3000 * 8` under today's clamp-at-`program_num_classes` rule, not `3000 * 15` / `3000 * 20`). All pre-existing tests in both files still PASS.

- [ ] **Step 3: Implement the new clamp in `enroll-guard.js`**

In `backend/functions/enroll-guard.js`, replace lines 44-46:

```js
// before
const maxClasses = schedule.program_num_classes || 8;
if (!Number.isFinite(numClasses) || numClasses < 1) numClasses = maxClasses;
numClasses = Math.min(numClasses, maxClasses);
```

```js
// after
const maxClasses = Math.max(schedule.program_num_classes || 15, 15);
if (!Number.isFinite(numClasses) || numClasses < 10) numClasses = 15;
numClasses = Math.min(numClasses, maxClasses);
```

- [ ] **Step 4: Implement the same clamp in `guest-enroll.js`**

In `backend/functions/guest-enroll.js`, replace lines 50-52 with the identical two-line change shown in Step 3 (same variable names, same file shape).

- [ ] **Step 5: Run tests to verify everything passes**

Run: `node --test test/enroll-guard.test.mjs test/guest-enroll.test.mjs`
Expected: all tests PASS (including the two new ones per file and every pre-existing test).

- [ ] **Step 6: Commit**

```bash
git add backend/functions/enroll-guard.js backend/functions/guest-enroll.js test/enroll-guard.test.mjs test/guest-enroll.test.mjs
git commit -m "Floor single-schedule class count at 10, default 15, cap at max(program size, 15)"
```

---

### Task 2: Backend multi-day path - even split of an explicit class count (`enroll-guard.js`)

**Files:**
- Modify: `backend/functions/enroll-guard.js:224-250` (inside `handleMultiDay`)
- Test: `test/enroll-guard.test.mjs`

**Interfaces:**
- Consumes: `body.num_classes_enrolled` (new - previously ignored in multi-day mode), `schedules` array (already fetched and bundle-validated by existing code above this block, each row has `.id`, `.price_cents`, `.program_num_classes`, `.day_of_week`).
- Produces: same response shape as today (`{ enrollment_id, checkout_url, total_cents }`); `enrollments` rows now have varying `num_classes_enrolled` per row (previously always `1`) that sum to the requested total.

This task changes existing behavior that 3 pre-existing tests depend on. Update them in Step 1 alongside the new tests, per the exact expected values below (all pre-existing tests keep the same intent - only the numbers/shape of what's asserted change to match the new pricing model).

- [ ] **Step 1: Rewrite/add tests for the new split logic**

In `test/enroll-guard.test.mjs`, replace the existing test `"enroll-guard creates one enrollment row per selected day, all sharing one stripe_order_id"` (today at lines 190-237) with:

```js
test("enroll-guard splits an explicit num_classes_enrolled evenly across selected days, sharing one stripe_order_id", async () => {
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
      num_classes_enrolled: 12,
    }), ctx);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      enrollment_id: "enrollment-1",
      checkout_url: "https://stripe.test/checkout",
      total_cents: 36000, // 12 classes x 3000, no early-bird (12 < 15)
    });

    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts.length, 2);
    assert.match(inserts[0].sql, /'pending', \$6,/); // num_classes_enrolled is now a bound param, not a literal 1
    assert.equal(inserts[0].values[5], 6); // sched-1's share of 12 classes across 2 days
    assert.equal(inserts[0].values[6], 3000); // price_per_class_cents
    assert.equal(inserts[0].values[8], 18000); // this row's total_paid_cents share (6 x 3000)
    assert.equal(inserts[1].values[5], 6); // sched-2's share
    assert.equal(inserts[1].values[8], 18000);

    const updateOrder = queries.find((q) => /UPDATE enrollments SET stripe_order_id/.test(q.sql));
    assert.match(updateOrder.sql, /WHERE id = ANY\(\$2\)/);
    assert.deepEqual(updateOrder.values, ["order-1", ["enrollment-1", "enrollment-2"]]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("enroll-guard gives the remainder of an uneven split to the lowest-id schedule(s)", async () => {
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
      num_classes_enrolled: 11,
    }), ctx);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).total_cents, 33000); // 11 x 3000, no early-bird

    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts[0].values[5], 6); // sched-1 (lower id) absorbs the odd extra class
    assert.equal(inserts[1].values[5], 5); // sched-2
    assert.equal(inserts[0].values[8] + inserts[1].values[8], 33000); // row totals sum exactly, no lost/extra cent
  } finally {
    global.fetch = originalFetch;
  }
});

test("enroll-guard defaults multi-day num_classes_enrolled to 15 when absent", async () => {
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
    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts[0].values[5] + inserts[1].values[5], 15); // splits the 15-class default across both days
  } finally {
    global.fetch = originalFetch;
  }
});
```

Leave the other pre-existing multi-day tests (`"rejects schedule_ids that don't share one bundle signature"`, `"rejects the whole multi-day request when any selected day is full"`, `"(multi-day) rejects a student_id..."`, `"(multi-day) accepts and persists a verified student_id"`, `"accepts schedule_ids on different days that run at different times"`) exactly as they are - none of them assert specific class-count numbers, so they keep passing unmodified.

- [ ] **Step 2: Run tests to verify the new/rewritten ones fail**

Run: `node --test test/enroll-guard.test.mjs`
Expected: the 3 new/rewritten tests FAIL (today's code always inserts `num_classes_enrolled = 1` per row and ignores `body.num_classes_enrolled`, so `total_cents` and the per-row values won't match). Other tests still PASS.

- [ ] **Step 3: Implement the even split in `handleMultiDay`**

In `backend/functions/enroll-guard.js`, replace lines 224-250:

```js
// before
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
```

```js
// after
// 3. Pricing: an explicit class count (default 15, min 10, capped at the
//    program's configured size when larger), split evenly across the
//    selected day-parts - independent of how many days were selected.
schedules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const perClass = schedules[0].price_cents;
const maxClasses = Math.max(schedules[0].program_num_classes || 15, 15);
const minClasses = Math.max(10, schedules.length);
let numClasses = parseInt(body.num_classes_enrolled, 10);
if (!Number.isFinite(numClasses) || numClasses < minClasses) numClasses = Math.max(15, minClasses);
numClasses = Math.min(numClasses, maxClasses);

const n = schedules.length;
const base = Math.floor(numClasses / n);
const remainder = numClasses % n;
const classesForRow = (i) => base + (i < remainder ? 1 : 0); // lowest-id schedules absorb the remainder

const isEarlyBird = numClasses >= EARLY_BIRD_MIN_CLASSES && new Date() <= new Date(EARLY_BIRD_DEADLINE);
const ebPct = EARLY_BIRD_PCT;
const subtotal = perClass * numClasses;
const discountAmount = isEarlyBird ? Math.round((subtotal * ebPct) / 100) : 0;
const total = subtotal - discountAmount;
const perClassDiscounted = perClass - Math.round((perClass * (isEarlyBird ? ebPct : 0)) / 100);

// 4. One enrollments row per selected day, sized by its share of numClasses;
//    the last row absorbs any rounding remainder.
const enrollmentIds = [];
let runningTotal = 0;
for (let i = 0; i < n; i += 1) {
  const schedule = schedules[i];
  const rowClasses = classesForRow(i);
  const isLast = i === n - 1;
  const rowTotal = isLast ? total - runningTotal : perClassDiscounted * rowClasses;
  runningTotal += rowTotal;
  const enrollRes = await ctx.db.query(
    `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                              status, num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents,
                              parent_name, student_id)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [schedule.id, ctx.user.id, student_name || "", student_email || "", student_phone || "",
     rowClasses, perClass, isEarlyBird ? ebPct : 0, rowTotal, parent_name || "", studentId]
  );
  enrollmentIds.push(enrollRes.rows[0].id);
}
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `node --test test/enroll-guard.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/functions/enroll-guard.js test/enroll-guard.test.mjs
git commit -m "Split multi-day enroll-guard class count evenly across selected days"
```

---

### Task 3: Backend multi-day path - even split of an explicit class count (`guest-enroll.js`)

**Files:**
- Modify: `backend/functions/guest-enroll.js:245-305` (inside `handleMultiDay`)
- Test: `test/guest-enroll.test.mjs`

**Interfaces:**
- Consumes: `body.num_classes_enrolled`, `schedules` array - same as Task 2, mirrored in the guest file.
- Produces: same response shape as today; `enrollments` rows created under the guest account, same varying-count-per-row shape as Task 2 (minus `student_id`, which guests never have).

- [ ] **Step 1: Rewrite/add tests for the new split logic**

In `test/guest-enroll.test.mjs`, replace the existing test `"guest-enroll creates one enrollment row per selected day under one guest account, sharing one stripe_order_id"` (today at lines 90-137) with:

```js
test("guest-enroll splits an explicit num_classes_enrolled evenly across selected days under one guest account", async () => {
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
      num_classes_enrolled: 12,
    }), ctx);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      enrollment_id: "enrollment-1",
      checkout_url: "https://stripe.test/checkout",
      total_cents: 36000, // 12 classes x 3000, no early-bird (12 < 15)
    });

    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts.length, 2);
    assert.equal(inserts[0].values[1], "guest-user-1");
    assert.match(inserts[0].sql, /'pending', \$6,/); // num_classes_enrolled is now a bound param, not a literal 1
    assert.equal(inserts[0].values[5], 6);
    assert.equal(inserts[1].values[5], 6);

    const updateOrder = queries.find((q) => /UPDATE enrollments SET stripe_order_id/.test(q.sql));
    assert.deepEqual(updateOrder.values, ["order-1", ["enrollment-1", "enrollment-2"]]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("guest-enroll gives the remainder of an uneven split to the lowest-id schedule(s)", async () => {
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
      num_classes_enrolled: 11,
    }), ctx);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).total_cents, 33000);

    const inserts = queries.filter((q) => /INSERT INTO enrollments/.test(q.sql));
    assert.equal(inserts[0].values[5], 6);
    assert.equal(inserts[1].values[5], 5);
    assert.equal(inserts[0].values[8] + inserts[1].values[8], 33000);
  } finally {
    global.fetch = originalFetch;
  }
});
```

Leave `"guest-enroll persists parent_name onto the created enrollment"`, `"guest-enroll rejects schedule_ids that don't share one bundle signature"`, and `"guest-enroll accepts schedule_ids on different days that run at different times"` exactly as they are - unaffected by this change.

- [ ] **Step 2: Run tests to verify the new/rewritten ones fail**

Run: `node --test test/guest-enroll.test.mjs`
Expected: the 2 new/rewritten tests FAIL. Other tests still PASS.

- [ ] **Step 3: Implement the even split in `handleMultiDay`**

In `backend/functions/guest-enroll.js`, replace lines 245-305 (the pricing block through the insert loop) with the same logic shown in Task 2 Step 3, adapted for this file's insert shape (no `student_id`, uses `guestUser.id`):

```js
// after
schedules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const perClass = schedules[0].price_cents;
const maxClasses = Math.max(schedules[0].program_num_classes || 15, 15);
const minClasses = Math.max(10, schedules.length);
let numClasses = parseInt(body.num_classes_enrolled, 10);
if (!Number.isFinite(numClasses) || numClasses < minClasses) numClasses = Math.max(15, minClasses);
numClasses = Math.min(numClasses, maxClasses);

const n = schedules.length;
const base = Math.floor(numClasses / n);
const remainder = numClasses % n;
const classesForRow = (i) => base + (i < remainder ? 1 : 0);

const isEarlyBird = numClasses >= EARLY_BIRD_MIN_CLASSES && new Date() <= new Date(EARLY_BIRD_DEADLINE);
const ebPct = EARLY_BIRD_PCT;
const subtotal = perClass * numClasses;
const discountAmount = isEarlyBird ? Math.round((subtotal * ebPct) / 100) : 0;
const total = subtotal - discountAmount;
const perClassDiscounted = perClass - Math.round((perClass * (isEarlyBird ? ebPct : 0)) / 100);

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
let runningTotal = 0;
for (let i = 0; i < n; i += 1) {
  const schedule = schedules[i];
  const rowClasses = classesForRow(i);
  const isLast = i === n - 1;
  const rowTotal = isLast ? total - runningTotal : perClassDiscounted * rowClasses;
  runningTotal += rowTotal;
  const enrollRes = await ctx.db.query(
    `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                              status, num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents,
                              parent_name)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
     RETURNING id`,
    [schedule.id, guestUser.id, student_name, student_email, student_phone,
     rowClasses, perClass, isEarlyBird ? ebPct : 0, rowTotal, parent_name]
  );
  enrollmentIds.push(enrollRes.rows[0].id);
}
```

(This reproduces the unchanged provisional-account signup/login block verbatim so the replacement is a straightforward slice of the file - only the pricing math and the insert loop's `num_classes_enrolled`/`rowTotal` computation actually change from today's code.)

- [ ] **Step 4: Run tests to verify everything passes**

Run: `node --test test/guest-enroll.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/functions/guest-enroll.js test/guest-enroll.test.mjs
git commit -m "Split multi-day guest-enroll class count evenly across selected days"
```

---

### Task 4: Frontend state/logic - decouple class count from day selection

**Files:**
- Modify: `js/enroll.js:24` (state default)
- Modify: `js/enroll.js:40-43` (`getNumClasses`)
- Modify: `js/enroll.js:114` (`maxClasses` formula, add `minClasses`)
- Modify: `js/enroll.js:443` (init: program-load default)
- Modify: `js/enroll.js:380-383` (`handleEnroll` submission)
- Test: `test/enroll.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getNumClasses()` now always returns `state.numClasses` (Task 5's rendering code and the existing pricing-total math both call this, unchanged call sites); `minClasses`/`maxClasses` locals in `render()` are used by Task 5's stepper.

- [ ] **Step 1: Write failing tests**

Add to `test/enroll.test.mjs`:

```js
test("enroll.js defaults the class count to 15 and getNumClasses always returns it directly", async () => {
  const script = await readEnroll();
  assert.match(script, /numClasses: 15,/);
  assert.match(script, /function getNumClasses\(\) \{\s*return state\.numClasses;\s*\}/);
});

test("enroll.js caps the class count at max(program.num_classes, 15) with a minimum of 10", async () => {
  const script = await readEnroll();
  assert.match(script, /const maxClasses = program \? Math\.max\(program\.num_classes \|\| 15, 15\) : 15;/);
  assert.match(script, /const minClasses = 10;/);
});

test("enroll.js sends num_classes_enrolled in both single-schedule and multi-day submissions", async () => {
  const script = await readEnroll();
  const matches = script.match(/num_classes_enrolled: state\.numClasses/g) || [];
  assert.equal(matches.length, 1); // one shared expression covering both branches
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/enroll.test.mjs`
Expected: all 3 new tests FAIL (current source still has `numClasses: 8`, the old `getNumClasses` with the multi-day branch, `program.num_classes || 8`, and only one branch sending `num_classes_enrolled`).

- [ ] **Step 3: Update `state.numClasses` default**

In `js/enroll.js:24`, change:

```js
// before
  numClasses: 8,
```

```js
// after
  numClasses: 15,
```

- [ ] **Step 4: Simplify `getNumClasses()`**

In `js/enroll.js:40-43`, change:

```js
// before
function getNumClasses() {
  if (state.siblingSchedules.length > 1) return Math.max(1, state.selectedScheduleIds.size);
  return state.numClasses;
}
```

```js
// after
function getNumClasses() {
  return state.numClasses;
}
```

- [ ] **Step 5: Update the `maxClasses` formula and add `minClasses` in `render()`**

In `js/enroll.js:114`, change:

```js
// before
  const maxClasses = program ? program.num_classes || 8 : 8;
```

```js
// after
  const maxClasses = program ? Math.max(program.num_classes || 15, 15) : 15;
  const minClasses = 10;
```

- [ ] **Step 6: Update the program-load default in `init()`**

In `js/enroll.js:443`, change:

```js
// before
      state.numClasses = prog[0].num_classes || 8;
```

```js
// after
      state.numClasses = 15;
```

(The camp branch a few lines below, `state.numClasses = siblings.length || 1;`, is unchanged - camps stay fixed/non-adjustable.)

- [ ] **Step 7: Send `num_classes_enrolled` in every submission mode**

In `js/enroll.js:380-383`, change:

```js
// before
    const multiDay = state.siblingSchedules.length > 1;
    const scheduleParams = multiDay
      ? { schedule_ids: [...state.selectedScheduleIds] }
      : { schedule_id: scheduleId, num_classes_enrolled: state.numClasses };
```

```js
// after
    const multiDay = state.siblingSchedules.length > 1;
    const scheduleParams = {
      ...(multiDay ? { schedule_ids: [...state.selectedScheduleIds] } : { schedule_id: scheduleId }),
      num_classes_enrolled: state.numClasses,
    };
```

- [ ] **Step 8: Run tests to verify everything passes**

Run: `node --test test/enroll.test.mjs`
Expected: all tests PASS, including the 3 new ones and every pre-existing test in the file.

- [ ] **Step 9: Commit**

```bash
git add js/enroll.js test/enroll.test.mjs
git commit -m "Decouple enroll.js class count from Class Time day selection"
```

---

### Task 5: Frontend rendering - relabel Class Time, restructure the pricing section

**Files:**
- Modify: `js/enroll.js:140-144` (single-match detail row label)
- Modify: `js/enroll.js:172-218` (pricing section: Class Time row + Number of Classes row)
- Test: `test/enroll.test.mjs`

**Interfaces:**
- Consumes: `minClasses`, `maxClasses` from Task 4's `render()` changes; `getNumClasses()` from Task 4.
- Produces: no new exports - this is the leaf rendering change; nothing downstream depends on it beyond the DOM it produces.

- [ ] **Step 1: Write failing tests**

Add to `test/enroll.test.mjs`:

```js
test("enroll.js relabels the single-match Time detail row to Class Time", async () => {
  const script = await readEnroll();
  assert.match(script, /rowTime\.appendChild\(el\("span", "detail-label", "Class Time"\)\)/);
  assert.doesNotMatch(script, /el\("span", "detail-label", "Time"\)/);
});

test("enroll.js shows Class Time day checkboxes in their own pricing row, separate from Number of Classes", async () => {
  const script = await readEnroll();
  assert.match(script, /el\("label", "", "Class Time"\)/);
  assert.match(script, /el\("label", "", "Number of Classes"\)/);
});

test("enroll.js shows the Number of Classes stepper for both single-schedule and multi-day non-camp modes", async () => {
  const script = await readEnroll();
  assert.match(script, /state\.numClasses <= minClasses \|\| isFull/);
  assert.match(script, /state\.numClasses >= maxClasses \|\| isFull/);
  assert.doesNotMatch(script, /state\.numClasses <= 1 \|\| isFull/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/enroll.test.mjs`
Expected: the 3 new tests FAIL (current source still labels the detail row "Time", has one combined "Number of classes" label, and gates the stepper on `<= 1`).

- [ ] **Step 3: Relabel the single-match detail row**

In `js/enroll.js:139-144`, change:

```js
// before
    if (state.siblingSchedules.length <= 1) {
      const rowTime = el("div", "detail-row");
      rowTime.appendChild(el("span", "detail-label", "Time"));
      rowTime.appendChild(el("span", "", `${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}`));
      details.appendChild(rowTime);
    }
```

```js
// after
    if (state.siblingSchedules.length <= 1) {
      const rowTime = el("div", "detail-row");
      rowTime.appendChild(el("span", "detail-label", "Class Time"));
      rowTime.appendChild(el("span", "", `${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}`));
      details.appendChild(rowTime);
    }
```

- [ ] **Step 4: Restructure the pricing section**

In `js/enroll.js:172-218`, replace the whole block:

```js
// before
  // Number-of-classes stepper (camps: fixed to the bundle size, not adjustable)
  const rowClasses = el("div", "pricing-row");
  const lbl = el("label", "", "Number of classes");
  lbl.setAttribute("for", "num-classes");
  rowClasses.appendChild(lbl);

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
      lbl.appendChild(document.createTextNode(` ${formatDayLabel(sib)}`));
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
  pricing.appendChild(rowClasses);
```

```js
// after
  if (state.isCamp) {
    // Camp: fixed to the bundle size, not adjustable.
    const rowClasses = el("div", "pricing-row");
    const lbl = el("label", "", "Number of classes");
    lbl.setAttribute("for", "num-classes");
    rowClasses.appendChild(lbl);
    rowClasses.appendChild(el("span", "num-classes-value",
      `${state.numClasses} (${state.campDays.join(", ")} - included, not adjustable)`));
    pricing.appendChild(rowClasses);
  } else {
    // Class Time: which weekly day/time slot(s) this enrollment attends.
    // Only rendered here when 2+ day-parts matched - the single-match case
    // is already shown by the "Class Time" detail row above.
    if (state.siblingSchedules.length > 1) {
      const rowClassTime = el("div", "pricing-row");
      rowClassTime.appendChild(el("label", "", "Class Time"));
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
        lbl.appendChild(document.createTextNode(` ${formatDayLabel(sib)}`));
        dayCheckboxes.appendChild(lbl);
      });
      rowClassTime.appendChild(dayCheckboxes);
      pricing.appendChild(rowClassTime);
    }

    // Number of Classes: total sessions purchased, independent of which
    // Class Time day-part(s) are selected above.
    const rowClasses = el("div", "pricing-row");
    const lbl = el("label", "", "Number of Classes");
    lbl.setAttribute("for", "num-classes");
    rowClasses.appendChild(lbl);

    const ctrl = el("div", "num-classes-control");
    const minusBtn = el("button", "", "−");
    minusBtn.type = "button";
    minusBtn.disabled = state.numClasses <= minClasses || isFull;
    minusBtn.onclick = () => { state.numClasses = Math.max(minClasses, state.numClasses - 1); render(); };
    ctrl.appendChild(minusBtn);

    ctrl.appendChild(el("span", "num-classes-value", String(state.numClasses)));

    const plusBtn = el("button", "", "+");
    plusBtn.type = "button";
    plusBtn.disabled = state.numClasses >= maxClasses || isFull;
    plusBtn.onclick = () => { state.numClasses = Math.min(maxClasses, state.numClasses + 1); render(); };
    ctrl.appendChild(plusBtn);

    ctrl.appendChild(el("span", "muted num-classes-max", `of ${maxClasses}`));
    rowClasses.appendChild(ctrl);
    pricing.appendChild(rowClasses);
  }
```

- [ ] **Step 5: Run tests to verify everything passes**

Run: `node --test test/enroll.test.mjs`
Expected: all tests PASS, including every pre-existing test in the file (in particular the camp-locking test and the `cb.disabled = cb.checked && state.selectedScheduleIds.size === 1` test, both of which reference code that moved but did not change).

- [ ] **Step 6: Commit**

```bash
git add js/enroll.js test/enroll.test.mjs
git commit -m "Relabel Class Time and split it from the Number of Classes stepper in enroll.js"
```

---

### Task 6: Manual E2E verification in a real browser

**Files:** none (verification only, per project standard: reproduce/verify UI changes in a real browser, not just via unit tests).

- [ ] **Step 1: Run the full test suite once, end to end**

Run: `node --test test/*.test.mjs`
Expected: all tests PASS, 0 failures.

- [ ] **Step 2: Start the local static server**

Run: `python3 -m http.server 8000` (matches `.claude/launch.json`'s `olivistart-site` config)

- [ ] **Step 3: Manually verify a single-schedule (no siblings) enrollment**

In a browser, open `http://localhost:8000/schedule.html`, click into a regular (non-camp) class with no sibling days, land on `enroll.html?schedule=...`. Confirm:
- The detail row above pricing reads "Class Time" (not "Time") and shows the one day/time slot.
- The pricing section shows only one row: "Number of Classes", stepper starting at 15, minus button disabled only once it reaches 10, plus button disabled once it reaches `max(program.num_classes, 15)`.
- No duplicate day/time display appears in the pricing section.
- Changing the count updates Subtotal/Total correctly; hitting 15+ shows the early-bird discount line.

- [ ] **Step 4: Manually verify a multi-day (2+ siblings) enrollment**

Open a class that has Mon/Wed (or similar) sibling schedules. Confirm:
- The pricing section shows a "Class Time" row with day checkboxes (both checked by default), and a separate "Number of Classes" row below it defaulting to 15.
- Unchecking one day updates the "Day" detail row above but does NOT change the "Number of Classes" value or the price.
- Changing "Number of Classes" (e.g. to 12) updates Subtotal/Total based on 12 total sessions, regardless of how many days are checked.
- Complete a Stripe test-mode checkout; confirm on `registration.html` the enrollment reads correctly, and on `account.html` the grouped card shows both days.

- [ ] **Step 5: Manually verify camp enrollment is unaffected**

Open a camp program's enroll page. Confirm the "Number of classes" row still shows the fixed, non-adjustable bundle size and day list exactly as before - no "Class Time" relabeling, no new stepper.

- [ ] **Step 6: Report results**

If any manual check fails, note the exact discrepancy (task/step this plan implies is responsible) before moving on - do not mark this task done with a known visual or behavioral defect outstanding.
