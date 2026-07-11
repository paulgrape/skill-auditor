---
name: website-security
description: Transport and HTTP-header security for a website — HTTPS/TLS, HSTS, Content Security Policy, X-Content-Type-Options, clickjacking protection, cookie attributes, and security.txt. Use when configuring server headers, TLS, cookies, or a disclosure policy.
categories:
  - security
---

# Website security

Headers, transport, and policies that keep visitors safe. Curated from the
[Website Specification — Security](https://specification.website/checklist/) (CC BY 4.0).

## Required

- Serve every page over HTTPS with TLS 1.2 or 1.3; redirect plain HTTP to HTTPS.
- Send HSTS: `Strict-Transport-Security: max-age=...; includeSubDomains`.
- `X-Content-Type-Options: nosniff` on responses.
- Clickjacking protection via CSP `frame-ancestors` (`X-Frame-Options` as legacy fallback).
- Cookies are `Secure`, `HttpOnly` where possible, with an explicit `SameSite`; use `__Host-` / `__Secure-` prefixes.

## Recommended

- Content Security Policy restricting script, style, image, and frame sources.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` to turn off unused powerful features (camera, mic, geolocation).
- Subresource Integrity (SRI) hashes on third-party scripts and styles.
- `/.well-known/security.txt` telling researchers how to report vulnerabilities.
- DNS CAA records restricting which CAs may issue certificates.

## Example headers

```
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'self'; frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
```

Full item list and rationale: https://specification.website/checklist/
