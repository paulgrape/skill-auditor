---
name: website-resilience
description: Graceful-failure essentials for a website — custom error pages with correct status codes, 503 maintenance pages, graceful degradation without JavaScript, web app manifest, and uptime monitoring. Use when building error pages, offline behaviour, or resilience of a site.
categories:
  - resilience
---

# Website resilience

Graceful failure — error pages, offline, redirects. Curated from the
[Website Specification — Resilience](https://specification.website/checklist/) (CC BY 4.0).

## Required

- Custom error pages (404, 500) that return the correct HTTP status, explain what went wrong in plain language, and offer a way forward without leaking implementation details.

## Recommended

- Maintenance pages return `HTTP 503` with a `Retry-After` header.
- Graceful degradation: core content and primary navigation keep working when JavaScript fails.
- Web app manifest (`manifest.json`) declaring name, icons, start URL, theme colour, display mode.
- Monitor uptime from outside your own infrastructure; run a status page on a separate host.

## Optional

- Service worker serving a cached offline fallback page.

Full item list and rationale: https://specification.website/checklist/
