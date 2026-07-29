# Art-Class Carousel Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible, visual-only, auto-rotating art-class image carousel between the programs overview and the second philosophy teaser on the homepage.

**Architecture:** Add a semantic carousel section to `index.html`, a focused stylesheet block in `css/style.css`, and a small `js/art-class-carousel.js` controller. The controller rotates a pre-rendered image stack, pauses on hover/focus, and disables automatic motion when reduced motion is requested.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, existing Node test suite, browser verification.

## Global Constraints

- Use the 11 WebP images in `assets/art-class`.
- Keep the carousel visual-only with no captions, dots, arrows, or other visible controls.
- Use a 5-second crossfade rotation.
- Preserve accessibility and respect `prefers-reduced-motion`.
- Do not modify existing `.DS_Store` changes.

---

### Task 1: Add carousel markup and image data

**Files:**
- Modify: `index.html` between the closing `programs-overview` section and the second `philosophy-teaser` section

**Interfaces:**
- Produces: `.art-class-carousel`, `.art-class-carousel-track`, and `.art-class-carousel-slide` hooks consumed by CSS and JavaScript.

- [ ] **Step 1: Insert the semantic carousel section**

Add a `section` with `aria-label="Student artwork"`, a visually hidden heading, and 11 WebP images. Mark the first image active, give every image concise descriptive alt text, and include intrinsic dimensions.

- [ ] **Step 2: Verify the section order**

Confirm the markup order is `programs-overview` closing tag, carousel section, then the second `philosophy-teaser` section.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add art class carousel markup"
```

### Task 2: Style the responsive banner

**Files:**
- Modify: `css/style.css` near the existing homepage teaser/banner styles

**Interfaces:**
- Consumes: `.art-class-carousel` markup from Task 1.
- Produces: responsive full-width banner styling and crossfade classes for Task 3.

- [ ] **Step 1: Add desktop carousel layout styles**

Create a centered section with a 16:7 aspect ratio, hidden overflow, the existing site radius, and a neutral dark background. Position slides absolutely and use opacity transitions for crossfades.

- [ ] **Step 2: Add mobile styles and motion fallback**

At narrow widths, change the aspect ratio to 4:3 and reduce surrounding spacing. Add a `prefers-reduced-motion: reduce` rule that removes opacity transitions.

- [ ] **Step 3: Commit**

```bash
git add css/style.css
git commit -m "feat: style art class carousel banner"
```

### Task 3: Implement rotation and interaction behavior

**Files:**
- Create: `js/art-class-carousel.js`
- Modify: `index.html` before the closing `body` tag

**Interfaces:**
- Consumes: `.art-class-carousel` and `.art-class-carousel-slide` hooks from Task 1.
- Produces: automatic 5-second rotation, pause-on-hover/focus, and reduced-motion behavior.

- [ ] **Step 1: Add the controller**

On `DOMContentLoaded`, query the carousel and slides. If fewer than two slides exist, return. Track the active index, toggle `.is-active`, and use `setInterval(nextSlide, 5000)` only when `matchMedia('(prefers-reduced-motion: reduce)').matches` is false.

- [ ] **Step 2: Pause and resume on interaction**

Listen for `mouseenter`, `mouseleave`, `focusin`, and `focusout`. Clear the interval while hovered or focused, and restart it only after both states are inactive. The script should remain safe when the carousel is absent from other pages.

- [ ] **Step 3: Load the script**

Add `<script src="js/art-class-carousel.js"></script>` after the existing navigation script in `index.html`.

- [ ] **Step 4: Commit**

```bash
git add index.html js/art-class-carousel.js
git commit -m "feat: rotate art class carousel images"
```

### Task 4: Verify the finished carousel

**Files:**
- Test: `test/web-design-guidelines.test.mjs`
- Verify: `index.html`, `css/style.css`, `js/art-class-carousel.js`

- [ ] **Step 1: Run the existing test suite**

Run: `npm test`

Expected: all tests pass with no new warnings.

- [ ] **Step 2: Run the homepage in a browser**

Open the local homepage, verify the carousel is between the requested sections, confirm the image changes after 5 seconds, and confirm hover/focus pauses it.

- [ ] **Step 3: Check responsive and accessibility behavior**

Inspect desktop and mobile layouts, confirm images cover the banner without overflow, confirm the section has an accessible label, and verify reduced-motion disables automatic rotation.

- [ ] **Step 4: Check console output**

Reload the homepage and confirm there are no console errors or failed local image requests.
