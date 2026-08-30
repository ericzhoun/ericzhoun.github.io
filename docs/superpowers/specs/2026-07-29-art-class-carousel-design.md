# Art-Class Carousel Banner Design

## Goal

Add a visual-only, auto-rotating art banner to `index.html` between the programs overview and the second philosophy teaser.

## Design

- Add an `art-class-carousel` section at the requested insertion point.
- Use the 11 WebP images in `assets/art-class`.
- Show one image at a time with a subtle crossfade every 5 seconds.
- Use a responsive banner aspect ratio with `object-fit: cover`.
- Do not add captions, dots, arrows, or other visible controls.
- Pause rotation while the carousel is hovered or focused.
- Respect `prefers-reduced-motion` by disabling automatic transitions.
- Provide concise alt text for each image and preserve keyboard accessibility.

## Implementation

Keep the carousel self-contained in `js/art-class-carousel.js` and style it in `css/style.css`. The markup will include a semantic region with a visually hidden label, one active image, and a stack of preloaded images for smooth rotation.

## Verification

- Confirm the section appears between the exact requested sections.
- Confirm images rotate automatically and pause on hover/focus.
- Confirm reduced-motion behavior.
- Check desktop and mobile layouts in a browser.
- Confirm there are no console errors.
