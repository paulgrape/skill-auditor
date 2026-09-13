import fg from 'fast-glob'
import * as fs from 'fs'
import * as path from 'path'
import {
  declaredCategories,
  frontmatterString,
  parseFrontmatter,
} from './frontmatter.js'
import { topLevelPackage } from './packageNames.js'
import { isPythonStdlib } from './pythonStdlib.js'
import { isKnownPackage, PROSE_MIN_WORDS } from './taxonomy.js'
import type {
  PackageReference,
  ReferenceSubstantiation,
  SkillIdentifiers,
  SourceLocation,
} from './types.js'

/** Matches fenced code blocks, capturing the info-string language and body. */
const FENCED_BLOCK_RE = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g
/** Matches inline code spans: `like this` */
const INLINE_CODE_RE = /`([^`\n]+)`/g

/**
 * Which extraction rules apply to a fenced block, decided by its language
 * tag. Only JS/TS-family code can carry npm imports and API calls; running
 * the JS regexes over CSS, HTML or shell turns `@media (` and `$(` into
 * "API calls" and pushes a prose skill out of the neutral bucket. Untagged
 * fences get both the JS and the Python rules, since many skills omit the tag.
 */
type FenceLanguage = 'js' | 'python' | 'untagged' | 'other'

const JS_FENCE_TAGS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'javascript',
  'typescript',
])
const PYTHON_FENCE_TAGS = new Set(['py', 'python', 'python3'])

function classifyFence(tag: string): FenceLanguage {
  const normalized = tag.toLowerCase()
  if (normalized === '') return 'untagged'
  if (JS_FENCE_TAGS.has(normalized)) return 'js'
  if (PYTHON_FENCE_TAGS.has(normalized)) return 'python'
  return 'other'
}

/** import ... from "pkg"  |  import "pkg" */
const IMPORT_FROM_RE = /import\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g
/** require("pkg") */
const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g
/** Python: import pkg | from pkg import x */
const PY_IMPORT_RE = /(?:^|\n)\s*(?:import|from)\s+([\w.]+)/g
/** Bare API-call-shaped identifiers: someFunction( or useSomething( */
const API_CALL_RE = /\b([a-zA-Z_$][\w$]*)\s*\(/g

const SUBSTANTIATION_RANK: Record<ReferenceSubstantiation, number> = {
  mention: 0,
  fenced: 1,
  usage: 2,
}

/**
 * One binding introduced by an import clause. `source` is the name exported
 * by the package (what the repo scan records for named imports) and `local`
 * is the identifier the snippet uses; they differ only for `a as b`.
 */
interface ImportBinding {
  source: string
  local: string
}

/**
 * Parses the bindings introduced by a JS import statement's clause, e.g.
 * `import Default, { a, b as c } from 'x'` ->
 * [{Default}, {a}, {source: "b", local: "c"}].
 * Returns [] for side-effect imports (`import 'x'`). Default and namespace
 * imports have no source name of their own, so their local name stands in.
 */
function importBindings(importStatement: string): ImportBinding[] {
  const clauseMatch = importStatement.match(
    /import\s+([\w*{}\s,$]+?)\s+from\s+["']/,
  )
  if (!clauseMatch) return []
  const clause = clauseMatch[1]
  const bindings: ImportBinding[] = []

  const namespace = clause.match(/\*\s+as\s+([\w$]+)/)
  if (namespace) bindings.push({ source: namespace[1], local: namespace[1] })

  const braces = clause.match(/\{([^}]*)\}/)
  if (braces) {
    for (const part of braces[1].split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const asMatch = trimmed.match(/^([\w$]+)\s+as\s+([\w$]+)$/)
      if (asMatch) {
        bindings.push({ source: asMatch[1], local: asMatch[2] })
      } else {
        const name = trimmed.split(/\s+/)[0]
        bindings.push({ source: name, local: name })
      }
    }
  }

  const defaultName = clause
    .replace(/\{[^}]*\}/g, '')
    .replace(/\*\s+as\s+[\w$]+/g, '')
    .split(',')
    .map(s => s.trim())
    .find(s => /^[\w$]+$/.test(s))
  if (defaultName) bindings.push({ source: defaultName, local: defaultName })

  return bindings
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True if `identifier` appears as a standalone identifier anywhere in `code`.
 * Lookarounds instead of `\b` so `$store`-style names, which start with a
 * non-word character, still match on identifier boundaries.
 */
function identifierUsedIn(code: string, identifier: string): boolean {
  const re = new RegExp(`(?<![\\w$])${escapeRegExp(identifier)}(?![\\w$])`)
  return re.test(code)
}

interface CodeAnalysis {
  /** package -> best substantiation tier found in this code */
  packages: Map<string, ReferenceSubstantiation>
  /** package -> imported binding names */
  importedIdentifiers: Map<string, Set<string>>
  importSpecifiers: Set<string>
  apiCalls: Set<string>
  /** import statements whose bindings are never used below them */
  unusedImportCount: number
}

function emptyAnalysis(): CodeAnalysis {
  return {
    packages: new Map(),
    importedIdentifiers: new Map(),
    importSpecifiers: new Set(),
    apiCalls: new Set(),
    unusedImportCount: 0,
  }
}

/**
 * Analyzes one code snippet (fenced block, inline span or bundled script
 * file) with the rules for its language. Distinguishes imports whose bindings
 * are actually used ('usage') from imports that just sit there ('fenced') —
 * the latter is the cheapest way to stuff references into a skill, so it is
 * worth almost nothing.
 */
function analyzeCode(code: string, language: FenceLanguage): CodeAnalysis {
  if (language === 'other') return emptyAnalysis()
  if (language === 'python') return analyzePython(code)
  const result = analyzeJavaScript(code)
  if (language === 'untagged') {
    for (const [pkg, tier] of analyzePython(code).packages) {
      if (!result.packages.has(pkg)) result.packages.set(pkg, tier)
    }
  }
  return result
}

/**
 * Python snippets can only tell us which modules they import. There is no
 * npm-side ground truth to verify them against, so they count as fenced
 * references at most; stdlib modules are not packages and are dropped.
 */
function analyzePython(code: string): CodeAnalysis {
  const result = emptyAnalysis()
  for (const m of code.matchAll(PY_IMPORT_RE)) {
    // Skip JS imports that also match this pattern ("import Link from '...'"):
    // JS import lines always quote the module specifier, Python's never do.
    const lineStart = code.lastIndexOf('\n', m.index ?? 0) + 1
    const lineEnd = code.indexOf('\n', (m.index ?? 0) + 1)
    const line = code.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    if (/["']/.test(line)) continue

    const pkg = m[1].split('.')[0]
    if (!pkg || isPythonStdlib(pkg)) continue
    result.packages.set(pkg, 'fenced')
  }
  return result
}

function analyzeJavaScript(code: string): CodeAnalysis {
  const result = emptyAnalysis()

  const upgrade = (pkg: string, tier: ReferenceSubstantiation) => {
    const current = result.packages.get(pkg)
    if (!current || SUBSTANTIATION_RANK[tier] > SUBSTANTIATION_RANK[current]) {
      result.packages.set(pkg, tier)
    }
  }

  for (const m of code.matchAll(IMPORT_FROM_RE)) {
    const specifier = m[1]
    const pkg = topLevelPackage(specifier)
    if (!pkg) continue
    result.importSpecifiers.add(specifier)

    const bindings = importBindings(m[0])
    const codeAfterImport =
      code.slice(0, m.index) + code.slice((m.index ?? 0) + m[0].length)
    // Usage is judged by the local name the snippet actually writes...
    const used = bindings.filter(b => identifierUsedIn(codeAfterImport, b.local))

    // ...while verification against the repo compares source names, which is
    // what the repo scan records for named imports.
    if (bindings.length > 0) {
      const ids = result.importedIdentifiers.get(pkg) ?? new Set<string>()
      for (const b of bindings) ids.add(b.source)
      result.importedIdentifiers.set(pkg, ids)
    }

    if (bindings.length > 0 && used.length === 0) {
      result.unusedImportCount++
      upgrade(pkg, 'fenced')
    } else if (used.length > 0) {
      upgrade(pkg, 'usage')
    } else {
      // side-effect import — can't verify usage, treat as fenced
      upgrade(pkg, 'fenced')
    }
  }

  for (const m of code.matchAll(REQUIRE_RE)) {
    const specifier = m[1]
    const pkg = topLevelPackage(specifier)
    if (!pkg) continue
    result.importSpecifiers.add(specifier)
    // A bare require() call is at least fenced-level evidence; if its result
    // is assigned and the variable reused, the API_CALL/identifier heuristics
    // don't track it, so stay conservative.
    upgrade(pkg, 'fenced')
  }

  for (const m of code.matchAll(API_CALL_RE)) {
    // Filter out generic JS keywords/control-flow that aren't real API surface.
    const KEYWORDS = new Set([
      'if',
      'for',
      'while',
      'switch',
      'catch',
      'function',
      'return',
    ])
    if (!KEYWORDS.has(m[1])) result.apiCalls.add(m[1])
  }

  return result
}

const SHELL_FENCE_TAGS = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'powershell',
  'pwsh',
  'console',
  'terminal',
  'cmd',
  'bat',
])

interface FencedBlock {
  language: FenceLanguage
  /** Raw info-string tag, lower-cased */
  tag: string
  code: string
  /** 1-based line of the opening fence in the document */
  line: number
}

interface InlineSpan {
  text: string
  /** 1-based line the span sits on in the document */
  line: number
}

interface MarkdownSection {
  /** Nearest heading text, without `#` markers, when the section has one */
  heading?: string
  /** Words of prose in the section (code stripped) */
  proseWords: number
  fencedBlocks: FencedBlock[]
  inlineSpans: InlineSpan[]
}

function countNewlines(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') count++
  return count
}

/**
 * Splits a markdown body into heading-delimited sections so references can be
 * judged against the prose that actually explains them, keeping the document
 * line of every fence and inline span so findings can point at them.
 */
function splitSections(body: string, firstLine: number): MarkdownSection[] {
  const lines = body.split('\n')
  const chunks: { lines: string[]; startLine: number }[] = []
  let current: string[] = []
  let currentStart = firstLine
  lines.forEach((line, index) => {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      chunks.push({ lines: current, startLine: currentStart })
      current = []
      currentStart = firstLine + index
    }
    current.push(line)
  })
  if (current.length > 0) chunks.push({ lines: current, startLine: currentStart })

  return chunks.map(({ lines: chunkLines, startLine }) => {
    const text = chunkLines.join('\n')
    const headingMatch = chunkLines[0]?.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
    const heading = headingMatch?.[1]

    const fencedBlocks: FencedBlock[] = []
    // Fences are replaced by an equal number of newlines so later offsets
    // still map to document lines.
    const withoutFences = text.replace(
      FENCED_BLOCK_RE,
      (m: string, tag: string, code: string, offset: number) => {
        fencedBlocks.push({
          language: classifyFence(tag),
          tag: tag.toLowerCase(),
          code,
          line: startLine + countNewlines(text.slice(0, offset)),
        })
        return '\n'.repeat(countNewlines(m))
      },
    )
    // Markdown table rows are catalogs/enumerations (e.g. "common packages"
    // reference tables), not teaching content — inline code inside them must
    // not count as package references, or list-style skills get flagged as
    // stuffing and stuffers get free references. Rows are blanked, not
    // removed, to keep line numbers stable.
    const withoutTables = withoutFences
      .split('\n')
      .map(line => (/^\s*\|.*\|\s*$/.test(line) ? '' : line))
      .join('\n')

    const inlineSpans: InlineSpan[] = []
    const prosePart = withoutTables.replace(
      INLINE_CODE_RE,
      (_m: string, span: string, offset: number) => {
        inlineSpans.push({
          text: span,
          line: startLine + countNewlines(withoutTables.slice(0, offset)),
        })
        return ' '
      },
    )
    // Strip heading markers and markdown punctuation, count remaining words.
    const prose = prosePart.replace(/^#{1,6}\s+/gm, '')
    const proseWords = prose.split(/\s+/).filter(w => /\w/.test(w)).length

    return heading
      ? { heading, proseWords, fencedBlocks, inlineSpans }
      : { proseWords, fencedBlocks, inlineSpans }
  })
}

/**
 * Extracts identifiers from a skill directory: the SKILL.md body's code-shaped
 * text (section-aware, with substantiation tracking), plus any bundled
 * scripts/references verbatim (those are already code, no markdown stripping
 * needed).
 */
export function extractSkillIdentifiers(skillDir: string): SkillIdentifiers {
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`No SKILL.md found at ${skillMdPath}`)
  }
  // Normalize CRLF so fence/line-anchored regexes behave the same on Windows.
  const raw = fs.readFileSync(skillMdPath, 'utf-8').replace(/\r\n/g, '\n')
  const { data: frontmatter, body, bodyStartLine } = parseFrontmatter(raw)

  const result: SkillIdentifiers = {
    skillName: frontmatterString(frontmatter, 'name') ?? path.basename(skillDir),
    skillPath: skillDir,
    categories: new Set(declaredCategories(frontmatter)),
    packages: new Set(),
    importSpecifiers: new Set(),
    apiCalls: new Set(),
    packageRefs: {},
    importedIdentifiers: {},
    unusedImportCount: 0,
    locations: { packages: {}, importSpecifiers: {}, apiCalls: {} },
    codeEvidence: { codeFences: 0, shellFences: 0 },
  }

  const recordRef = (
    pkg: string,
    tier: ReferenceSubstantiation,
    proseOk: boolean,
    location?: SourceLocation,
  ) => {
    result.packages.add(pkg)
    if (location && !result.locations.packages[pkg]) {
      result.locations.packages[pkg] = location
    }
    const existing = result.packageRefs[pkg]
    if (!existing) {
      result.packageRefs[pkg] = {
        packageName: pkg,
        substantiation: tier,
        substantiatedByProse: proseOk,
        ...(location ? { location } : {}),
      } satisfies PackageReference
      return
    }
    if (
      SUBSTANTIATION_RANK[tier] > SUBSTANTIATION_RANK[existing.substantiation]
    ) {
      existing.substantiation = tier
    }
    existing.substantiatedByProse = existing.substantiatedByProse || proseOk
  }

  /** Folds one snippet's analysis in. `location` is undefined for bundled files. */
  const mergeAnalysis = (
    analysis: CodeAnalysis,
    proseOk: boolean,
    location?: SourceLocation,
  ) => {
    for (const [pkg, tier] of analysis.packages) {
      recordRef(pkg, tier, proseOk, location)
    }
    for (const [pkg, ids] of analysis.importedIdentifiers) {
      const target = result.importedIdentifiers[pkg] ?? new Set<string>()
      for (const id of ids) target.add(id)
      result.importedIdentifiers[pkg] = target
    }
    for (const spec of analysis.importSpecifiers) {
      result.importSpecifiers.add(spec)
      if (location && !result.locations.importSpecifiers[spec]) {
        result.locations.importSpecifiers[spec] = location
      }
    }
    for (const call of analysis.apiCalls) {
      result.apiCalls.add(call)
      if (location && !result.locations.apiCalls[call]) {
        result.locations.apiCalls[call] = location
      }
    }
    result.unusedImportCount += analysis.unusedImportCount
  }

  const yieldedReferences = (analysis: CodeAnalysis) =>
    analysis.packages.size > 0 ||
    analysis.importSpecifiers.size > 0 ||
    analysis.apiCalls.size > 0

  /** `locate` is false for bundled reference files, whose lines are not SKILL.md's. */
  const mergeMarkdown = (markdown: string, firstLine: number, locate: boolean) => {
    for (const section of splitSections(markdown, firstLine)) {
      const proseOk = section.proseWords >= PROSE_MIN_WORDS
      const at = (line: number): SourceLocation | undefined =>
        locate
          ? section.heading
            ? { line, heading: section.heading }
            : { line }
          : undefined

      for (const block of section.fencedBlocks) {
        if (SHELL_FENCE_TAGS.has(block.tag)) result.codeEvidence.shellFences++
        const analysis = analyzeCode(block.code, block.language)
        if (block.language !== 'other' && yieldedReferences(analysis)) {
          result.codeEvidence.codeFences++
        }
        mergeAnalysis(analysis, proseOk, at(block.line))
      }

      // Inline code spans: imports/requires still count as code, but a
      // package name that only ever appears inline is a bare mention.
      for (const span of section.inlineSpans) {
        const analysis = analyzeCode(span.text, 'untagged')
        // Downgrade anything found in an inline span to 'mention' — a
        // one-line span is never a demonstrated usage.
        const downgraded: CodeAnalysis = {
          ...analysis,
          packages: new Map(
            [...analysis.packages.keys()].map(pkg => [pkg, 'mention' as const]),
          ),
          unusedImportCount: 0,
        }
        mergeAnalysis(downgraded, proseOk, at(span.line))

        // Bare package-name mentions (`tailwindcss`, `@tanstack/react-query`):
        // count them as mention-tier references when they are unambiguous —
        // taxonomy-known names or scoped package names.
        const trimmed = span.text.trim()
        const isScoped = /^@[\w.-]+\/[\w.-]+$/.test(trimmed)
        if (isScoped || isKnownPackage(trimmed))
          recordRef(trimmed, 'mention', proseOk, at(span.line))
      }
    }
  }

  mergeMarkdown(body, bodyStartLine, true)

  // Bundled scripts/references: the file extension plays the role of the
  // fence tag. Markdown references go through the same section-aware pass as
  // SKILL.md; code files are parsed directly and, being real files, do not
  // need surrounding prose to count.
  const bundledFiles = fg.sync(['scripts/**/*.*', 'references/**/*.*'], {
    cwd: skillDir,
    absolute: true,
  })
  for (const file of bundledFiles) {
    const extension = path.extname(file).slice(1).toLowerCase()
    const language = classifyFence(extension)
    const isMarkdown = extension === 'md' || extension === 'mdx'
    if (language === 'other' && !isMarkdown) continue
    try {
      const text = fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n')
      if (isMarkdown) mergeMarkdown(parseFrontmatter(text).body, 1, false)
      else mergeAnalysis(analyzeCode(text, language), true)
    } catch {
      // binary/unreadable asset, skip
    }
  }

  return result
}
