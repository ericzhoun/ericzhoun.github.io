# Consolidate Programs Into Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `index.html` the only Programs destination by integrating the complete Programs content in the revised order, migrating active links, and deleting `programs.html`.

**Architecture:** Keep the static multi-page site and existing program CSS classes. Replace the homepage teaser with the Programs introduction and age guide, move the existing philosophy and call-to-action sections ahead of the four detailed program sections, then repoint shared navigation to `index.html#programs`. Add source-level tests for section order, content preservation, link migration, anchor behavior, and standalone page removal.

**Tech Stack:** Static HTML5, CSS, JavaScript, Node.js built-in test runner

## Global Constraints

- Preserve all current Programs content, including the uncommitted Visual Discovery image change.
- Homepage order is hero; combined Programs introduction and age guide; philosophy teaser; call-to-action banner; Visual Discovery; Young Photographer Camp; Creative Foundations; Portfolio Studio; footer.
- Keep Home as the only active navigation item on `index.html`.
- Delete `programs.html` with no redirect.
- Historical design and plan documents may continue to reference `programs.html`.
- Do not modify generated changelog files.

---

### Task 1: Build the complete homepage Programs flow

**Files:**
- Modify: `test/web-design-guidelines.test.mjs`
- Modify: `index.html`
- Modify: `css/style.css`

**Interfaces:**
- Consumes: Existing `.programs-intro`, `.age-mapping*`, `.philosophy-teaser`, `.cta-banner`, `.program-section`, `.program-grid`, and program-specific CSS classes.
- Produces: Homepage anchors `#programs`, `#visual-discovery`, `#young-photographer`, `#creative-foundations`, and `#portfolio-studio`; ordered content consumed by navigation links in Task 2.

- [x] **Step 1: Add a failing homepage consolidation test**

Add this test to `test/web-design-guidelines.test.mjs`:

```js
test("homepage presents the complete Programs flow in the revised order", async () => {
  const index = await read("index.html");
  const orderedMarkers = [
    'id="programs"',
    'class="container age-mapping"',
    'class="container philosophy-teaser"',
    'class="cta-banner"',
    'id="visual-discovery"',
    'id="young-photographer"',
    'id="creative-foundations"',
    'id="portfolio-studio"',
  ];

  let previousPosition = -1;
  for (const marker of orderedMarkers) {
    const position = index.indexOf(marker);
    assert.ok(position > previousPosition, `${marker} should appear in the revised homepage order`);
    previousPosition = position;
  }

  assert.match(index, /assets\/art-class\/artPortfolio1\.jpg/);
  assert.match(index, /<h2>Young Photographer Camp<\/h2>/);
  assert.doesNotMatch(index, /class="teaser-grid"/);
});

test("homepage anchors clear the sticky navigation", async () => {
  const css = await read("css/style.css");
  assert.match(css, /#programs,\s*\.program-section\s*\{[^}]*scroll-margin-top:\s*88px/s);
});
```

- [x] **Step 2: Run the new test and confirm it fails**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: FAIL because `index.html` does not contain `id="programs"` or the detailed program sections and the anchor offset rule does not exist.

- [x] **Step 3: Replace the condensed homepage teaser with the approved content order**

In `index.html`, keep the hero unchanged. Replace `<section class="container programs-teaser">` through the existing closing call-to-action banner with:

First copy the current `programs.html` section beginning `<section class="container age-mapping">` and ending at its matching `</section>` immediately after the Programs introduction below. Then copy the four current sections beginning with `<section id="visual-discovery"` and ending with the matching `</section>` for `portfolio-studio` immediately after the call-to-action below. These are relocations of the exact existing HTML, including every row, list item, image attribute, class, and local anchor.

```html
<section id="programs" class="container programs-intro">
  <h1>Our Programs</h1>
  <p>Three age-based tracks, each capped at 6 students, designed
    to grow with your child's artistic development.</p>
</section>

<section class="container philosophy-teaser">
  <blockquote>“Art is more than learning how to draw.”</blockquote>
  <p>At OliVista, students build observation skills, creative
    thinking, and confidence in their own ideas - guided by Ms.
    Olivia, who has practiced and taught art for years.</p>
  <a class="btn" href="about.html">Meet the Instructor</a>
</section>
<section class="cta-banner">
  <div class="container">
    <h2>Ready to get started?</h2>
    <p>Reach out to learn more or ask about enrolling your child.</p>
    <a class="btn" href="schedule.html">View Schedule</a>
  </div>
</section>
```

The copied age mapping must retain all four rows and local links: `#visual-discovery`, `#young-photographer`, `#creative-foundations`, and `#portfolio-studio`. The copied detailed sections must preserve `assets/art-class/artPortfolio1.jpg` for Visual Discovery.

- [x] **Step 4: Add a sticky-header offset for every homepage Programs anchor**

Add near the Programs styles in `css/style.css`:

```css
#programs,
.program-section {
  scroll-margin-top: 88px;
}
```

- [x] **Step 5: Run the homepage tests and confirm they pass**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: PASS for the revised-order, content-preservation, and sticky-navigation tests. Existing tests must also pass at this stage.

- [x] **Step 6: Commit the homepage consolidation**

```bash
git add index.html css/style.css test/web-design-guidelines.test.mjs
git commit -m "feat: add full programs content to homepage"
```

---

### Task 2: Migrate Programs links and remove the standalone page

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
- Delete: `programs.html`

**Interfaces:**
- Consumes: The `index.html#programs` anchor produced by Task 1.
- Produces: A single Programs destination used by all public page navigation; no standalone `programs.html` dependency.

- [x] **Step 1: Add failing link-migration and page-removal tests**

Update the public page array in the skip-link test to remove `programs.html`, change the Programs semantics check to read `index.html`, and add:

```js
test("public navigation targets the homepage Programs section", async () => {
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
    assert.match(html, /href="index\.html#programs">Programs<\/a>/, `${page} should link to homepage Programs`);
    assert.doesNotMatch(html, /href="programs\.html(?:#[^"]*)?"/);
  }
});

test("standalone Programs page has been removed", async () => {
  await assert.rejects(read("programs.html"), { code: "ENOENT" });
});
```

In the existing semantics test, use:

```js
const [about, contact, portfolio, index, qr] = await Promise.all([
  read("about.html"),
  read("contact.html"),
  read("portfolio.html"),
  read("index.html"),
  read("qr-code.html"),
]);
```

and change `assert.doesNotMatch(programs, ...)` to `assert.doesNotMatch(index, ...)`.

- [x] **Step 2: Run the link tests and confirm they fail**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: FAIL because active pages still link to `programs.html` and the standalone file still exists.

- [x] **Step 3: Repoint all active Programs navigation links**

In every HTML file listed above, replace:

```html
href="programs.html">Programs
```

with:

```html
href="index.html#programs">Programs
```

On `index.html`, also ensure any program-specific links are local fragment links, for example `href="#visual-discovery"`. Do not add `is-active` to the Programs link; Home remains active.

- [x] **Step 4: Delete the standalone Programs page**

Delete `programs.html` only after confirming its revised content is present in `index.html`.

- [x] **Step 5: Run source checks and all automated tests**

Run:

```bash
rg -n 'href="programs\.html' --glob '*.html' .
node --test test/*.test.mjs
```

Expected: `rg` returns no matches. All Node.js tests PASS.

- [x] **Step 6: Commit the navigation migration and removal**

```bash
git add index.html about.html account.html checkout-success.html contact.html enroll.html login.html portfolio.html registration.html schedule.html signup.html programs.html test/web-design-guidelines.test.mjs
git commit -m "refactor: make homepage the programs destination"
```

---

### Task 3: Verify the consolidated page end to end

**Files:**
- Verify: `index.html`
- Verify: `css/style.css`
- Verify: all public navigation pages listed in Task 2

**Interfaces:**
- Consumes: The completed homepage and migrated links from Tasks 1 and 2.
- Produces: Verified desktop and mobile behavior with no additional interface.

- [x] **Step 1: Start a local static server**

Run: `python3 -m http.server 8000`

Expected: The site is available at `http://localhost:8000/index.html`.

- [x] **Step 2: Inspect the desktop homepage**

At a desktop viewport, verify the hero is unchanged and the following appear once in this order: Programs introduction and age guide, philosophy teaser, dark call-to-action banner, Visual Discovery, Young Photographer Camp, Creative Foundations, Portfolio Studio. Verify images have correct aspect ratios, two-column program layouts align cleanly, and no spacing or background transition looks accidental.

- [x] **Step 3: Verify anchors and cross-page navigation**

Open `http://localhost:8000/about.html`, activate Programs, and confirm the browser lands at `index.html#programs` with the heading visible below the sticky header. On the homepage, activate every age-guide row and confirm the matching program heading remains visible below the sticky header.

- [x] **Step 4: Inspect the mobile homepage**

At a 390-pixel viewport, verify the navigation menu works, age rows render as cards without clipping, program images and text stack cleanly, all content stays within the viewport, and no horizontal scrolling occurs.

- [x] **Step 5: Run the final verification suite**

Run:

```bash
git diff --check HEAD^..HEAD
node --test test/*.test.mjs
rg -n 'href="programs\.html' --glob '*.html' .
```

Expected: No whitespace errors, all tests PASS, and no active HTML links reference `programs.html`.
