---
name: website-agent-readiness
description: Agent- and crawler-readiness for a website — stable URLs, structured data for agents, machine-readable formats, llms.txt, per-page Markdown endpoints, robots controls for AI crawlers, and well-known URIs. Use when making a site legible to AI agents and LLMs, or publishing machine-readable endpoints.
metadata:
  categories: agent-readiness
---

# Website agent readiness

Things that make a site legible to AI agents and crawlers, plus well-known URIs. Curated from the
[Website Specification — Agent Readiness](https://specification.website/checklist/) (CC BY 4.0).

## Required

- Stable URLs. Once published, they should keep working — breaking them invalidates citations, bookmarks, and agent caches.

## Recommended

- `/llms.txt` — a curated markdown index of your most important content.
- Per-page Markdown source endpoints (`.md` suffix or content negotiation) so agents pull source instead of parsing HTML.
- JSON-LD structured data with schema.org types, giving agents typed facts.
- Machine-readable formats (JSON, RSS, markdown) alongside HTML where it makes sense.
- Explicit allow/disallow per named AI crawler user-agent in `robots.txt`.
- HTTP `Link` headers advertising `llms.txt`, sitemap, api-catalog, RSS.
- Agent Skills discovery via a well-known URI.

## Well-known URIs

- `/.well-known/` is the standardised place for site-level metadata (RFC 8615).
- `/.well-known/security.txt` for vulnerability disclosure (see the security skill).
- `/.well-known/change-password` only if the site has user accounts.

Full item list and rationale: https://specification.website/checklist/
