# Contact Location Map Design

## Goal

Give prospective students a clear, interactive way to find OliVista Art Studio while preserving the existing concise Contact page.

## Approved Layout

Add a full-width `Visit Us` section after the Contact page introduction and before the existing Email and WeChat grid. This placement follows the reference page's map-first pattern while leaving the current contact options unchanged.

The section contains:

- A `Visit Us` heading.
- The address `586 Military Way, Palo Alto, CA` as a link that opens the location in Google Maps in a new tab.
- An interactive, lazy-loaded Google Maps embed centered on the same address.

## Presentation and Responsive Behavior

The map uses the site’s existing rounded, clean visual language and spans the available content width. On desktop it is a prominent landscape panel. On small screens it keeps a usable, shorter height and fills the viewport width within the existing page padding.

The Email and WeChat blocks remain a two-column grid on desktop and continue stacking on narrow screens.

## Accessibility and Resilience

The embedded frame has a descriptive title. The visible address link remains available as a direct Maps fallback if the embedded map cannot load. The embed uses `loading="lazy"` and a restrictive referrer policy. No Google Maps API key is required.

## Validation

Automated checks will confirm that the Contact page includes the exact address, an accessible Google Maps embed, the direct Maps fallback link, and the existing QR-code behavior. Manual browser checks will confirm the desktop and mobile layout, map visibility, and header/footer integrity.
