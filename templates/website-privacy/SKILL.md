---
name: website-privacy
description: Privacy and consent essentials for a website — privacy policy, cookie consent, Global Privacy Control, third-party script auditing, privacy-respecting analytics, and data minimisation. Use when handling personal data, consent flows, analytics, or third-party scripts.
categories:
  - privacy
---

# Website privacy

Consent, signals, and respecting visitor choice. Curated from the
[Website Specification — Privacy](https://specification.website/checklist/) (CC BY 4.0).

## Required

- Publish a privacy policy: what data you collect, why, legal basis, sharing, retention, and user rights.
- In the EU/UK, obtain freely given, informed, specific, unambiguous opt-in consent before setting non-essential cookies or storage.

## Recommended

- Honour the Global Privacy Control (`Sec-GPC`) signal — required in California and Colorado.
- Audit, justify, and lock down every third-party script (each can read cookies and exfiltrate data).
- Prefer aggregate, cookieless, EU-hosted analytics.
- Data minimisation: collect only what you need, keep it only as long as you need it.

## Optional

- Storage Access API for embedded cross-site content under a user gesture.

Full item list and rationale: https://specification.website/checklist/
