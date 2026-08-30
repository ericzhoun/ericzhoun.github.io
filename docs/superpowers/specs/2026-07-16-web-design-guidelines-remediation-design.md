# Web Design Guidelines Remediation

## Goal

Resolve the audit findings across public OliVista pages without changing the studio's existing visual identity or enrollment flow.

## Scope

- Add shared accessibility affordances: skip links, visible keyboard focus, touch interaction defaults, and reduced-motion support.
- Improve auth form semantics with names, autocomplete, spellcheck rules, and polite status announcements.
- Make schedule loading recoverable by rendering a clear error state with a retry action when calendar data cannot load.
- Correct content semantics and image stability: valid heading structure, explicit image dimensions, actionable portfolio labels, and more descriptive image alt text.
- Replace unsafe CSS transitions and focus resets.
- Add automated static checks for the remediated markup and styles, plus targeted runtime tests for schedule failure handling.

## Design

Shared navigation markup receives a visually hidden skip link that targets each page's existing `main` element. Shared stylesheet rules provide visible `:focus-visible` outlines for links, buttons, and form fields; use `touch-action: manipulation`; and suppress nonessential transitions under `prefers-reduced-motion`.

Authentication forms retain their current interaction model. Each field gets a meaningful `name`, correct autocomplete hint, and disabled spellcheck where relevant. Existing async status regions announce updates through `aria-live="polite"`.

Schedule loading keeps the successful-calendar rendering untouched. On fetch or rendering failure, the calendar region replaces the loading message with a concise explanation and a native retry button. The retry action reruns the existing loading function and prevents visitors from being trapped at a permanent loading state.

Image-only portfolio buttons gain a label that states the program and opens the artwork preview. Page images receive intrinsic dimensions wherever assets permit. The instructor photo is no longer placed in an empty heading. Generic program image descriptions become specific to their displayed subject.

## Verification

- Automated checks prove the schedule failure state and retry behavior.
- Static checks confirm focus styles, reduced-motion handling, skip links, and required form/image attributes.
- Desktop and mobile browser checks confirm no horizontal overflow, visible focus, expandable navigation, and a usable schedule fallback.

## Non-goals

- Redesigning the public visual language or program content.
- Modifying payment, enrollment, or backend business rules.
- Changing unrelated admin behavior.
