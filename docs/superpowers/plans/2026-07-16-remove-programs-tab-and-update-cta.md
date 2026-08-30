# Remove Programs Tab and Update CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Programs tab from every public header and update the homepage enrollment call-to-action with the revised July copy.

**Architecture:** Keep the existing static header markup and remove the Programs anchor directly from each page rather than hiding it with CSS. Preserve the homepage `#programs` section and program anchors. Extend the source-level navigation test to inspect each header and add an exact-copy assertion for the revised call-to-action.

**Tech Stack:** Static HTML5, CSS, JavaScript, Node.js built-in test runner

## Global Constraints

- Remove the Programs tab from the header navigation on every page.
- Do not hide the Programs tab with CSS or retain inaccessible Programs link markup.
- Keep the homepage `#programs` section and all local program anchors.
- Change the call-to-action paragraph to `Book now for limited spots available in July`.
- Change the call-to-action button label to `Summer Class Schedule` and retain its `schedule.html` destination.
- Preserve the user-owned `.DS_Store` changes.

---

### Task 1: Remove the Programs tab from every header

**Files:**
- Modify: `test/web-design-guidelines.test.mjs`
- Modify: `index.html`
- Modify: `about.html`
- Modify: `account.html`
- Modify: `checkout-success.html`
- Modify: `contact.html`
- Modify: `enroll.html`
- Modify: `login.html`
- Modify: `portfolio.html`
- Modify: `registration.html`
- Modify: `schedule.html`
- Modify: `signup.html`

**Interfaces:**
- Consumes: Existing `.site-nav` markup in each public HTML page.
- Produces: Headers with Home followed directly by Portfolio, while leaving `#programs` available in `index.html`.

- [x] **Step 1: Replace the navigation destination test with a failing tab-removal test**

Replace `test("public navigation targets the homepage Programs section", ...)` in `test/web-design-guidelines.test.mjs` with:

```js
test("public headers omit the Programs tab", async () => {
  const pages = [
    "index.html",
    "about.html",
    "account.html",
    "checkout-success.html",
    "contact.html",
    "enroll.html",
    "login.html",
    "portfolio.html",
    "registration.html",
    "schedule.html",
    "signup.html",
  ];

  for (const page of pages) {
    const html = await read(page);
    const navigation = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0];
    assert.ok(navigation, `${page} should contain the site navigation`);
    assert.doesNotMatch(navigation, />Programs<\/a>/);
    assert.doesNotMatch(navigation, /index\.html#programs/);
  }

  assert.match(await read("index.html"), /<section id="programs" class="programs-overview">/);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: FAIL because the current headers contain `<a href="index.html#programs">Programs</a>`.

- [x] **Step 3: Remove the Programs anchor markup from every listed HTML header**

Delete this anchor from each `.site-nav`, preserving the surrounding Home and Portfolio links:

```html
<a href="index.html#programs">Programs</a>
```

Do not alter `id="programs"`, `.programs-overview`, the age mapping links, or any detailed program section IDs in `index.html`.

- [x] **Step 4: Run the focused test and confirm it passes**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: All navigation and existing webpage tests PASS.

- [x] **Step 5: Commit the header change**

```bash
git add index.html about.html account.html checkout-success.html contact.html enroll.html login.html portfolio.html registration.html schedule.html signup.html test/web-design-guidelines.test.mjs
git commit -m "refactor: remove programs tab from headers"
```

---

### Task 2: Apply the revised July call-to-action copy

**Files:**
- Modify: `test/web-design-guidelines.test.mjs`
- Modify: `index.html`

**Interfaces:**
- Consumes: The existing `.cta-banner` section and `schedule.html` destination.
- Produces: Exact revised paragraph and button copy without changing navigation behavior.

- [x] **Step 1: Add a failing exact-copy test**

Add this test to `test/web-design-guidelines.test.mjs`:

```js
test("homepage promotes the July summer schedule", async () => {
  const index = await read("index.html");
  assert.match(index, /<p>Book now for limited spots available in July<\/p>/);
  assert.match(index, /<a class="btn" href="schedule\.html">Summer Class Schedule<\/a>/);
  assert.doesNotMatch(index, /Reach out to learn more or ask about enrolling your child\./);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: FAIL because the current call-to-action uses the previous paragraph and button label.

- [x] **Step 3: Replace the call-to-action copy in `index.html`**

Change only the paragraph and link text within `.cta-banner` to:

```html
<p>Book now for limited spots available in July</p>
<a class="btn" href="schedule.html">Summer Class Schedule</a>
```

- [x] **Step 4: Run all automated tests**

Run: `node --test test/*.test.mjs`

Expected: All tests PASS with zero failures.

- [x] **Step 5: Commit the CTA revision and the user-revised spec**

```bash
git add index.html test/web-design-guidelines.test.mjs docs/superpowers/specs/2026-07-16-consolidate-programs-into-homepage-design.md
git commit -m "feat: promote July summer schedule"
```

---

### Task 3: Verify desktop and mobile headers

**Files:**
- Verify: `index.html`
- Verify: all public HTML headers listed in Task 1

**Interfaces:**
- Consumes: Completed header and call-to-action changes.
- Produces: Verified responsive layout with no additional interface.

- [x] **Step 1: Start a local static server**

Run: `python3 -m http.server 8000`

Expected: The site is available at `http://localhost:8000/index.html`.

- [x] **Step 2: Inspect the desktop homepage**

Verify the header contains Home, Portfolio, Schedule, About, Contact, and Account with balanced spacing and no Programs tab. Confirm the homepage Programs content remains present and the call-to-action reads `Book now for limited spots available in July` with a `Summer Class Schedule` button.

- [x] **Step 3: Inspect the mobile homepage**

At a 390-pixel viewport, open the menu and verify it contains the same six links, fits without clipping or horizontal overflow, and has no blank row where Programs was removed.

- [x] **Step 4: Run final source checks**

Run:

```bash
node --test test/*.test.mjs
rg -n 'index\.html#programs|>Programs</a>' --glob '*.html' .
git diff --check main...HEAD
```

Expected: All tests PASS, the search returns no header Programs link, and the diff has no whitespace errors.
