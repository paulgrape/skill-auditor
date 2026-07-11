---
name: website-accessibility
description: WCAG-aligned accessibility rules for a website — image alt text, form labels, keyboard navigation, visible focus, skip links, semantic landmarks, accessible errors, reduced motion, and captions. Use when auditing or building accessible UI, forms, navigation, or media.
categories:
  - accessibility
---

# Website accessibility

WCAG-aligned rules so people of all abilities can use the site. Curated from the
[Website Specification — Accessibility](https://specification.website/checklist/) (CC BY 4.0).

## Required

- Sufficient colour contrast for text and meaningful non-text elements.
- Every `<img>` has an `alt` attribute describing its purpose (empty `alt=""` for decorative).
- Every form control has a programmatically associated `<label>`. A placeholder is not a label.
- Every interactive element is keyboard-reachable and operable, in logical order, with no focus traps.
- Visible, high-contrast focus indicator whenever a control receives keyboard focus.
- A "skip to main content" link as the first focusable element.
- Use semantic HTML and landmarks: `<header>`, `<nav>`, `<main>`, `<footer>`.
- Descriptive link text — never "click here" or "read more" alone.
- Form errors identified in text, associated with their input, and announced to assistive tech.
- Set `<html lang>` and mark inline foreign-language content with its own `lang`.
- Respect `prefers-reduced-motion` for animation, parallax, and autoplay.
- Captions for video, transcripts for audio, real `<table>` markup for tabular data.
- Touch targets at least 24x24 CSS px (44x44 enhanced).

## Avoid

- Empty links/buttons with no accessible name (icon-only controls without a label).
- Third-party "accessibility overlay" widgets.

## Example

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Full item list and rationale: https://specification.website/checklist/
