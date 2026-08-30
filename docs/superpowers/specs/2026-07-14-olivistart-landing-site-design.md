# OliVista Art Studio Website - Design Spec

Date: 2026-07-14

## Purpose

Build a static marketing website for OliVista Art Studio, to be deployed at
olivistart.com. Content is sourced from the studio's promotional flyer
(program details, contact info, branding) and, for the About page, from
https://www.herfieldphoto.com/art-class (instructor background and teaching
philosophy, reworded in OliVista's own voice). Layout and visual style are
modeled on CalColor Academy's kids programs page
(https://www.calcolor.com/program/kids#Art%20Exploration).

## Scope

A 4-page static site, no build step, no framework:

- `index.html` - Home
- `programs.html` - Programs
- `about.html` - About
- `contact.html` - Contact

Out of scope: booking/registration system, blog, multi-location support,
pricing, class schedule/hours (none of this exists for OliVista today).

## Reference site takeaways

From https://www.calcolor.com/program/kids#Art%20Exploration:

- Clean white background, bold rounded sans headings, card-based layout.
- Each program gets its own accent color, alternating left/right card
  layout: colored decorative block on one side, description + bullet list +
  age range + CTA button on the other, photo grid on the far side.
- Simple top nav (logo + links + CTA button), footer with contact details.

OliVista adapts this pattern but swaps the reference site's real class
photos for original illustrations (no photos exist for OliVista yet), and
swaps "Book a Free Trial" CTAs for "Contact Us" links (no booking system
exists).

## Pages

### Home (`index.html`)

- Hero: "OliVista Art Studio" headline, tagline "Learn to See · Explore ·
  Create", "Maximum 6 students per class" badge, CTA button to Contact.
- Three condensed program teaser cards (title, age range, one-line hook,
  color-coded), each linking to its full section on `programs.html`.
- Short philosophy pull-quote ("art is more than learning how to draw...")
  linking to `about.html`.
- Closing CTA banner linking to `contact.html`.

### Programs (`programs.html`)

Three full program sections, alternating card layout per the reference
site, each color-coded to match the flyer:

1. **Visual Discovery** (Ages 6-9) - maroon/pink accent
   Tagline: "Learn to See · Explore · Create"
   Bullets: Observation & Visual Thinking, Drawing & Painting, Shape Color &
   Composition, Theme-Based Art Projects, Inspired by the Masters, Mixed
   Media Exploration, Nature Journaling
   Description: "Cultivate observation, creativity, and artistic
   appreciation."

2. **Creative Foundations** (Ages 10-13) - olive green accent
   Tagline: "Observe · Build · Express"
   Bullets: Drawing Fundamentals, Plaster Cast Studies (Introduction), Light
   & Shadow, Perspective, Still Life Drawing, Painting Foundations, Color
   Theory, Personal Projects
   Description: "Strengthen observational drawing, technical skills, and
   visual expression."

3. **Portfolio Studio** (Ages 14-17) - gold/mustard accent
   Tagline: "Develop · Refine · Express"
   Bullets: Advanced Drawing, Creative Drawing, Plaster Cast Studies,
   Pre-Portfolio Development, Portfolio Development, Personal Projects,
   One-on-One Portfolio Mentoring Available
   Description: "Develop an individual artistic voice while preparing a
   competitive portfolio for college admission."

Each section ends with a "Contact Us" button linking to `contact.html`
(no booking system exists, so CTAs route to Contact rather than mailto).

### About (`about.html`)

Content adapted (not copied verbatim) from
https://www.herfieldphoto.com/art-class:

- Instructor background: practicing art since childhood, formal training
  starting in 4th grade (sketching, gouache), practice spanning oil
  painting, ceramics, and photography; experience teaching sketching,
  color painting, ceramics, and creative projects to individuals and
  groups, including National Art Entrance Examination preparation.
- Teaching philosophy: "art is more than learning how to draw" - emphasis
  on observation, creative thinking, and student confidence.
- What students develop: visual language and artistic elements, observation
  and visual thinking, awareness of global artists and styles, creative
  self-expression.
- Small class size (max 6 students) framed as a teaching-philosophy choice,
  not just a logistics detail.

### Contact (`contact.html`)

- "Get in Touch" heading.
- Mailto link: olivistastudio@gmail.com.
- WeChat QR code image with caption "Scan to connect via WeChat."

## Visual design system

- **Colors**: three program accent colors sampled from the flyer (maroon/
  pink, olive green, gold/mustard - exact hex values to be picked by eye
  against the flyer image during implementation), neutral off-white
  background, dark charcoal body text.
- **Type**: Poppins (Google Fonts) for headings, system sans-serif stack
  for body text.
- **Imagery**: original SVG line-art illustrations per program (no stock
  photos, no copyright concerns, no external image hosting dependency):
  - Visual Discovery: sketchbook / nature-journal motif
  - Creative Foundations: still-life / plaster-bust motif
  - Portfolio Studio: portfolio / sketchbook-spread motif
- **Layout**: alternating left/right cards on Programs page, matching the
  reference site; collapses to a single stacked column on mobile.

## Assets

- The WeChat QR code currently lives only as a temporary signed URL in the
  existing `qr-code.html` (expires ~2026-07-19). It must be downloaded and
  saved locally as `assets/wechat-qr.png` before that URL expires. This
  requires explicit user permission to download, per the file-download
  policy - to be confirmed at implementation time.

## File structure

```
/
├── index.html
├── programs.html
├── about.html
├── contact.html
├── css/
│   └── style.css
├── js/
│   └── nav.js          (mobile nav toggle only)
└── assets/
    ├── wechat-qr.png
    └── *.svg            (original program illustrations)
```

Header/nav and footer markup is duplicated by hand across the four HTML
files - no templating layer, consistent with the plain-HTML/CSS/JS choice
for a 4-page site.

## Explicitly out of scope

- Booking/registration system or online payments.
- Multiple studio locations, business hours, phone number (none exist).
- Pricing information (not provided).
- Blog or news section.
- Build tooling / static site generator / JS framework.
