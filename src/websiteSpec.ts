import type { WebsiteSpecItem } from './types.js'

/** Root of the Website Specification, from which every item below is curated. */
export const SPEC_SOURCE = 'https://specification.website'

function url(path: string): string {
  return `${SPEC_SOURCE}/spec/${path}/`
}

/**
 * Curated subset of the Website Specification checklist
 * (https://specification.website, CC BY 4.0).
 *
 * This is intentionally not the full ~150-item list: it holds the items the
 * `spec-check` command reasons about — either statically detectable from repo
 * files, or explicitly skipped because they require a live URL or runtime audit.
 * Item ids match the checker keys in specCompliance.ts.
 */
export const WEBSITE_SPEC_ITEMS: WebsiteSpecItem[] = [
  // Foundations
  {
    id: 'foundations.doctype',
    category: 'foundations',
    priority: 'required',
    title: 'HTML doctype',
    sourceUrl: url('foundations/doctype'),
  },
  {
    id: 'foundations.html-lang',
    category: 'foundations',
    priority: 'required',
    title: 'lang attribute on <html>',
    sourceUrl: url('foundations/html-lang'),
  },
  {
    id: 'foundations.meta-charset',
    category: 'foundations',
    priority: 'required',
    title: '<meta charset>',
    sourceUrl: url('foundations/meta-charset'),
  },
  {
    id: 'foundations.meta-viewport',
    category: 'foundations',
    priority: 'required',
    title: '<meta viewport>',
    sourceUrl: url('foundations/meta-viewport'),
  },
  {
    id: 'foundations.title',
    category: 'foundations',
    priority: 'required',
    title: '<title> element',
    sourceUrl: url('foundations/title'),
  },
  {
    id: 'foundations.meta-description',
    category: 'foundations',
    priority: 'recommended',
    title: '<meta name="description">',
    sourceUrl: url('foundations/meta-description'),
  },
  {
    id: 'foundations.canonical',
    category: 'foundations',
    priority: 'recommended',
    title: 'Canonical URL',
    sourceUrl: url('foundations/canonical-url'),
  },
  {
    id: 'foundations.favicons',
    category: 'foundations',
    priority: 'recommended',
    title: 'Favicons and app icons',
    sourceUrl: url('foundations/favicons'),
  },
  {
    id: 'foundations.color-scheme',
    category: 'foundations',
    priority: 'recommended',
    title: '<meta name="color-scheme">',
    sourceUrl: url('foundations/color-scheme'),
  },
  {
    id: 'foundations.open-graph',
    category: 'foundations',
    priority: 'recommended',
    title: 'Open Graph protocol',
    sourceUrl: url('foundations/open-graph'),
  },

  // SEO
  {
    id: 'seo.robots-txt',
    category: 'seo',
    priority: 'recommended',
    title: 'robots.txt',
    sourceUrl: url('seo/robots-txt'),
  },
  {
    id: 'seo.xml-sitemaps',
    category: 'seo',
    priority: 'recommended',
    title: 'XML sitemaps',
    sourceUrl: url('seo/xml-sitemaps'),
  },

  // Accessibility
  {
    id: 'accessibility.image-alt-text',
    category: 'accessibility',
    priority: 'required',
    title: 'Image alt text',
    sourceUrl: url('accessibility/image-alt-text'),
  },
  {
    id: 'accessibility.semantic-landmarks',
    category: 'accessibility',
    priority: 'required',
    title: 'Semantic HTML and landmarks',
    sourceUrl: url('accessibility/semantic-html'),
  },
  {
    id: 'accessibility.skip-links',
    category: 'accessibility',
    priority: 'required',
    title: 'Skip links',
    sourceUrl: url('accessibility/skip-links'),
  },
  {
    id: 'accessibility.reduced-motion',
    category: 'accessibility',
    priority: 'required',
    title: 'Reduced motion',
    sourceUrl: url('accessibility/reduced-motion'),
  },
  {
    id: 'accessibility.color-contrast',
    category: 'accessibility',
    priority: 'required',
    title: 'Colour contrast',
    sourceUrl: url('accessibility/color-contrast'),
  },
  {
    id: 'accessibility.keyboard-navigation',
    category: 'accessibility',
    priority: 'required',
    title: 'Keyboard navigation',
    sourceUrl: url('accessibility/keyboard-navigation'),
  },

  // Security
  {
    id: 'security.content-security-policy',
    category: 'security',
    priority: 'recommended',
    title: 'Content Security Policy (CSP)',
    sourceUrl: url('security/content-security-policy'),
  },
  {
    id: 'security.x-content-type-options',
    category: 'security',
    priority: 'required',
    title: 'X-Content-Type-Options: nosniff',
    sourceUrl: url('security/x-content-type-options'),
  },
  {
    id: 'security.frame-ancestors',
    category: 'security',
    priority: 'required',
    title: 'Clickjacking protection (frame-ancestors)',
    sourceUrl: url('security/frame-ancestors'),
  },
  {
    id: 'security.referrer-policy',
    category: 'security',
    priority: 'recommended',
    title: 'Referrer-Policy',
    sourceUrl: url('security/referrer-policy'),
  },
  {
    id: 'security.security-txt',
    category: 'security',
    priority: 'recommended',
    title: '/.well-known/security.txt',
    sourceUrl: url('security/security-txt'),
  },
  {
    id: 'security.https-tls',
    category: 'security',
    priority: 'required',
    title: 'HTTPS and TLS',
    sourceUrl: url('security/https-tls'),
  },
  {
    id: 'security.hsts',
    category: 'security',
    priority: 'required',
    title: 'HSTS (Strict-Transport-Security)',
    sourceUrl: url('security/hsts'),
  },

  // Performance
  {
    id: 'performance.core-web-vitals',
    category: 'performance',
    priority: 'required',
    title: 'Core Web Vitals (LCP, INP, CLS)',
    sourceUrl: url('performance/core-web-vitals'),
  },
  {
    id: 'performance.compression',
    category: 'performance',
    priority: 'required',
    title: 'Compression (gzip, brotli, zstd)',
    sourceUrl: url('performance/compression'),
  },
  {
    id: 'performance.cache-control',
    category: 'performance',
    priority: 'required',
    title: 'Cache-Control headers',
    sourceUrl: url('performance/cache-control'),
  },

  // Privacy
  {
    id: 'privacy.privacy-policy',
    category: 'privacy',
    priority: 'required',
    title: 'Privacy policy',
    sourceUrl: url('privacy/privacy-policy'),
  },
  {
    id: 'privacy.cookie-consent',
    category: 'privacy',
    priority: 'required',
    title: 'Cookie consent',
    sourceUrl: url('privacy/cookie-consent'),
  },

  // Resilience
  {
    id: 'resilience.error-pages',
    category: 'resilience',
    priority: 'required',
    title: 'Custom error pages (404, 500)',
    sourceUrl: url('resilience/error-pages'),
  },
  {
    id: 'resilience.pwa-manifest',
    category: 'resilience',
    priority: 'recommended',
    title: 'Web app manifest',
    sourceUrl: url('resilience/pwa-manifest'),
  },

  // Agent readiness
  {
    id: 'agent-readiness.llms-txt',
    category: 'agent-readiness',
    priority: 'recommended',
    title: '/llms.txt',
    sourceUrl: url('agent-readiness/llms-txt'),
  },
]
