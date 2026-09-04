import fg from 'fast-glob'
import * as fs from 'fs'
import * as path from 'path'
import { DEFAULT_IGNORE } from './ignore.js'
import { WEBSITE_SPEC_ITEMS } from './websiteSpec.js'
import type {
  ComplianceFinding,
  ComplianceReport,
  ComplianceStatus,
  SpecPriority,
} from './types.js'

interface FileText {
  rel: string
  content: string
}

interface ScanContext {
  files: string[]
  headSources: FileText[]
  markupFiles: FileText[]
  styleText: string
  headerConfigText: string
  headerConfigFiles: string[]
  isNext: boolean
}

type CheckResult = { status: ComplianceStatus; message: string; files?: string[] }
type Checker = (ctx: ScanContext) => CheckResult

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

function readMany(root: string, rels: string[]): FileText[] {
  const out: FileText[] = []
  for (const rel of rels) {
    const content = readText(root, rel)
    if (content !== null) out.push({ rel, content })
  }
  return out
}

function buildContext(projectRoot: string): ScanContext {
  const files = fg.sync(['**/*'], {
    cwd: projectRoot,
    ignore: DEFAULT_IGNORE,
    onlyFiles: true,
    dot: true,
  })

  const headRels = files.filter(f =>
    /(^|\/)(layout|_document|__root)\.(tsx|jsx|ts|js)$|(^|\/)(index|app|404)\.html$|(^|\/)\+layout\.svelte$/i.test(
      f,
    ),
  )
  const markupRels = files.filter(f => /\.(tsx|jsx|html|vue|svelte|astro)$/i.test(f))
  const styleRels = files.filter(f => /\.(css|scss|sass|less)$/i.test(f))
  const headerRels = files.filter(f =>
    /(^|\/)next\.config\.[a-z]+$|(^|\/)vercel\.json$|(^|\/)netlify\.toml$|(^|\/)_headers$|(^|\/)\.htaccess$|(^|\/)middleware\.(ts|js)$|(^|\/)staticwebapp\.config\.json$|(^|\/)firebase\.json$/i.test(
      f,
    ),
  )

  const headSources = readMany(projectRoot, headRels)
  const markupFiles = readMany(projectRoot, markupRels)
  const headerConfig = readMany(projectRoot, headerRels)
  const styleText = [
    ...readMany(projectRoot, styleRels),
    ...markupFiles,
  ]
    .map(f => f.content)
    .join('\n')

  let isNext = false
  const pkgRaw = readText(projectRoot, 'package.json')
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      isNext = 'next' in deps
    } catch {
      // ignore malformed package.json
    }
  }

  return {
    files,
    headSources,
    markupFiles,
    styleText,
    headerConfigText: headerConfig.map(f => f.content).join('\n'),
    headerConfigFiles: headerConfig.map(f => f.rel),
    isNext,
  }
}

function filesMatching(ctx: ScanContext, re: RegExp): string[] {
  return ctx.files.filter(f => re.test(f))
}

/** Builds a checker that greps the concatenated head source for any pattern. */
function headChecker(
  patterns: RegExp[],
  okMsg: string,
  failMsg: string,
  nextInjectsDefault = false,
): Checker {
  return ctx => {
    if (ctx.headSources.length === 0)
      return {
        status: 'skip',
        message: 'No document head source (layout, _document, or index.html) found to inspect.',
      }
    const text = ctx.headSources.map(f => f.content).join('\n')
    const files = ctx.headSources.map(f => f.rel)
    if (patterns.some(p => p.test(text)))
      return { status: 'pass', message: okMsg, files }
    if (nextInjectsDefault && ctx.isNext)
      return {
        status: 'skip',
        message: 'Next.js injects a sensible default; declare it explicitly to be sure.',
        files,
      }
    return { status: 'fail', message: failMsg, files }
  }
}

/** Builds a checker that passes when any project file matches the pattern. */
function fileExistsChecker(re: RegExp, okMsg: string, failMsg: string): Checker {
  return ctx => {
    const matches = filesMatching(ctx, re)
    return matches.length > 0
      ? { status: 'pass', message: okMsg, files: matches.slice(0, 5) }
      : { status: 'fail', message: failMsg }
  }
}

/** Builds a checker that greps the concatenated header-config files for a pattern. */
function headerChecker(pattern: RegExp, okMsg: string, failMsg: string): Checker {
  return ctx => {
    if (ctx.headerConfigFiles.length === 0)
      return {
        status: 'skip',
        message:
          'No header config (next.config, vercel.json, netlify.toml, _headers) found; headers may be set at the CDN/host.',
      }
    return pattern.test(ctx.headerConfigText)
      ? { status: 'pass', message: okMsg, files: ctx.headerConfigFiles }
      : { status: 'fail', message: failMsg, files: ctx.headerConfigFiles }
  }
}

const IMG_TAG_RE = /<img\b[^>]*>/gi

const CHECKERS: Record<string, Checker> = {
  'foundations.doctype': ctx => {
    const htmlFiles = ctx.headSources.filter(f => f.rel.endsWith('.html'))
    if (htmlFiles.length === 0)
      return {
        status: 'skip',
        message: 'No static HTML entry file found; the doctype is framework-injected.',
      }
    const files = htmlFiles.map(f => f.rel)
    return htmlFiles.some(f => /^\s*<!doctype html/i.test(f.content))
      ? { status: 'pass', message: 'HTML entry declares <!doctype html>.', files }
      : { status: 'fail', message: 'HTML entry is missing <!doctype html> as its first line.', files }
  },
  'foundations.html-lang': headChecker(
    [/<html[^>]*\blang[=]/i],
    'Root <html> sets a lang attribute.',
    'No lang attribute found on the root <html> element.',
  ),
  'foundations.meta-charset': headChecker(
    [/charset\s*=/i],
    'Document declares a character encoding.',
    'No <meta charset> found in the document head.',
    true,
  ),
  'foundations.meta-viewport': headChecker(
    [/name=["']viewport["']/i, /\bviewport\s*[:=]/],
    'Document sets a viewport meta.',
    'No viewport meta found in the document head.',
    true,
  ),
  'foundations.title': headChecker(
    [/<title[^>]*>\s*\S/i, /\btitle\s*:\s*["'`]/],
    'Document defines a title.',
    'No <title> or metadata title found.',
  ),
  'foundations.meta-description': headChecker(
    [/name=["']description["']/i, /\bdescription\s*:\s*["'`]/],
    'Document sets a meta description.',
    'No meta description found.',
  ),
  'foundations.canonical': headChecker(
    [/rel=["']canonical["']/i, /\bcanonical\s*:/i],
    'Document declares a canonical URL.',
    'No canonical URL found.',
  ),
  'foundations.favicons': fileExistsChecker(
    /(^|\/)(favicon\.(ico|svg)|apple-touch-icon\.png)$|(^|\/)app\/(icon|favicon|apple-icon)\.[a-z0-9]+$/i,
    'Favicon or app icon present.',
    'No favicon (favicon.ico/.svg, apple-touch-icon, or app/icon) found.',
  ),
  'foundations.color-scheme': headChecker(
    [/name=["']color-scheme["']/i, /\bcolorScheme\s*:/],
    'Document declares a color-scheme.',
    'No color-scheme meta found.',
  ),
  'foundations.open-graph': headChecker(
    [/property=["']og:/i, /\bopenGraph\s*:/],
    'Document sets Open Graph tags.',
    'No Open Graph (og:*) tags found.',
  ),

  'seo.robots-txt': fileExistsChecker(
    /(^|\/)robots\.txt$|(^|\/)(app|pages)\/robots\.(ts|js|tsx|jsx)$/i,
    'robots.txt (static or generated) present.',
    'No robots.txt found in public/, static/, or app/.',
  ),
  'seo.xml-sitemaps': fileExistsChecker(
    /(^|\/)sitemap(-index)?\.xml$|(^|\/)(app|pages)\/sitemap\.(ts|js|tsx|jsx)$/i,
    'XML sitemap (static or generated) present.',
    'No sitemap.xml or app/sitemap route found.',
  ),

  'accessibility.image-alt-text': ctx => {
    const offenders: string[] = []
    for (const f of ctx.markupFiles) {
      const tags = f.content.match(IMG_TAG_RE)
      if (tags && tags.some(t => !/\balt\s*=/i.test(t))) offenders.push(f.rel)
    }
    if (offenders.length > 0)
      return {
        status: 'fail',
        message: `Found <img> elements without an alt attribute in ${offenders.length} file(s).`,
        files: offenders.slice(0, 5),
      }
    return { status: 'pass', message: 'No <img> elements missing alt attributes.' }
  },
  'accessibility.semantic-landmarks': ctx => {
    if (ctx.markupFiles.length === 0)
      return { status: 'skip', message: 'No markup files found to inspect for landmarks.' }
    const files = ctx.markupFiles
      .filter(f => /<main\b/i.test(f.content))
      .map(f => f.rel)
    return files.length > 0
      ? { status: 'pass', message: 'A <main> landmark is present.', files: files.slice(0, 5) }
      : { status: 'fail', message: 'No <main> landmark found in any markup file.' }
  },
  'accessibility.skip-links': ctx => {
    if (ctx.markupFiles.length === 0)
      return { status: 'skip', message: 'No markup files found to inspect for skip links.' }
    const re = /href=["']#(main|content|main-content|skip)["']|class(Name)?=["'][^"']*skip-link|>\s*skip to (main )?content/i
    const files = ctx.markupFiles.filter(f => re.test(f.content)).map(f => f.rel)
    return files.length > 0
      ? { status: 'pass', message: 'A skip link is present.', files: files.slice(0, 5) }
      : { status: 'fail', message: 'No "skip to main content" link found.' }
  },
  'accessibility.reduced-motion': ctx => {
    if (!ctx.styleText)
      return { status: 'skip', message: 'No CSS or markup found to inspect for reduced motion.' }
    return /prefers-reduced-motion/i.test(ctx.styleText)
      ? { status: 'pass', message: 'A prefers-reduced-motion media query is present.' }
      : { status: 'fail', message: 'No prefers-reduced-motion handling found in CSS.' }
  },

  'security.content-security-policy': headerChecker(
    /content-security-policy/i,
    'A Content-Security-Policy is configured.',
    'No Content-Security-Policy found in header config.',
  ),
  'security.x-content-type-options': headerChecker(
    /x-content-type-options/i,
    'X-Content-Type-Options is configured.',
    'No X-Content-Type-Options: nosniff found in header config.',
  ),
  'security.frame-ancestors': headerChecker(
    /frame-ancestors|x-frame-options/i,
    'Clickjacking protection (frame-ancestors/X-Frame-Options) is configured.',
    'No frame-ancestors or X-Frame-Options found in header config.',
  ),
  'security.referrer-policy': headerChecker(
    /referrer-policy/i,
    'A Referrer-Policy is configured.',
    'No Referrer-Policy found in header config.',
  ),
  'security.security-txt': fileExistsChecker(
    /(^|\/)\.well-known\/security\.txt$/i,
    '/.well-known/security.txt is present.',
    'No /.well-known/security.txt found.',
  ),

  'privacy.privacy-policy': fileExistsChecker(
    /(^|\/)privacy(-policy)?(\/|\.|$)/i,
    'A privacy policy page/route is present.',
    'No privacy policy page or route found (looked for a "privacy" path).',
  ),

  'resilience.error-pages': fileExistsChecker(
    /(^|\/)app\/not-found\.(tsx|jsx|ts|js)$|(^|\/)pages\/404\.(tsx|jsx|ts|js)$|(^|\/)(public\/)?404\.html$|\+error\.svelte$/i,
    'A custom error/404 page is present.',
    'No custom 404/not-found page found.',
  ),
  'resilience.pwa-manifest': fileExistsChecker(
    /(^|\/)(manifest\.(json|webmanifest)|site\.webmanifest)$|(^|\/)app\/manifest\.(ts|js|json|webmanifest)$/i,
    'A web app manifest is present.',
    'No web app manifest (manifest.json/.webmanifest) found.',
  ),

  'agent-readiness.llms-txt': fileExistsChecker(
    /(^|\/)llms(-full)?\.txt$/i,
    'An llms.txt file is present.',
    'No /llms.txt found.',
  ),
}

const SKIP_REASONS: Record<string, string> = {
  'security.https-tls': 'Requires probing the live deployment; not detectable from source.',
  'security.hsts': 'Sent by the production server/CDN; not reliably detectable from source.',
  'performance.core-web-vitals': 'Requires a runtime performance audit (Lighthouse/field data).',
  'performance.compression': 'Negotiated by the server/CDN at runtime; not detectable from source.',
  'performance.cache-control': 'Typically set by the host/CDN at runtime; not detectable from source.',
  'accessibility.color-contrast': 'Requires rendering and computing luminance; not detectable from source.',
  'accessibility.keyboard-navigation': 'Requires interactive testing; not statically detectable.',
  'privacy.cookie-consent': 'Consent UX and legal basis require human review.',
}

export function runSpecCompliance(
  projectRoot: string,
  priorityFilter?: SpecPriority,
): ComplianceReport {
  const ctx = buildContext(projectRoot)
  const findings: ComplianceFinding[] = []

  for (const item of WEBSITE_SPEC_ITEMS) {
    if (priorityFilter && item.priority !== priorityFilter) continue

    const checker = CHECKERS[item.id]
    let result: CheckResult
    if (checker) {
      result = checker(ctx)
    } else {
      result = {
        status: 'skip',
        message: SKIP_REASONS[item.id] ?? 'Not statically detectable in this version.',
      }
    }

    findings.push({
      id: item.id,
      category: item.category,
      priority: item.priority,
      status: result.status,
      title: item.title,
      message: result.message,
      files: result.files ?? [],
      sourceUrl: item.sourceUrl,
    })
  }

  const summary = { pass: 0, fail: 0, skip: 0 }
  for (const f of findings) summary[f.status]++

  return { summary, findings }
}
