---
name: website-i18n
description: Internationalisation essentials for a website — URL structure for locales, hreflang, localised metadata, the lang attribute on inline content, language switchers, RTL support, and locale-aware formatting. Use when adding multilingual or multi-regional content to a site.
categories:
  - i18n
---

# Website internationalisation

Language, locale, direction, and translated content. Curated from the
[Website Specification — Internationalisation](https://specification.website/checklist/) (CC BY 4.0).

## Required

- Mark passages and inline elements that differ from the document language with their own `lang` attribute (WCAG 3.1.2).

## Recommended

- Pick one URL pattern for locales (ccTLD, subdomain, or subdirectory) and keep it consistent.
- `hreflang` annotations using BCP 47 codes, reciprocal across all alternates.
- Localise every visible string in the head and structured data, not just the body.
- Language switcher listing each locale in its own language ('Deutsch', '日本語'); no flags.
- RTL support: set `dir="rtl"` and use CSS logical properties for Arabic, Hebrew, Persian, Urdu.
- Locale-aware dates, numbers, currency, and plural rules via `Intl` APIs.

## Avoid

- Automatic IP-based or Accept-Language language redirects — let users choose.

Full item list and rationale: https://specification.website/checklist/
