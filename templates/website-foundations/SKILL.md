---
name: website-foundations
description: HTML document foundations for any web page — doctype, lang, charset, viewport, title, meta description, canonical, Open Graph, and color-scheme. Use when building or auditing the document head, page shell, or root layout of a website.
categories:
  - foundations
---

# Website foundations

The HTML, head, and document basics every page needs. Curated from the
[Website Specification — Foundations](https://specification.website/checklist/) (CC BY 4.0).

## Required

- Start every document with `<!doctype html>` as the first line — opts into standards mode.
- Set a valid BCP 47 tag on `<html lang="...">` so screen readers, translators, and search engines know the language.
- Declare `<meta charset="utf-8">` within the first 1024 bytes of the HTML.
- Add `<meta name="viewport" content="width=device-width, initial-scale=1">`; never disable user scaling.
- Give every document exactly one non-empty `<title>` inside `<head>`. It is not the same as the `<h1>`.

## Recommended

- `<meta name="description">` — a short, unique per-page summary.
- Canonical URL via `<link rel="canonical" href="...">` to consolidate ranking signals.
- Favicons: SVG favicon, `/favicon.ico` fallback, `apple-touch-icon`, maskable PWA icon.
- `<meta name="theme-color">` and `<meta name="color-scheme">` to match browser chrome and prevent dark-mode flash.
- Open Graph tags (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`) on every page.

## Example head

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page name — Site</title>
    <meta name="description" content="One-sentence summary of this page." />
    <meta name="color-scheme" content="light dark" />
    <link rel="canonical" href="https://example.com/page" />
  </head>
</html>
```

Full item list and rationale: https://specification.website/checklist/
