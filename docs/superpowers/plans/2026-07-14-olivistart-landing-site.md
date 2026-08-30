# OliVista Art Studio Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 4-page static OliVista Art Studio website (Home, Programs, About, Contact) described in `docs/superpowers/specs/2026-07-14-olivistart-landing-site-design.md`.

**Architecture:** Plain HTML/CSS/JS, no build step, no framework. One shared stylesheet and one small JS file for the mobile nav toggle. Header/nav and footer markup is duplicated by hand across the four HTML files.

**Tech Stack:** HTML5, CSS3 (custom properties, Grid, Flexbox), vanilla JS, Google Fonts (Poppins) via CDN link.

## Global Constraints

- No build tooling, no JS framework, no package.json — plain static files only.
- Three program accent colors are canonical and must be used consistently everywhere they appear: Visual Discovery `#cc7013` (maroon/pink), Creative Foundations `#7e8b3d` (olive green), Portfolio Studio `#c08a28` (gold/mustard).
- Program CTA buttons link to `contact.html`, never `mailto:` directly.
- No pricing, business hours, phone number, or multi-location content — none of this exists for OliVista.
- The WeChat QR image must be downloaded from the signed URL in the existing `qr-code.html` only after explicit user permission (state filename, source URL, and that it's needed because the current signed URL expires ~2026-07-19). Never skip this confirmation step.
- About page content is adapted/reworded from https://www.herfieldphoto.com/art-class, not copied verbatim.

---

## Task 1: Shared CSS foundation + site chrome on all four pages

**Files:**
- Create: `css/style.css`
- Create: `js/nav.js`
- Create: `index.html`
- Create: `programs.html`
- Create: `about.html`
- Create: `contact.html`

**Interfaces:**
- Produces: CSS custom properties `--color-bg`, `--color-surface`, `--color-text`, `--color-text-muted`, `--color-visual-discovery`, `--color-creative-foundations`, `--color-portfolio-studio`, `--color-border`, `--font-heading`, `--font-body`, `--container-width`, `--radius`. CSS classes `.container`, `.btn` (+ `.btn-visual-discovery`, `.btn-creative-foundations`, `.btn-portfolio-studio`), `.site-header`, `.header-inner`, `.logo`, `.site-nav`, `.nav-toggle`, `.site-footer`, `.footer-inner`, `.footer-note`, `.footer-copyright`. DOM ids `#site-nav`, `#nav-toggle` wired up by `js/nav.js`. All later tasks build page content inside each file's `<main>`.

- [ ] **Step 1: Create `css/style.css` with the base foundation**

```css
:root {
  --color-bg: #faf7f2;
  --color-surface: #ffffff;
  --color-text: #2b2b2b;
  --color-text-muted: #5a5a5a;
  --color-visual-discovery: #cc7013;
  --color-creative-foundations: #7e8b3d;
  --color-portfolio-studio: #c08a28;
  --color-border: #e6e1d8;
  --font-heading: 'Poppins', sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --container-width: 1100px;
  --radius: 12px;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  font-family: var(--font-body);
  color: var(--color-text);
  background: var(--color-bg);
  line-height: 1.6;
}

h1, h2, h3 {
  font-family: var(--font-heading);
  font-weight: 700;
  line-height: 1.2;
  margin: 0 0 0.5em;
}

p {
  margin: 0 0 1em;
}

a {
  color: inherit;
}

img, svg {
  max-width: 100%;
  display: block;
}

.container {
  max-width: var(--container-width);
  margin: 0 auto;
  padding: 0 24px;
}

.btn {
  display: inline-block;
  padding: 12px 28px;
  border-radius: 999px;
  font-family: var(--font-heading);
  font-weight: 600;
  text-decoration: none;
  color: #fff;
  background: var(--color-text);
  border: none;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.btn:hover {
  transform: translateY(-2px);
  opacity: 0.92;
}

.btn-visual-discovery { background: var(--color-visual-discovery); }
.btn-creative-foundations { background: var(--color-creative-foundations); }
.btn-portfolio-studio { background: var(--color-portfolio-studio); }

/* Header */
.site-header {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 72px;
  position: relative;
}

.logo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 1.25rem;
  text-decoration: none;
  color: var(--color-text);
}

.logo span {
  color: var(--color-visual-discovery);
}

.site-nav {
  display: flex;
  gap: 28px;
}

.site-nav a {
  text-decoration: none;
  font-weight: 600;
  color: var(--color-text-muted);
}

.site-nav a.is-active,
.site-nav a:hover {
  color: var(--color-visual-discovery);
}

.nav-toggle {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  width: 32px;
  height: 32px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.nav-toggle span {
  display: block;
  height: 2px;
  background: var(--color-text);
}

/* Footer */
.site-footer {
  background: var(--color-text);
  color: #fff;
  margin-top: 80px;
}

.footer-inner {
  padding: 40px 24px;
  text-align: center;
}

.footer-inner a {
  color: #fff;
  text-decoration: underline;
}

.footer-note {
  font-weight: 600;
  color: var(--color-portfolio-studio);
}

.footer-copyright {
  font-size: 0.85rem;
  color: #b7b7b7;
  margin: 0;
}

/* Responsive nav */
@media (max-width: 720px) {
  .site-nav {
    position: absolute;
    top: 72px;
    left: 0;
    right: 0;
    background: var(--color-surface);
    flex-direction: column;
    gap: 0;
    max-height: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--color-border);
    transition: max-height 0.2s ease;
  }

  .site-nav.is-open {
    max-height: 300px;
  }

  .site-nav a {
    padding: 16px 24px;
    border-top: 1px solid var(--color-border);
  }

  .nav-toggle {
    display: flex;
  }
}
```

- [ ] **Step 2: Create `js/nav.js`**

```js
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');

  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });
});
```

- [ ] **Step 3: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OliVista Art Studio | Kids &amp; Teen Art Classes</title>
  <meta name="description" content="OliVista Art Studio offers small-group art classes for ages 6-17: Visual Discovery, Creative Foundations, and Portfolio Studio.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a href="index.html" class="logo">OliVista <span>Art Studio</span></a>
      <nav class="site-nav" id="site-nav">
        <a href="index.html" class="is-active">Home</a>
        <a href="programs.html">Programs</a>
        <a href="about.html">About</a>
        <a href="contact.html">Contact</a>
      </nav>
      <button class="nav-toggle" id="nav-toggle" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>

  <main>
    <section class="container" style="padding: 80px 24px;">
      <h1>Home</h1>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <p>OliVista Art Studio &middot; Learn to See &middot; Explore &middot; Create</p>
      <p><a href="mailto:olivistastudio@gmail.com">olivistastudio@gmail.com</a></p>
      
      <p class="footer-copyright">&copy; 2026 OliVista Art Studio. All rights reserved.</p>
    </div>
  </footer>

  <script src="js/nav.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `programs.html`** (same head/header/footer/script pattern as `index.html`, with `<title>Programs | OliVista Art Studio</title>`, the `is-active` class moved to the Programs nav link, and `<main>` containing only `<section class="container" style="padding: 80px 24px;"><h1>Programs</h1></section>`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Programs | OliVista Art Studio</title>
  <meta name="description" content="Three age-based art programs at OliVista Art Studio: Visual Discovery (6-9), Creative Foundations (10-13), and Portfolio Studio (14-17).">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a href="index.html" class="logo">OliVista <span>Art Studio</span></a>
      <nav class="site-nav" id="site-nav">
        <a href="index.html">Home</a>
        <a href="programs.html" class="is-active">Programs</a>
        <a href="about.html">About</a>
        <a href="contact.html">Contact</a>
      </nav>
      <button class="nav-toggle" id="nav-toggle" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>

  <main>
    <section class="container" style="padding: 80px 24px;">
      <h1>Programs</h1>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <p>OliVista Art Studio &middot; Learn to See &middot; Explore &middot; Create</p>
      <p><a href="mailto:olivistastudio@gmail.com">olivistastudio@gmail.com</a></p>
      
      <p class="footer-copyright">&copy; 2026 OliVista Art Studio. All rights reserved.</p>
    </div>
  </footer>

  <script src="js/nav.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create `about.html`** (same pattern, `<title>About | OliVista Art Studio</title>`, `is-active` on the About link, `<main>` containing only `<section class="container" style="padding: 80px 24px;"><h1>About</h1></section>`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About | OliVista Art Studio</title>
  <meta name="description" content="Meet the instructor behind OliVista Art Studio and learn the teaching philosophy that shapes every class.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a href="index.html" class="logo">OliVista <span>Art Studio</span></a>
      <nav class="site-nav" id="site-nav">
        <a href="index.html">Home</a>
        <a href="programs.html">Programs</a>
        <a href="about.html" class="is-active">About</a>
        <a href="contact.html">Contact</a>
      </nav>
      <button class="nav-toggle" id="nav-toggle" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>

  <main>
    <section class="container" style="padding: 80px 24px;">
      <h1>About</h1>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <p>OliVista Art Studio &middot; Learn to See &middot; Explore &middot; Create</p>
      <p><a href="mailto:olivistastudio@gmail.com">olivistastudio@gmail.com</a></p>
      
      <p class="footer-copyright">&copy; 2026 OliVista Art Studio. All rights reserved.</p>
    </div>
  </footer>

  <script src="js/nav.js"></script>
</body>
</html>
```

- [ ] **Step 6: Create `contact.html`** (same pattern, `<title>Contact | OliVista Art Studio</title>`, `is-active` on the Contact link, `<main>` containing only `<section class="container" style="padding: 80px 24px;"><h1>Contact</h1></section>`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact | OliVista Art Studio</title>
  <meta name="description" content="Get in touch with OliVista Art Studio by email or WeChat.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a href="index.html" class="logo">OliVista <span>Art Studio</span></a>
      <nav class="site-nav" id="site-nav">
        <a href="index.html">Home</a>
        <a href="programs.html">Programs</a>
        <a href="about.html">About</a>
        <a href="contact.html" class="is-active">Contact</a>
      </nav>
      <button class="nav-toggle" id="nav-toggle" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>

  <main>
    <section class="container" style="padding: 80px 24px;">
      <h1>Contact</h1>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <p>OliVista Art Studio &middot; Learn to See &middot; Explore &middot; Create</p>
      <p><a href="mailto:olivistastudio@gmail.com">olivistastudio@gmail.com</a></p>
      
      <p class="footer-copyright">&copy; 2026 OliVista Art Studio. All rights reserved.</p>
    </div>
  </footer>

  <script src="js/nav.js"></script>
</body>
</html>
```

- [ ] **Step 7: Start a local static server and verify in browser**

Run: `cd /Users/ericz/Documents/GitHub/olivistart && python3 -m http.server 8000`

Open `http://localhost:8000/index.html` in the browser tool. Verify:
- Header shows "OliVista Art Studio" logo and 4 nav links, footer shows email/badge/copyright.
- The current page's nav link is colored (maroon), others are gray.
- Resize to a mobile width (< 720px): nav links disappear, hamburger button appears; click it and confirm the menu drops down and toggles closed again.
- Click each nav link and confirm all 4 pages load without 404s and each highlights its own link.

Expected: no console errors, all 4 pages reachable, mobile toggle works.

- [ ] **Step 8: Commit**

```bash
git add css/style.css js/nav.js index.html programs.html about.html contact.html
git commit -m "Add shared site chrome for OliVista Art Studio pages"
```

---

## Task 2: Home page content

**Files:**
- Modify: `index.html` (replace the placeholder `<main>` block from Task 1)
- Modify: `css/style.css` (append)

**Interfaces:**
- Consumes: `.container`, `.btn` + color variants, `--color-*` variables, `--font-heading` from Task 1.
- Produces: CSS classes `.hero`, `.badge`, `.tagline`, `.hero-sub`, `.programs-teaser`, `.teaser-grid`, `.teaser-card` (+ `.teaser-visual-discovery`, `.teaser-creative-foundations`, `.teaser-portfolio-studio`), `.teaser-age`, `.philosophy-teaser`, `.cta-banner`. Links to `programs.html#visual-discovery`, `#creative-foundations`, `#portfolio-studio` anchors that Task 3 must define.

- [ ] **Step 1: Replace the `<main>` block in `index.html`**

Replace:
```html
  <main>
    <section class="container" style="padding: 80px 24px;">
      <h1>Home</h1>
    </section>
  </main>
```

With:
```html
  <main>
    <section class="hero container">
      <p class="badge">Maximum 6 students per class</p>
      <h1>OliVista Art Studio</h1>
      <p class="tagline">Learn to See &middot; Explore &middot; Create</p>
      <p class="hero-sub">Small-group art classes for ages 6-17, built around observation, creativity, and technical growth at every stage.</p>
      <a class="btn" href="contact.html">Get in Touch</a>
    </section>

    <section class="container programs-teaser">
      <h2>Our Programs</h2>
      <div class="teaser-grid">
        <a class="teaser-card teaser-visual-discovery" href="programs.html#visual-discovery">
          <p class="teaser-age">Ages 6-9</p>
          <h3>Visual Discovery</h3>
          <p>Cultivate observation, creativity, and artistic appreciation.</p>
        </a>
        <a class="teaser-card teaser-creative-foundations" href="programs.html#creative-foundations">
          <p class="teaser-age">Ages 10-13</p>
          <h3>Creative Foundations</h3>
          <p>Strengthen observational drawing, technical skills, and visual expression.</p>
        </a>
        <a class="teaser-card teaser-portfolio-studio" href="programs.html#portfolio-studio">
          <p class="teaser-age">Ages 14-17</p>
          <h3>Portfolio Studio</h3>
          <p>Develop an individual artistic voice while preparing a competitive portfolio for college admission.</p>
        </a>
      </div>
    </section>

    <section class="container philosophy-teaser">
      <blockquote>&ldquo;Art is more than learning how to draw.&rdquo;</blockquote>
      <p>At OliVista, students build observation skills, creative thinking, and confidence in their own ideas &mdash; guided by an instructor who has practiced and taught art for years.</p>
      <a class="btn" href="about.html">Meet the Studio</a>
    </section>

    <section class="cta-banner">
      <div class="container">
        <h2>Ready to get started?</h2>
        <p>Reach out to learn more or ask about enrolling your child.</p>
        <a class="btn" href="contact.html">Contact Us</a>
      </div>
    </section>
  </main>
```

- [ ] **Step 2: Append to `css/style.css`**

```css
/* Hero */
.hero {
  text-align: center;
  padding: 80px 24px 60px;
}

.badge {
  display: inline-block;
  background: var(--color-portfolio-studio);
  color: #fff;
  font-weight: 600;
  font-size: 0.85rem;
  padding: 6px 16px;
  border-radius: 999px;
  margin-bottom: 20px;
}

.hero h1 {
  font-size: 2.75rem;
  color: var(--color-visual-discovery);
}

.tagline {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 1.25rem;
}

.hero-sub {
  max-width: 560px;
  margin: 0 auto 28px;
  color: var(--color-text-muted);
}

/* Programs teaser */
.programs-teaser {
  padding: 40px 24px 80px;
  text-align: center;
}

.teaser-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  margin-top: 32px;
}

.teaser-card {
  display: block;
  text-decoration: none;
  color: #fff;
  border-radius: var(--radius);
  padding: 28px 24px;
  text-align: left;
  transition: transform 0.15s ease;
}

.teaser-card:hover {
  transform: translateY(-4px);
}

.teaser-card p {
  color: rgba(255, 255, 255, 0.9);
}

.teaser-age {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.8rem;
  letter-spacing: 0.05em;
}

.teaser-visual-discovery { background: var(--color-visual-discovery); }
.teaser-creative-foundations { background: var(--color-creative-foundations); }
.teaser-portfolio-studio { background: var(--color-portfolio-studio); }

/* Philosophy teaser */
.philosophy-teaser {
  max-width: 640px;
  text-align: center;
  padding: 40px 24px 80px;
  margin: 0 auto;
}

.philosophy-teaser blockquote {
  font-family: var(--font-heading);
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0 0 16px;
  color: var(--color-creative-foundations);
}

/* CTA banner */
.cta-banner {
  background: var(--color-text);
  color: #fff;
  text-align: center;
  padding: 60px 24px;
}

.cta-banner h2 {
  color: #fff;
}

.cta-banner .btn {
  background: var(--color-visual-discovery);
}

@media (max-width: 720px) {
  .teaser-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Verify in browser**

With the Task 1 server still running, reload `http://localhost:8000/index.html`. Verify:
- Badge, headline, tagline, sub-copy, and "Get in Touch" button render centered in the hero.
- Three teaser cards render side by side in their three distinct colors (maroon, olive, gold) with age/title/description.
- Philosophy quote section and dark CTA banner render below.
- Resize to mobile width: teaser cards stack to a single column.
- The three teaser card links currently 404 (Programs page anchors don't exist yet) — expected until Task 3.

- [ ] **Step 4: Commit**

```bash
git add index.html css/style.css
git commit -m "Add Home page content"
```

---

## Task 3: Programs page content + illustrations

**Files:**
- Modify: `programs.html` (replace the placeholder `<main>` block from Task 1)
- Modify: `css/style.css` (append)
- Create: `assets/visual-discovery.svg`
- Create: `assets/creative-foundations.svg`
- Create: `assets/portfolio-studio.svg`

**Interfaces:**
- Consumes: `.container`, `.btn-visual-discovery`/`.btn-creative-foundations`/`.btn-portfolio-studio`, `--color-*` variables from Task 1. Anchors `#visual-discovery`, `#creative-foundations`, `#portfolio-studio` linked from Task 2's teaser cards.
- Produces: CSS classes `.programs-intro`, `.program-section` (+ `.program-visual-discovery`, `.program-creative-foundations`, `.program-portfolio-studio`, `.reverse`), `.program-grid`, `.program-visual`, `.program-content`, `.program-tagline`.

- [ ] **Step 1: Create `assets/visual-discovery.svg`**

```svg
<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration of an open sketchbook with a sun doodle">
  <rect x="20" y="60" width="200" height="140" rx="12" fill="none" stroke="#cc7013" stroke-width="4"/>
  <line x1="120" y1="60" x2="120" y2="200" stroke="#cc7013" stroke-width="4"/>
  <circle cx="80" cy="115" r="18" fill="none" stroke="#cc7013" stroke-width="4"/>
  <g stroke="#cc7013" stroke-width="4" stroke-linecap="round">
    <line x1="80" y1="83" x2="80" y2="73"/>
    <line x1="80" y1="157" x2="80" y2="147"/>
    <line x1="52" y1="115" x2="42" y2="115"/>
    <line x1="118" y1="115" x2="108" y2="115"/>
    <line x1="59" y1="94" x2="52" y2="87"/>
    <line x1="101" y1="136" x2="108" y2="143"/>
    <line x1="59" y1="136" x2="52" y2="143"/>
    <line x1="101" y1="94" x2="108" y2="87"/>
  </g>
  <path d="M150 165 Q160 135 175 165 Q185 145 195 165" fill="none" stroke="#cc7013" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="150" y1="180" x2="200" y2="180" stroke="#cc7013" stroke-width="4" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 2: Create `assets/creative-foundations.svg`**

```svg
<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration of a still life with a plaster bust and a vase">
  <ellipse cx="120" cy="205" rx="90" ry="8" fill="none" stroke="#7e8b3d" stroke-width="3"/>
  <path d="M70 205 v-20 q0 -10 10 -10 h20 q10 0 10 10 v20" fill="none" stroke="#7e8b3d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M75 175 q5 -60 30 -60 q25 0 30 60" fill="none" stroke="#7e8b3d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M95 118 q10 -15 20 0" fill="none" stroke="#7e8b3d" stroke-width="4" stroke-linecap="round"/>
  <path d="M160 205 v-50 q0 -30 20 -30 q20 0 20 30 v50" fill="none" stroke="#7e8b3d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="150" y1="205" x2="210" y2="205" stroke="#7e8b3d" stroke-width="4" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 3: Create `assets/portfolio-studio.svg`**

```svg
<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration of a portfolio folder with sketches and a pencil">
  <path d="M40 70 h160 v120 a10 10 0 0 1 -10 10 h-140 a10 10 0 0 1 -10 -10 z" fill="none" stroke="#c08a28" stroke-width="4" stroke-linejoin="round"/>
  <path d="M40 70 l15 -20 h50 l10 20" fill="none" stroke="#c08a28" stroke-width="4" stroke-linejoin="round"/>
  <line x1="70" y1="110" x2="170" y2="110" stroke="#c08a28" stroke-width="3"/>
  <line x1="70" y1="130" x2="150" y2="130" stroke="#c08a28" stroke-width="3"/>
  <line x1="70" y1="150" x2="160" y2="150" stroke="#c08a28" stroke-width="3"/>
  <g transform="translate(150 40) rotate(45)">
    <rect x="0" y="0" width="14" height="70" rx="3" fill="none" stroke="#c08a28" stroke-width="4"/>
    <path d="M0 70 l7 14 l7 -14 z" fill="none" stroke="#c08a28" stroke-width="4" stroke-linejoin="round"/>
  </g>
</svg>
```

- [ ] **Step 4: Replace the `<main>` block in `programs.html`**

Replace:
```html
  <main>
    <section class="container" style="padding: 80px 24px;">
      <h1>Programs</h1>
    </section>
  </main>
```

With:
```html
  <main>
    <section class="container programs-intro">
      <h1>Our Programs</h1>
      <p>Three age-based tracks, each capped at 6 students, designed to grow with your child's artistic development.</p>
    </section>

    <section id="visual-discovery" class="program-section program-visual-discovery">
      <div class="container program-grid">
        <div class="program-visual">
          <img src="assets/visual-discovery.svg" alt="Illustration of an open sketchbook with a sun doodle">
        </div>
        <div class="program-content">
          <p class="teaser-age">Ages 6-9</p>
          <h2>Visual Discovery</h2>
          <p class="program-tagline">Learn to See &middot; Explore &middot; Create</p>
          <p>Cultivate observation, creativity, and artistic appreciation.</p>
          <ul>
            <li>Observation &amp; Visual Thinking</li>
            <li>Drawing &amp; Painting</li>
            <li>Shape, Color &amp; Composition</li>
            <li>Theme-Based Art Projects</li>
            <li>Inspired by the Masters</li>
            <li>Mixed Media Exploration</li>
            <li>Nature Journaling</li>
          </ul>
          <a class="btn btn-visual-discovery" href="contact.html">Contact Us</a>
        </div>
      </div>
    </section>

    <section id="creative-foundations" class="program-section program-creative-foundations reverse">
      <div class="container program-grid">
        <div class="program-content">
          <p class="teaser-age">Ages 10-13</p>
          <h2>Creative Foundations</h2>
          <p class="program-tagline">Observe &middot; Build &middot; Express</p>
          <p>Strengthen observational drawing, technical skills, and visual expression.</p>
          <ul>
            <li>Drawing Fundamentals</li>
            <li>Plaster Cast Studies (Introduction)</li>
            <li>Light &amp; Shadow</li>
            <li>Perspective</li>
            <li>Still Life Drawing</li>
            <li>Painting Foundations</li>
            <li>Color Theory</li>
            <li>Personal Projects</li>
          </ul>
          <a class="btn btn-creative-foundations" href="contact.html">Contact Us</a>
        </div>
        <div class="program-visual">
          <img src="assets/creative-foundations.svg" alt="Illustration of a still life with a plaster bust and a vase">
        </div>
      </div>
    </section>

    <section id="portfolio-studio" class="program-section program-portfolio-studio">
      <div class="container program-grid">
        <div class="program-visual">
          <img src="assets/portfolio-studio.svg" alt="Illustration of a portfolio folder with sketches and a pencil">
        </div>
        <div class="program-content">
          <p class="teaser-age">Ages 14-17</p>
          <h2>Portfolio Studio</h2>
          <p class="program-tagline">Develop &middot; Refine &middot; Express</p>
          <p>Develop an individual artistic voice while preparing a competitive portfolio for college admission.</p>
          <ul>
            <li>Advanced Drawing</li>
            <li>Creative Drawing</li>
            <li>Plaster Cast Studies</li>
            <li>Pre-Portfolio Development</li>
            <li>Portfolio Development</li>
            <li>Personal Projects</li>
            <li>One-on-One Portfolio Mentoring Available</li>
          </ul>
          <a class="btn btn-portfolio-studio" href="contact.html">Contact Us</a>
        </div>
      </div>
    </section>
  </main>
```

- [ ] **Step 5: Append to `css/style.css`**

```css
.programs-intro {
  padding: 60px 24px 20px;
  text-align: center;
}

.program-section {
  padding: 60px 0;
  border-bottom: 1px solid var(--color-border);
}

.program-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  align-items: center;
}

.program-visual {
  border-radius: var(--radius);
  padding: 40px;
}

.program-visual-discovery .program-visual { background: #fbe3ec; }
.program-creative-foundations .program-visual { background: #eef0e2; }
.program-portfolio-studio .program-visual { background: #f8ecd8; }

.program-content h2 {
  font-size: 2rem;
}

.program-visual-discovery h2 { color: var(--color-visual-discovery); }
.program-creative-foundations h2 { color: var(--color-creative-foundations); }
.program-portfolio-studio h2 { color: var(--color-portfolio-studio); }

.program-tagline {
  font-family: var(--font-heading);
  font-weight: 600;
}

.program-content ul {
  padding-left: 20px;
  margin: 0 0 24px;
}

.program-content li {
  margin-bottom: 6px;
}

@media (max-width: 800px) {
  .program-grid {
    grid-template-columns: 1fr;
  }

  .program-section.reverse .program-visual {
    order: -1;
  }
}
```

- [ ] **Step 6: Verify in browser**

Reload `http://localhost:8000/programs.html`. Verify:
- Three alternating sections render (illustration left/text right, then text left/illustration right, then illustration left/text right again), each tinted with its program's light background and colored heading.
- All bullet lists match the flyer content exactly.
- Each "Contact Us" button is colored to match its program and links to `contact.html`.
- Go back to `http://localhost:8000/index.html` and click each of the three teaser cards — confirm they now jump to the correct anchor on the Programs page instead of 404ing.
- Resize to mobile width: each section stacks to one column with the illustration always on top.

- [ ] **Step 7: Commit**

```bash
git add programs.html css/style.css assets/visual-discovery.svg assets/creative-foundations.svg assets/portfolio-studio.svg
git commit -m "Add Programs page content and illustrations"
```

---

## Task 4: About page content

**Files:**
- Modify: `about.html` (replace the placeholder `<main>` block from Task 1)
- Modify: `css/style.css` (append)

**Interfaces:**
- Consumes: `.container`, `--color-*` variables, `--font-heading` from Task 1.
- Produces: CSS classes `.about-intro`, `.about-bio`, `.about-philosophy`, `.about-class-size`.

- [ ] **Step 1: Replace the `<main>` block in `about.html`**

Replace:
```html
  <main>
    <section class="container" style="padding: 80px 24px;">
      <h1>About</h1>
    </section>
  </main>
```

With:
```html
  <main>
    <section class="container about-intro">
      <h1>About OliVista</h1>
      <p class="tagline">Art is more than learning how to draw.</p>
    </section>

    <section class="container about-bio">
      <h2>Meet the Instructor</h2>
      <p>Olivia has practiced art since childhood, beginning formal training in fourth grade with sketching and gouache painting. Her artistic practice has since grown to span oil painting, ceramics, and photography.</p>
      <p>She has taught sketching, color painting, ceramics, and creative projects to students of all ages &mdash; both individually and in small groups &mdash; including preparation for competitive art entrance examinations.</p>
    </section>

    <section class="container about-philosophy">
      <h2>Teaching Philosophy</h2>
      <p>At OliVista, art is more than learning how to draw. Through observation and creative expression, students build careful observation skills, creative thinking, and confidence in their own ideas.</p>
      <ul>
        <li>Building enthusiasm through engaging, hands-on activities</li>
        <li>Learning visual language through the elements of art</li>
        <li>Developing observation and visual thinking</li>
        <li>Discovering artists and styles from around the world</li>
        <li>Expressing ideas creatively while building self-assurance</li>
      </ul>
    </section>

    <section class="container about-class-size">
      <h2>Small by Design</h2>
      <p>Every OliVista class is capped at 6 students. Small groups mean each student gets real one-on-one attention &mdash; not just a smaller classroom, but a deliberate part of how we teach.</p>
    </section>
  </main>
```

- [ ] **Step 2: Append to `css/style.css`**

```css
.about-intro, .about-bio, .about-philosophy, .about-class-size {
  padding: 40px 24px;
  max-width: 720px;
  margin: 0 auto;
}

.about-intro {
  padding-top: 60px;
  text-align: center;
  max-width: none;
}

.about-intro .tagline {
  color: var(--color-creative-foundations);
}

.about-philosophy ul {
  padding-left: 20px;
}

.about-class-size {
  padding-bottom: 80px;
}
```

- [ ] **Step 3: Verify in browser**

Reload `http://localhost:8000/about.html`. Verify:
- Intro heading + olive-colored tagline render centered.
- Bio, philosophy (with 5 bullets), and "Small by Design" sections render in a readable, centered column at both desktop and mobile widths.
- Nav highlights "About" as the active link.

- [ ] **Step 4: Commit**

```bash
git add about.html css/style.css
git commit -m "Add About page content"
```

---

## Task 5: Contact page content + WeChat QR asset

**Files:**
- Create: `assets/wechat-qr.png`
- Modify: `contact.html` (replace the placeholder `<main>` block from Task 1)
- Modify: `css/style.css` (append)

**Interfaces:**
- Consumes: `.container`, `.btn`, `--color-*` variables from Task 1.
- Produces: CSS classes `.contact-section`, `.contact-grid`, `.contact-email`, `.contact-wechat`, `.qr-code`.

- [ ] **Step 1: Get explicit permission before downloading the QR image**

Read the signed image URL out of the existing `qr-code.html` in the repo root. Ask the user in chat for explicit permission to download it, stating: the filename (`assets/wechat-qr.png`), the source (the signed UFile URL currently embedded in `qr-code.html`), and why (that URL expires around 2026-07-19 and the site needs a permanent local copy). Do not proceed to Step 2 without an explicit yes.

- [ ] **Step 2: Download the QR image**

Once approved, run:

```bash
mkdir -p assets
curl -sL "<the signed URL from qr-code.html>" -o assets/wechat-qr.png
```

Verify: `file assets/wechat-qr.png` reports a valid PNG image (not an HTML error page from an expired link).

- [ ] **Step 3: Replace the `<main>` block in `contact.html`**

Replace:
```html
  <main>
    <section class="container" style="padding: 80px 24px;">
      <h1>Contact</h1>
    </section>
  </main>
```

With:
```html
  <main>
    <section class="container contact-section">
      <h1>Get in Touch</h1>
      <p>Questions about a program or ready to enroll? Reach out any time.</p>

      <div class="contact-grid">
        <div class="contact-email">
          <h2>Email</h2>
          <a class="btn" href="mailto:olivistastudio@gmail.com">olivistastudio@gmail.com</a>
        </div>
        <div class="contact-wechat">
          <h2>WeChat</h2>
          <img src="assets/wechat-qr.png" alt="WeChat QR code for OliVista Art Studio" class="qr-code">
          <p>Scan to connect via WeChat</p>
        </div>
      </div>
    </section>
  </main>
```

- [ ] **Step 4: Append to `css/style.css`**

```css
.contact-section {
  padding: 60px 24px 80px;
  text-align: center;
}

.contact-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 40px;
  max-width: 560px;
  margin: 40px auto 0;
}

.qr-code {
  max-width: 200px;
  margin: 12px auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}

@media (max-width: 600px) {
  .contact-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Verify in browser**

Reload `http://localhost:8000/contact.html`. Verify:
- "Get in Touch" heading, intro line, and two-column layout (Email / WeChat) render.
- The email button opens a `mailto:` link (check `href`, don't need to actually send).
- The WeChat QR code image displays correctly (not a broken image icon) and is captioned.
- Resize to mobile width: the two columns stack.
- From `programs.html`, click a "Contact Us" button and confirm it lands here.

- [ ] **Step 6: Commit**

```bash
git add contact.html css/style.css assets/wechat-qr.png
git commit -m "Add Contact page content and WeChat QR asset"
```

---

## Task 6: Final cross-page QA pass

**Files:** None created. Reviews `index.html`, `programs.html`, `about.html`, `contact.html`, `css/style.css`.

**Interfaces:** None — this task only verifies and, if needed, patches the previous tasks' output. No new classes or ids introduced.

- [ ] **Step 1: Full-site link and nav check**

With the local server still running, visit each of the 4 pages directly and click through every nav link, logo link, teaser card, and CTA button. Confirm none produce a 404 and each page's own nav link is highlighted.

- [ ] **Step 2: Responsive check at 3 breakpoints**

Resize the browser to desktop (1280px), tablet (768px), and mobile (375px) widths on each page. Confirm: no horizontal scrollbars, the mobile nav toggle opens/closes correctly on every page, teaser cards and program sections reflow to single columns as designed, and text stays readable (no overlapping elements).

- [ ] **Step 3: Accessibility spot-check**

Confirm every `<img>` (the 3 program SVGs and the QR code) has a non-empty, descriptive `alt` attribute. Confirm heading order on each page is a single `<h1>` followed by `<h2>`s (no skipped levels).

- [ ] **Step 4: Fix any issues found**

If Steps 1-3 surface a broken link, layout overflow, or missing alt text, fix it directly in the relevant HTML/CSS file.

- [ ] **Step 5: Stop the local server and commit any fixes**

```bash
git add -A
git commit -m "Fix cross-page QA issues found during final review"
```

If Step 4 found nothing to fix, skip the commit (no changes to commit).
