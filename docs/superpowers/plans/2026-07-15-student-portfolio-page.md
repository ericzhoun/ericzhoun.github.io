# Student Portfolio Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `portfolio.html` "Students' Work" page for OliVista Art Studio, showing student artwork grouped by program in horizontally-scrolling rows with a click-to-enlarge lightbox, per `docs/superpowers/specs/2026-07-15-student-portfolio-page-design.md`.

**Architecture:** Plain HTML/CSS/JS, no build step, no framework — matches the rest of the site exactly. New markup goes in `portfolio.html`, new styles are appended to the existing shared `css/style.css`, and a new `js/portfolio.js` handles the lightbox via a native `<dialog>` element. Nine other existing pages get one new nav link each.

**Tech Stack:** HTML5, CSS3 (custom properties, flexbox, `scroll-snap`), vanilla JS, native `<dialog>` element. No test runner exists in this repo — verification is done by serving the site locally and checking it in the browser tool, matching the pattern used in `docs/superpowers/plans/2026-07-14-olivistart-landing-site.md`.

## Global Constraints

- No build tooling, no JS framework, no package.json — plain static files only.
- Three program accent colors are canonical and must be used consistently: Visual Discovery `#cc7013` (`--color-visual-discovery`), Creative Foundations `#7e8b3d` (`--color-creative-foundations`), Portfolio Studio `#c08a28` (`--color-portfolio-studio`).
- Reuse existing CSS custom properties (`--radius`, `--color-border`, `--color-surface`, `--font-heading`) rather than introducing new tokens.
- Images come only from the existing `assets/art-class/` directory — no new images are sourced. `assets/art-class/artQrCode.jpg` is excluded (it's a QR code, not student artwork).
- Captions are generic ("Student artwork from `<Program Name>`") since there is no real per-piece metadata — this is a documented placeholder, not a gap to silently fill in later.
- No lightbox next/prev navigation, no CMS, no dynamic image loading — hardcoded `<img>` tags only.

---

## Task 1: Portfolio page markup, image grid, and base styling

**Files:**
- Create: `portfolio.html`
- Modify: `css/style.css` (append after line 1706, end of file)

**Interfaces:**
- Produces: CSS classes `.portfolio-program`, `.portfolio-program-heading`, `.portfolio-age-badge`, `.portfolio-row`, `.portfolio-thumb`, `.portfolio-lightbox`, `.portfolio-lightbox-inner`, `.portfolio-lightbox-close`, program-color modifier classes `.portfolio-visual-discovery`, `.portfolio-creative-foundations`, `.portfolio-portfolio-studio`. DOM ids `#portfolio-lightbox`, `#portfolio-lightbox-img`, `#portfolio-lightbox-close` — Task 2's `js/portfolio.js` depends on these exact ids and on every clickable thumbnail having class `.portfolio-thumb` with an `<img>` child.

- [ ] **Step 1: Create `portfolio.html`**

```html
<!DOCTYPE html>
<html lang="en">

<head>

  <meta http-equiv="content-type" content="text/html; charset=UTF-8">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Student Portfolio | OliVista Art Studio</title>
  <meta name="description" content="A gallery of student artwork from OliVista Art Studio's Visual Discovery, Creative Foundations, and Portfolio Studio programs.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&amp;display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>

<body>
  <header class="site-header">
    <div class="container header-inner"> <a href="index.html" class="logo">OliVista <span>Art Studio</span></a>
      <nav class="site-nav" id="site-nav"> <a href="index.html">Home</a>
        <a href="programs.html">Programs</a> <a href="portfolio.html" class="is-active">Portfolio</a> <a href="schedule.html">Schedule</a> <a href="about.html">About</a> <a
          href="contact.html">Contact</a> <a href="account.html" class="nav-account">Account</a>
      </nav>
      <button class="nav-toggle" id="nav-toggle" aria-label="Toggle
          menu" aria-expanded="false"> <span></span><span></span><span></span>
      </button>
    </div>
  </header>
  <main>
    <section class="container programs-intro">
      <h1>Students' Work</h1>
      <p>A look at what students create across our three programs, from
        first brushstrokes to college-ready portfolios.</p>
    </section>

    <section class="portfolio-program portfolio-visual-discovery">
      <div class="container">
        <h2 class="portfolio-program-heading">Visual Discovery <span class="portfolio-age-badge">Ages 6-9</span></h2>
        <div class="portfolio-row">
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/kids_draw1.png" alt="Student artwork from Visual Discovery" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/kids_draw2.png" alt="Student artwork from Visual Discovery" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPortfolio1.jpg" alt="Student artwork from Visual Discovery" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPortfolio2.jpg" alt="Student artwork from Visual Discovery" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPortfolio3.jpg" alt="Student artwork from Visual Discovery" loading="lazy">
          </button>
        </div>
      </div>
    </section>

    <section class="portfolio-program portfolio-creative-foundations">
      <div class="container">
        <h2 class="portfolio-program-heading">Creative Foundations <span class="portfolio-age-badge">Ages 10-13</span></h2>
        <div class="portfolio-row">
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPortfolio4.jpg" alt="Student artwork from Creative Foundations" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPortfolio5.jpg" alt="Student artwork from Creative Foundations" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPortfolio6.jpg" alt="Student artwork from Creative Foundations" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artJourney.jpg" alt="Student artwork from Creative Foundations" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPhilosophy.jpg" alt="Student artwork from Creative Foundations" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPortfolio7.jpg" alt="Student artwork from Creative Foundations" loading="lazy">
          </button>
        </div>
      </div>
    </section>

    <section class="portfolio-program portfolio-portfolio-studio">
      <div class="container">
        <h2 class="portfolio-program-heading">Portfolio Studio <span class="portfolio-age-badge">Ages 14-17</span></h2>
        <div class="portfolio-row">
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPortfolio8.jpg" alt="Student artwork from Portfolio Studio" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPortfolio9.jpg" alt="Student artwork from Portfolio Studio" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artPortfolio10.jpg" alt="Student artwork from Portfolio Studio" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artExhibition1.jpg" alt="Student artwork from Portfolio Studio" loading="lazy">
          </button>
          <button class="portfolio-thumb" type="button">
            <img src="assets/art-class/artExhibition2.jpg" alt="Student artwork from Portfolio Studio" loading="lazy">
          </button>
        </div>
      </div>
    </section>
  </main>

  <dialog class="portfolio-lightbox" id="portfolio-lightbox">
    <div class="portfolio-lightbox-inner">
      <button class="portfolio-lightbox-close" id="portfolio-lightbox-close" type="button" aria-label="Close">&times;</button>
      <img id="portfolio-lightbox-img" src="" alt="">
    </div>
  </dialog>

  <footer class="site-footer">
    <div class="container footer-inner">
      <p>OliVista Art Studio · Learn to See · Explore · Create</p>
      <p><a href="mailto:olivistastudio@gmail.com">olivistastudio@gmail.com</a></p>
      
      <p class="footer-copyright">© 2026 OliVista Art Studio. All
        rights reserved.</p>
    </div>
  </footer>
  <script src="js/nav.js"></script>
  <script src="js/portfolio.js"></script>
</body>

</html>
```

- [ ] **Step 2: Append portfolio styles to `css/style.css`**

Append this block at the end of `css/style.css` (after the existing `.form-actions` rule, currently the last rule in the file):

```css

/* Student Portfolio page */
.portfolio-program {
  padding: 48px 0;
  border-bottom: 1px solid var(--color-border);
}

.portfolio-program:last-child {
  border-bottom: none;
}

.portfolio-program-heading {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.portfolio-age-badge {
  display: inline-block;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 0.85rem;
  color: #fff;
  padding: 4px 12px;
  border-radius: 999px;
}

.portfolio-visual-discovery h2 { color: var(--color-visual-discovery); }
.portfolio-visual-discovery .portfolio-age-badge { background: var(--color-visual-discovery); }
.portfolio-creative-foundations h2 { color: var(--color-creative-foundations); }
.portfolio-creative-foundations .portfolio-age-badge { background: var(--color-creative-foundations); }
.portfolio-portfolio-studio h2 { color: var(--color-portfolio-studio); }
.portfolio-portfolio-studio .portfolio-age-badge { background: var(--color-portfolio-studio); }

.portfolio-row {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding-bottom: 12px;
  margin: 0;
  border: none;
}

.portfolio-thumb {
  flex: 0 0 auto;
  width: 240px;
  height: 240px;
  scroll-snap-align: start;
  border-radius: var(--radius);
  overflow: hidden;
  border: none;
  padding: 0;
  cursor: pointer;
  background: var(--color-surface);
}

.portfolio-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.2s ease;
}

.portfolio-thumb:hover img,
.portfolio-thumb:focus-visible img {
  transform: scale(1.05);
}

.portfolio-lightbox {
  border: none;
  border-radius: var(--radius);
  padding: 0;
  max-width: 90vw;
  max-height: 90vh;
  background: transparent;
}

.portfolio-lightbox::backdrop {
  background: rgba(0, 0, 0, 0.8);
}

.portfolio-lightbox-inner {
  position: relative;
  background: var(--color-surface);
  border-radius: var(--radius);
  padding: 8px;
}

.portfolio-lightbox img {
  display: block;
  max-width: 85vw;
  max-height: 80vh;
  border-radius: calc(var(--radius) - 4px);
}

.portfolio-lightbox-close {
  position: absolute;
  top: -16px;
  right: -16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color-text);
  color: #fff;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 600px) {
  .portfolio-thumb {
    width: 180px;
    height: 180px;
  }
}
```

- [ ] **Step 3: Start the local server and verify in browser**

Run: `cd /Users/ericz/Documents/GitHub/olivistart && python3 -m http.server 8000` (or use the `olivistart-site` preview config already defined in `.claude/launch.json`).

Open `http://localhost:8000/portfolio.html` in the browser tool. Verify:
- Page title reads "Students' Work" and the "Portfolio" nav link is present and marked active.
- Three sections render in order: Visual Discovery (5 images), Creative Foundations (6 images), Portfolio Studio (5 images), each with the correct age badge and program accent color on the heading/badge.
- Each row of thumbnails scrolls horizontally (drag the row or use the browser tool's scroll action) and images are cropped to square via `object-fit: cover`, not stretched.
- No broken images (check the network tab / read_page for missing `alt`/broken `src`).
- No console errors.

Expected: all three rows visible with correct image counts and colors, horizontal scroll works, no console errors.

- [ ] **Step 4: Commit**

```bash
git add portfolio.html css/style.css
git commit -m "Add student portfolio page with program galleries"
```

---

## Task 2: Lightbox interaction

**Files:**
- Create: `js/portfolio.js`

**Interfaces:**
- Consumes: DOM ids `#portfolio-lightbox`, `#portfolio-lightbox-img`, `#portfolio-lightbox-close` and class `.portfolio-thumb` (each containing exactly one `<img>`), all produced by Task 1's `portfolio.html`.
- Produces: nothing consumed by later tasks — this is the last piece of portfolio-specific behavior.

- [ ] **Step 1: Create `js/portfolio.js`**

```js
document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('portfolio-lightbox');
  const lightboxImg = document.getElementById('portfolio-lightbox-img');
  const closeBtn = document.getElementById('portfolio-lightbox-close');

  if (!dialog || !lightboxImg || !closeBtn) {
    return;
  }

  document.querySelectorAll('.portfolio-thumb').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      const img = thumb.querySelector('img');
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt;
      dialog.showModal();
    });
  });

  closeBtn.addEventListener('click', () => {
    dialog.close();
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
});
```

- [ ] **Step 2: Verify in browser**

With the local server from Task 1 still running, reload `http://localhost:8000/portfolio.html`. Using the browser tool:
- Click a thumbnail in any row. Verify a dialog opens on a dark overlay showing the same image enlarged.
- Click the × close button. Verify the dialog closes.
- Open the dialog again, then click on the dark overlay area outside the image. Verify the dialog closes.
- Open the dialog again, then press the Escape key. Verify the dialog closes (native `<dialog>` behavior, no extra JS needed).
- Check the browser console for errors during all of the above.

Expected: dialog opens with the clicked image, and all three dismiss methods (close button, outside click, Escape) close it, with no console errors.

- [ ] **Step 3: Commit**

```bash
git add js/portfolio.js
git commit -m "Add lightbox interaction to student portfolio page"
```

---

## Task 3: Add Portfolio link to site navigation

**Files:**
- Modify: `index.html:24-28`
- Modify: `programs.html:23-25`
- Modify: `schedule.html:19-26`
- Modify: `about.html:24-28`
- Modify: `contact.html:17-24`
- Modify: `account.html:19-26`
- Modify: `login.html:19-26`
- Modify: `signup.html:19-26`
- Modify: `enroll.html:19-26`
- Modify: `registration.html:19-26`

**Interfaces:**
- Consumes: `portfolio.html` existing at the repo root (produced by Task 1) as the link target.
- Produces: nothing consumed by later tasks — this is the final task.

- [ ] **Step 1: Add the Portfolio link to `index.html`**

In `index.html`, find:

```html
        <nav class="site-nav" id="site-nav"> <a href="index.html"
            class="is-active">Home</a> <a href="programs.html">Programs</a>
          <a href="schedule.html">Schedule</a>
```

Replace with:

```html
        <nav class="site-nav" id="site-nav"> <a href="index.html"
            class="is-active">Home</a> <a href="programs.html">Programs</a>
          <a href="portfolio.html">Portfolio</a>
          <a href="schedule.html">Schedule</a>
```

- [ ] **Step 2: Add the Portfolio link to `programs.html`**

Find:

```html
      <nav class="site-nav" id="site-nav"> <a href="index.html">Home</a>
        <a href="programs.html" class="is-active">Programs</a> <a href="schedule.html">Schedule</a> <a href="about.html">About</a> <a
          href="contact.html">Contact</a> <a href="account.html" class="nav-account">Account</a>
      </nav>
```

Replace with:

```html
      <nav class="site-nav" id="site-nav"> <a href="index.html">Home</a>
        <a href="programs.html" class="is-active">Programs</a> <a href="portfolio.html">Portfolio</a> <a href="schedule.html">Schedule</a> <a href="about.html">About</a> <a
          href="contact.html">Contact</a> <a href="account.html" class="nav-account">Account</a>
      </nav>
```

- [ ] **Step 3: Add the Portfolio link to `schedule.html`, `about.html`, `contact.html`, `account.html`, `login.html`, `signup.html`, `enroll.html`, `registration.html`**

Each of these eight files has one of two nav shapes. Apply the matching replacement to each file.

For `schedule.html`, `contact.html`, `account.html`, `login.html`, `signup.html`, `enroll.html`, `registration.html` (multi-line nav), find:

```html
      <nav class="site-nav" id="site-nav">
        <a href="index.html">Home</a>
        <a href="programs.html">Programs</a>
```

Replace with:

```html
      <nav class="site-nav" id="site-nav">
        <a href="index.html">Home</a>
        <a href="programs.html">Programs</a>
        <a href="portfolio.html">Portfolio</a>
```

(This pattern is identical across all seven files — the `Programs` line has no `is-active` class in any of them since none of these pages are the Programs page, so a plain string match/replace is safe in each.)

For `about.html`, find:

```html
        <nav class="site-nav" id="site-nav"> <a href="index.html">Home</a>
          <a href="programs.html">Programs</a> <a href="schedule.html">Schedule</a> <a href="about.html"
```

Replace with:

```html
        <nav class="site-nav" id="site-nav"> <a href="index.html">Home</a>
          <a href="programs.html">Programs</a> <a href="portfolio.html">Portfolio</a> <a href="schedule.html">Schedule</a> <a href="about.html"
```

- [ ] **Step 4: Verify in browser**

With the local server from Task 1 still running, reload each of the ten modified pages plus `portfolio.html` itself (11 pages total) in the browser tool and, on each:
- Confirm a "Portfolio" link appears in the nav between "Programs" and "Schedule".
- Click it and confirm it navigates to `portfolio.html`.
- Confirm no existing `is-active` state was disturbed (each page's own nav link should still show as active, `portfolio.html`'s own "Portfolio" link should show as active only on `portfolio.html`).
- Resize the browser tool to a mobile width (e.g. 375px) on at least `index.html` and `portfolio.html`, open the hamburger menu, and confirm "Portfolio" appears there too and the mobile nav still opens/closes correctly.

Expected: all 11 pages show a working "Portfolio" nav link, no `is-active` regressions, mobile menu unaffected.

- [ ] **Step 5: Stop the local server and commit**

```bash
git add index.html programs.html schedule.html about.html contact.html account.html login.html signup.html enroll.html registration.html
git commit -m "Add Portfolio link to site navigation"
```
