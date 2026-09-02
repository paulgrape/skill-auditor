---
name: non-js-skill
description: A prose skill whose only code is CSS, HTML and shell. Used to check that non-JS fences never produce package or API references.
---

# Reduced motion and skip links

Respect the user's motion preference and make the first focusable element a
skip link. None of the snippets below reference an npm package, so the auditor
must treat this skill as neutral rather than as a badly aligned technical one.

## Motion

```css
@media (prefers-reduced-motion: reduce) {
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
  }
}
```

## Skip link

```html
<a class="skip-link" href="#main">Skip to main content</a>
<main id="main" tabindex="-1"></main>
```

## Checking the build

```bash
ROOT=$(git rev-parse --show-toplevel)
npx some-linter "$ROOT/public/index.html" --fix
```

Run the checker with `npx some-linter --help` when in doubt, and keep the
`prefers-reduced-motion` media query at the end of the stylesheet.
