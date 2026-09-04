---
name: website-seo
description: Search-visibility essentials for a website — robots.txt, XML sitemaps, canonical URLs, redirects, meta robots, heading hierarchy, internal linking, and JSON-LD structured data. Use when auditing or improving how crawlers and AI agents discover and index a site.
metadata:
  categories: seo
---

# Website SEO

Search visibility — robots, sitemaps, canonicals, structured data. Curated from the
[Website Specification — SEO](https://specification.website/checklist/) (CC BY 4.0).

## Required

- Use correct HTTP redirects: 301/308 for permanent moves, 302/307 for temporary; never chain more than necessary.
- Every page needs an explicit, correct indexing policy — default `index, follow` on public pages, `noindex` / `X-Robots-Tag` on staging, admin, or thin content.
- Headings form a nested outline. Never skip levels; never use headings for visual styling alone.

## Recommended

- `robots.txt` at the site root (RFC 9309).
- XML sitemap listing canonical URLs; use a sitemap index above 50,000 URLs.
- Keep URLs lowercase, hyphenated, descriptive, and shallow — treat them as a public API.
- Server-side render primary content and metadata so it is in the initial HTML response.
- Internal linking to signal topical importance.
- JSON-LD structured data using the schema.org vocabulary.
- Breadcrumbs, marked up as `BreadcrumbList` JSON-LD.

## Avoid

- Soft 404s — a "not found" page that returns `200 OK`.

## Example JSON-LD

```html
<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "Title",
    "author": { "@type": "Person", "name": "Name" }
  }
</script>
```

Full item list and rationale: https://specification.website/checklist/
