# Web Design Guidelines Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the public-site design audit findings while preserving the current visual identity and enrollment flow.

**Architecture:** Shared CSS supplies keyboard, touch, motion, and skip-link behavior. Page-level markup receives semantic form, image, and navigation improvements. The schedule loader gains a recoverable error state in its existing script.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, Node.js built-in test runner.

## Global Constraints

- Preserve the existing public visual language and enrollment/payment behavior.
- Use native semantic elements and accessible labels before adding ARIA.
- Do not edit generated files or `CHANGELOG.md`.
- Do not use em dashes in user-facing copy.

---

### Task 1: Establish regression checks

**Files:**
- Create: `test/web-design-guidelines.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing static checks**

Create tests that read the public HTML/CSS and assert `skip-link`, `:focus-visible`, `prefers-reduced-motion`, no `transition: all`, `aria-live="polite"`, and auth input `name`/`autocomplete` attributes.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: FAIL because the accessibility contracts do not yet exist.

- [ ] **Step 3: Add a test script**

Add `"test": "node --test"` to `package.json` if no equivalent script exists.

- [ ] **Step 4: Re-run the targeted test**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: Still FAIL only on missing production behavior.

### Task 2: Add shared interaction accessibility

**Files:**
- Modify: `css/style.css`
- Modify: `index.html`, `programs.html`, `schedule.html`, `about.html`, `contact.html`, `portfolio.html`, `login.html`, `signup.html`, `account.html`, `enroll.html`, `registration.html`, `checkout-success.html`

- [ ] **Step 1: Write a failing check for each public page**

Assert every public page has `<a class="skip-link" href="#main-content">Skip to main content</a>` and `<main id="main-content">`.

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: FAIL on missing skip links and CSS interaction rules.

- [ ] **Step 3: Implement shared accessibility styles and markup**

Add the skip link to each page, target the existing main region, add global `:focus-visible` styles, `touch-action: manipulation`, and a `prefers-reduced-motion: reduce` override. Replace the semester-tab transition with explicit properties and replace registration `:focus` outline removal with `:focus-visible` treatment.

- [ ] **Step 4: Run the static test**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: PASS for shared interaction checks.

### Task 3: Improve auth semantics and asynchronous feedback

**Files:**
- Modify: `login.html`, `signup.html`
- Test: `test/web-design-guidelines.test.mjs`

- [ ] **Step 1: Write failing auth-form assertions**

Assert full-name, email, password, and verification-code fields have meaningful `name` and `autocomplete` values; email fields set `spellcheck="false"`; `#auth-error` and `#auth-info` are polite live regions.

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: FAIL on current missing attributes.

- [ ] **Step 3: Implement minimal auth markup changes**

Use `name="name" autocomplete="name"`, `name="email" autocomplete="email" spellcheck="false"`, `name="password" autocomplete="current-password"`, and `name="code" autocomplete="one-time-code"`; use `autocomplete="new-password"` only if a signup password field is introduced. Add `aria-live="polite"` to the existing status paragraphs.

- [ ] **Step 4: Run the static test**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: PASS for auth semantics.

### Task 4: Make schedule loading recoverable

**Files:**
- Modify: `js/schedule.js`, `schedule.html`
- Create: `test/schedule.test.mjs`

- [ ] **Step 1: Write a failing schedule failure-state test**

Extract or export a pure renderer that maps a load failure to text, a retry-button label, and a retry callback contract. Test that it produces `Unable to load the schedule. Please try again.` and `Try again`.

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test test/schedule.test.mjs`

Expected: FAIL because the error renderer does not exist.

- [ ] **Step 3: Implement the minimal failure renderer and retry wiring**

On a rejected API call, replace the loading region with a concise error paragraph and a native button that invokes the existing schedule load function. Mark the dynamic calendar region `aria-live="polite"`.

- [ ] **Step 4: Run schedule tests**

Run: `node --test test/schedule.test.mjs`

Expected: PASS.

### Task 5: Correct content semantics and image stability

**Files:**
- Modify: `about.html`, `portfolio.html`, `programs.html`, `contact.html`, `qr-code.html`
- Test: `test/web-design-guidelines.test.mjs`

- [ ] **Step 1: Write failing static assertions**

Assert portfolio thumbnail buttons have descriptive labels, the instructor image is not inside a heading, and QR images include dimensions.

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: FAIL on existing markup.

- [ ] **Step 3: Implement semantic and image updates**

Move the instructor image into a paragraph or figure, replace invalid breaks, label each portfolio button with its program and artwork position, add intrinsic QR dimensions from the source assets, and replace generic program alt text with specific descriptions.

- [ ] **Step 4: Run static tests**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: PASS.

### Task 6: Verify the complete user experience

**Files:**
- Test: `test/web-design-guidelines.test.mjs`, `test/schedule.test.mjs`

- [ ] **Step 1: Run all automated checks**

Run: `npm test`

Expected: PASS with no warnings.

- [ ] **Step 2: Perform browser checks**

Verify the homepage and schedule at desktop and mobile widths: no horizontal overflow, visible keyboard focus, usable mobile navigation, and accessible schedule fallback.

- [ ] **Step 3: Commit only the remediation files**

Run: `git add css/style.css *.html js/schedule.js test package.json docs/superpowers/plans/2026-07-16-web-design-guidelines-remediation.md && git commit -m "fix: remediate web design guideline issues"`

