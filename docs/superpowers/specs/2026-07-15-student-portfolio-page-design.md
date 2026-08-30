# Student Portfolio Page Design

## Purpose

Add a "Students' Work" portfolio page to the OliVista Art Studio site, similar in structure to [calcolor.com/portfolio](https://www.calcolor.com/portfolio), showcasing student artwork grouped by program.

## Reference pattern (CalColor)

- Page titled "Students' Work."
- Content grouped into program categories, each with sub-sections per class (class name + age badge).
- Each class sub-section shows a horizontally scrolling row of artwork thumbnails.

## Technical approach

OliVista's site is fully static: plain HTML, one shared `css/style.css`, and one small vanilla-JS file per page-level feature (e.g. `js/nav.js`, `js/enroll.js`). No framework, no build step, no external JS/CSS dependencies. The portfolio page follows this exact pattern:

- New `portfolio.html`, reusing the header/nav/footer markup already present in `programs.html`.
- CSS-only horizontal scroll rows: `overflow-x: auto` + `scroll-snap-type: x mandatory` on each program's image row. No carousel library.
- A small new `js/portfolio.js` for the lightbox, using a native `<dialog>` element (no external modal library).
- Reuse existing CSS custom properties (`--color-visual-discovery`, `--color-creative-foundations`, `--color-portfolio-studio`, `--radius`, fonts) rather than introducing new tokens.

## Page structure

1. Header/nav/footer identical to other pages, with a new `Portfolio` link added to `site-nav`.
2. Intro section: `<h1>Students' Work</h1>` + one-line subhead, styled like `programs-intro` on `programs.html`.
3. Three program sections, in age order:
   - Visual Discovery (Ages 6-9)
   - Creative Foundations (Ages 10-13)
   - Portfolio Studio (Ages 14-17)

   Each section has:
   - A heading with the program name and an age badge (reusing the `teaser-age` / `age-mapping-badge` visual style), accented with that program's existing brand color.
   - A horizontally scrollable row of image thumbnails drawn from `assets/art-class/`.

## Image assignment

The ~16 images currently in `assets/art-class/` (`artPortfolio1-10.jpg`, `artExhibition1-2.jpg`, `artJourney.jpg`, `artPhilosophy.jpg`, `kids_draw1-2.png`) are not tagged to a specific program. They will be split roughly evenly (5-6 per section) across the three program sections, using filename as a loose signal:

- `kids_draw1.png`, `kids_draw2.png`, and lower-numbered `artPortfolio*` images skew toward **Visual Discovery**.
- Middle `artPortfolio*` images, `artJourney.jpg`, `artPhilosophy.jpg` skew toward **Creative Foundations**.
- Higher-numbered `artPortfolio*` images and `artExhibition1-2.jpg` skew toward **Portfolio Studio**.

Captions are generic ("Student artwork") since there is no real per-piece metadata to display. This is a placeholder arrangement — the owner can later provide real per-student/per-class tagging and swap images as actual class photos become available.

## Lightbox behavior

- Clicking a thumbnail opens a `<dialog>` showing the enlarged image on a dark overlay.
- A visible close (×) button and click-outside-to-close both dismiss it.
- No image navigation (next/prev) within the lightbox — out of scope for this pass.

## Navigation changes

Add `<a href="portfolio.html">Portfolio</a>` to the `site-nav` block, positioned between `Programs` and `Schedule`, in every page that currently has this nav block: `index.html`, `programs.html`, `schedule.html`, `about.html`, `contact.html`, `account.html`, `login.html`, `signup.html`, `enroll.html`, `registration.html`.

## Out of scope

- Real per-student/per-class image tagging (placeholder assignment only, see above).
- Lightbox next/prev navigation.
- CMS or dynamic image loading — images remain hardcoded `<img>` tags, matching the rest of the site.
- Digital Art or other program categories not currently offered by OliVista (CalColor has these; OliVista only has the three existing programs).
