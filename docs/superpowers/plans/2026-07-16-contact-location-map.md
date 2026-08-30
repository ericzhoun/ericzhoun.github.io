# Contact Location Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible, responsive Google Maps location section to the Contact page for 586 Military Way, Palo Alto, CA.

**Architecture:** Keep the Contact page static. Add a location section between the introductory copy and the existing contact grid, styled by focused rules in the shared stylesheet. Use Google Maps' query embed URL and a visible destination link, avoiding any API key or client-side script.

**Tech Stack:** HTML5, CSS, Node.js built-in test runner.

## Global Constraints

- Preserve the current Email and WeChat contact blocks and QR code dimensions.
- Use the exact address: `586 Military Way, Palo Alto, CA`.
- Include a lazy-loaded Google Maps iframe with a descriptive title and `referrerpolicy="no-referrer-when-downgrade"`.
- The address link opens Google Maps in a new tab using `target="_blank"` and `rel="noopener noreferrer"`.
- Do not require a Google Maps API key or introduce JavaScript.

---

### Task 1: Cover the location section with static tests

**Files:**
- Modify: `test/web-design-guidelines.test.mjs`

**Interfaces:**
- Consumes: the rendered HTML in `contact.html` and CSS in `css/style.css`.
- Produces: regression coverage for the location address, Maps embed, accessible fallback link, and responsive map styling.

- [ ] **Step 1: Write the failing test**

Add this test after `content images and controls have stable, meaningful semantics`:

```js
test("contact page provides an accessible, responsive studio location map", async () => {
  const [contact, css] = await Promise.all([read("contact.html"), read("css/style.css")]);

  assert.match(contact, /<section class="contact-location"/);
  assert.match(contact, />586 Military Way, Palo Alto, CA<\/a>/);
  assert.match(contact, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=586%20Military%20Way%2C%20Palo%20Alto%2C%20CA"/);
  assert.match(contact, /target="_blank" rel="noopener noreferrer"/);
  assert.match(contact, /<iframe[^>]*title="Map of OliVista Art Studio at 586 Military Way, Palo Alto, CA"[^>]*loading="lazy"[^>]*referrerpolicy="no-referrer-when-downgrade"/);
  assert.match(contact, /src="https:\/\/www\.google\.com\/maps\?q=586%20Military%20Way%2C%20Palo%20Alto%2C%20CA&amp;output=embed"/);
  assert.match(css, /\.contact-map\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-height:\s*360px/);
  assert.match(css, /@media \(max-width: 600px\)\s*\{[\s\S]*?\.contact-map\s*\{[\s\S]*?min-height:\s*280px/s);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: FAIL because `contact-location` and `contact-map` do not exist yet.

### Task 2: Add the map markup and responsive presentation

**Files:**
- Modify: `contact.html:35`
- Modify: `css/style.css:804`

**Interfaces:**
- Consumes: the existing `.contact-section`, `.contact-grid`, and shared CSS variables.
- Produces: a standalone `.contact-location` section and `.contact-map` frame before the existing contact grid.

- [ ] **Step 1: Insert the location section in `contact.html`**

Place the following markup after the introductory paragraph and before `<div class="contact-grid">`:

```html
      <section class="contact-location" aria-labelledby="visit-us-heading">
        <h2 id="visit-us-heading">Visit Us</h2>
        <p>
          <a href="https://www.google.com/maps/search/?api=1&amp;query=586%20Military%20Way%2C%20Palo%20Alto%2C%20CA" target="_blank" rel="noopener noreferrer">586 Military Way, Palo Alto, CA</a>
        </p>
        <iframe
          class="contact-map"
          title="Map of OliVista Art Studio at 586 Military Way, Palo Alto, CA"
          src="https://www.google.com/maps?q=586%20Military%20Way%2C%20Palo%20Alto%2C%20CA&amp;output=embed"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"></iframe>
      </section>
```

- [ ] **Step 2: Add the focused location styles to `css/style.css` before `.contact-grid`**

```css
.contact-location {
  margin: 40px auto 0;
  max-width: 900px;
}

.contact-location > p {
  margin-bottom: 20px;
}

.contact-location a {
  color: var(--color-visual-discovery);
  font-weight: 600;
}

.contact-map {
  width: 100%;
  min-height: 360px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  display: block;
}
```

Add this rule inside the existing `@media (max-width: 600px)` block that contains `.contact-grid`:

```css
  .contact-map {
    min-height: 280px;
  }
```

- [ ] **Step 3: Run the regression suite**

Run: `node --test test/web-design-guidelines.test.mjs`

Expected: PASS with all tests green.

### Task 3: Verify the user-facing page

**Files:**
- Verify: `contact.html`

**Interfaces:**
- Consumes: the static Contact page in a local browser.
- Produces: visual confirmation that the map section is prominent, readable, and responsive.

- [ ] **Step 1: Check desktop presentation**

Open `contact.html` through the project’s local static server. Confirm the `Visit Us` heading, address link, and full-width map appear between the introductory copy and Email/WeChat blocks, with no horizontal overflow.

- [ ] **Step 2: Check mobile presentation**

At a 390 px-wide viewport, confirm the map is at least 280 px tall, fills the content width, and the Email and WeChat blocks remain vertically stacked below it.

- [ ] **Step 3: Commit the implementation**

```bash
git add contact.html css/style.css test/web-design-guidelines.test.mjs docs/superpowers/plans/2026-07-16-contact-location-map.md
git commit -m "feat: add studio location map"
```
