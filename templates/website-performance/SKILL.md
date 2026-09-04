---
name: website-performance
description: Web performance essentials — Core Web Vitals, image optimisation, lazy loading, resource hints, Cache-Control, compression, font loading, and script loading attributes. Use when improving load speed, caching, images, fonts, or Core Web Vitals on a website.
metadata:
  categories: performance
---

# Website performance

Core Web Vitals, caching, images, fonts, network behaviour. Curated from the
[Website Specification — Performance](https://specification.website/checklist/) (CC BY 4.0).

## Required

- Hit Core Web Vitals at the 75th percentile: LCP <= 2.5s, INP <= 200ms, CLS <= 0.1.
- Serve images in modern formats (WebP, AVIF), sized for the viewport, with explicit dimensions.
- Set `Cache-Control`: `immutable, max-age=31536000` for fingerprinted assets; short/no-cache for HTML.
- Compress text responses (brotli where supported, gzip elsewhere); do not recompress media.

## Recommended

- Native lazy loading (`loading="lazy"`) for off-screen images/iframes — never on the LCP element.
- Resource hints: preload the LCP image and critical fonts, preconnect to third-party origins.
- Conditional requests: send `ETag` / `Last-Modified`, honour `If-None-Match` / `If-Modified-Since`.
- Self-host subsetted WOFF2 fonts with `font-display: swap`.
- Inline critical CSS; defer the rest.
- Choose the right `<script>` attribute: `defer` for app code, `async` for independent third-party, `type="module"` for modern code.
- Serve over HTTP/2 at minimum, HTTP/3 where possible.

## Avoid

- HTTP/1.1 workarounds under HTTP/2+: domain sharding and image sprites.

## Example

```html
<link rel="preload" as="image" href="/hero.avif" />
<img src="/below-fold.avif" width="800" height="600" loading="lazy" alt="..." />
```

Full item list and rationale: https://specification.website/checklist/
