import fg from 'fast-glob'
import * as fs from 'fs'
import * as path from 'path'
import { scanGoImports } from './ecosystems/go.js'
import { maskJavaScript, scanJavaScriptImports } from './ecosystems/javascript.js'
import { scanPythonImports } from './ecosystems/python.js'
import { scanRustImports } from './ecosystems/rust.js'
import { lineOf, type SourceImport } from './ecosystems/types.js'
import {
  declaredCategories,
  frontmatterString,
  parseFrontmatter,
} from './frontmatter.js'
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
 * tag. Only code in a language with a package ecosystem can carry package
 * references; running import rules over CSS, HTML or shell turns `@media (`
 * and `$(` into "API calls" and pushes a prose skill out of the neutral
 * bucket. Untagged fences get the JS and Python rules, since many skills omit
 * the tag and those two are the ambiguous ones in practice.
 */
type FenceLanguage = 'js' | 'python' | 'go' | 'rust' | 'untagged' | 'other'

const FENCE_TAGS: Record<Exclude<FenceLanguage, 'untagged' | 'other'>, string[]> = {
  js: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'javascript', 'typescript'],
  python: ['py', 'python', 'python3'],
  go: ['go', 'golang'],
  rust: ['rs', 'rust'],
}

const TAG_TO_LANGUAGE = new Map<string, FenceLanguage>(
  Object.entries(FENCE_TAGS).flatMap(([language, tags]) =>
    tags.map(tag => [tag, language as FenceLanguage] as const),
  ),
)

function classifyFence(tag: string): FenceLanguage {
  const normalized = tag.toLowerCase()
  if (normalized === '') return 'untagged'
  return TAG_TO_LANGUAGE.get(normalized) ?? 'other'
}

/** Bare API-call-shaped identifiers: someFunction( or useSomething( */
const API_CALL_RE = /\b([a-zA-Z_$][\w$]*)\s*\(/g
/** Control-flow words that look like calls but are not API surface. */
const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return'])

const SUBSTANTIATION_RANK: Record<ReferenceSubstantiation, number> = {
  mention: 0,
  fenced: 1,
  usage: 2,
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

/** What one snippet contributes, with 0-based line offsets inside the snippet. */
interface CodeAnalysis {
  /** package -> best substantiation tier found in this code, and where */
  packages: Map<string, { tier: ReferenceSubstantiation; line: number }>
  /** package -> imported binding names (exported names) */
  importedIdentifiers: Map<string, Set<string>>
  importSpecifiers: Map<string, number>
  apiCalls: Map<string, number>
  /** lines of import statements whose bindings are never used below them */
  unusedImportLines: number[]
}

function emptyAnalysis(): CodeAnalysis {
  return {
    packages: new Map(),
    importedIdentifiers: new Map(),
    importSpecifiers: new Map(),
    apiCalls: new Map(),
    unusedImportLines: [],
  }
}

function upgrade(
  result: CodeAnalysis,
  pkg: string,
  tier: ReferenceSubstantiation,
  line: number,
): void {
  const current = result.packages.get(pkg)
  if (!current) {
    result.packages.set(pkg, { tier, line })
  } else if (SUBSTANTIATION_RANK[tier] > SUBSTANTIATION_RANK[current.tier]) {
    current.tier = tier
  }
}

/**
 * Folds a language scanner's imports into an analysis. Distinguishes imports
 * whose bindings are actually used ('usage') from imports that just sit
 * there ('fenced') — the latter is the cheapest way to stuff references into
 * a skill, so it is worth almost nothing. The same rule applies to every
 * language: `import numpy as np` is usage only if `np` appears below it.
 */
function analyzeImports(code: string, imports: SourceImport[]): CodeAnalysis {
  const result = emptyAnalysis()
  for (const imp of imports) {
    const pkg = imp.packageName
    if (!pkg) continue
    const line = lineOf(code, imp.start)
    if (!result.importSpecifiers.has(imp.specifier)) {
      result.importSpecifiers.set(imp.specifier, line)
    }

    if (!imp.bindingsKnown || imp.bindings.length === 0) {
      // require()/dynamic import results are not tracked; side-effect and
      // glob imports have nothing to use. Fenced-level evidence at most.
      upgrade(result, pkg, 'fenced', line)
      continue
    }

    // Verification against the repo compares exported names, which is what
    // the repo scan records for named imports...
    const ids = result.importedIdentifiers.get(pkg) ?? new Set<string>()
    for (const binding of imp.bindings) ids.add(binding.source)
    result.importedIdentifiers.set(pkg, ids)

    // ...while usage is judged by the local name the snippet actually writes.
    const codeAfterImport = code.slice(0, imp.start) + code.slice(imp.end)
    const used = imp.bindings.some(b => identifierUsedIn(codeAfterImport, b.local))
    if (used) {
      upgrade(result, pkg, 'usage', line)
    } else {
      result.unusedImportLines.push(line)
      upgrade(result, pkg, 'fenced', line)
    }
  }
  return result
}

function analyzeJavaScript(code: string): CodeAnalysis {
  const result = analyzeImports(code, scanJavaScriptImports(code))
  // API calls are read from the masked text so a call inside a comment or a
  // string is not counted.
  const { text } = maskJavaScript(code)
  for (const m of text.matchAll(API_CALL_RE)) {
    if (JS_KEYWORDS.has(m[1]) || result.apiCalls.has(m[1])) continue
    result.apiCalls.set(m[1], lineOf(text, m.index))
  }
  return result
}

/** Analyzes one code snippet with the rules for its language. */
function analyzeCode(code: string, language: FenceLanguage): CodeAnalysis {
  switch (language) {
    case 'other':
      return emptyAnalysis()
    case 'python':
      return analyzeImports(code, scanPythonImports(code))
    case 'go':
      return analyzeImports(code, scanGoImports(code))
    case 'rust':
      return analyzeImports(code, scanRustImports(code))
    case 'js':
      return analyzeJavaScript(code)
    case 'untagged': {
      const result = analyzeJavaScript(code)
      const python = analyzeImports(code, scanPythonImports(code))
      for (const [pkg, entry] of python.packages) {
        if (!result.packages.has(pkg)) result.packages.set(pkg, entry)
      }
      for (const [spec, line] of python.importSpecifiers) {
        if (!result.importSpecifiers.has(spec)) result.importSpecifiers.set(spec, line)
      }
      for (const [pkg, ids] of python.importedIdentifiers) {
        const target = result.importedIdentifiers.get(pkg) ?? new Set<string>()
        for (const id of ids) target.add(id)
        result.importedIdentifiers.set(pkg, target)
      }
      result.unusedImportLines.push(...python.unusedImportLines)
      return result
    }
  }
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
  // A `# comment` inside a shell fence is not a heading. Splitting there
  // would leave half a fence in each chunk, and the fence regex would then
  // pair the orphaned closer with the next opener and read prose as code.
  let inFence = false
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (!inFence && /^#{1,6}\s/.test(line) && current.length > 0) {
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

/** Builds a location factory for one file and section. */
type Locator = (lineOffset: number) => SourceLocation

function locator(file: string, baseLine: number, heading?: string): Locator {
  return lineOffset =>
    heading
      ? { file, line: baseLine + lineOffset, heading }
      : { file, line: baseLine + lineOffset }
}

/**
 * Extracts identifiers from a skill directory: the SKILL.md body's code-shaped
 * text (section-aware, with substantiation tracking), plus any bundled
 * scripts/references verbatim (those are already code, no markdown stripping
 * needed). Every reference carries the file and line it was first seen at.
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
    locations: { packages: {}, importSpecifiers: {}, apiCalls: {}, unusedImports: [] },
    codeEvidence: { codeFences: 0, shellFences: 0 },
  }

  const recordRef = (
    pkg: string,
    tier: ReferenceSubstantiation,
    proseOk: boolean,
    location: SourceLocation,
  ) => {
    result.packages.add(pkg)
    if (!result.locations.packages[pkg]) result.locations.packages[pkg] = location
    const existing = result.packageRefs[pkg]
    if (!existing) {
      result.packageRefs[pkg] = {
        packageName: pkg,
        substantiation: tier,
        substantiatedByProse: proseOk,
        location,
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

  /** Folds one snippet's analysis in, resolving snippet lines through `at`. */
  const mergeAnalysis = (analysis: CodeAnalysis, proseOk: boolean, at: Locator) => {
    for (const [pkg, { tier, line }] of analysis.packages) {
      recordRef(pkg, tier, proseOk, at(line))
    }
    for (const [pkg, ids] of analysis.importedIdentifiers) {
      const target = result.importedIdentifiers[pkg] ?? new Set<string>()
      for (const id of ids) target.add(id)
      result.importedIdentifiers[pkg] = target
    }
    for (const [spec, line] of analysis.importSpecifiers) {
      result.importSpecifiers.add(spec)
      if (!result.locations.importSpecifiers[spec]) {
        result.locations.importSpecifiers[spec] = at(line)
      }
    }
    for (const [call, line] of analysis.apiCalls) {
      result.apiCalls.add(call)
      if (!result.locations.apiCalls[call]) result.locations.apiCalls[call] = at(line)
    }
    result.unusedImportCount += analysis.unusedImportLines.length
    for (const line of analysis.unusedImportLines) {
      result.locations.unusedImports.push(at(line))
    }
  }

  const yieldedReferences = (analysis: CodeAnalysis) =>
    analysis.packages.size > 0 ||
    analysis.importSpecifiers.size > 0 ||
    analysis.apiCalls.size > 0

  const mergeMarkdown = (markdown: string, firstLine: number, file: string) => {
    for (const section of splitSections(markdown, firstLine)) {
      const proseOk = section.proseWords >= PROSE_MIN_WORDS

      for (const block of section.fencedBlocks) {
        if (SHELL_FENCE_TAGS.has(block.tag)) result.codeEvidence.shellFences++
        const analysis = analyzeCode(block.code, block.language)
        if (block.language !== 'other' && yieldedReferences(analysis)) {
          result.codeEvidence.codeFences++
        }
        // Code starts on the line after the fence opener.
        mergeAnalysis(analysis, proseOk, locator(file, block.line + 1, section.heading))
      }

      // Inline code spans: imports/requires still count as code, but a
      // package name that only ever appears inline is a bare mention.
      for (const span of section.inlineSpans) {
        const at = locator(file, span.line, section.heading)
        const analysis = analyzeCode(span.text, 'untagged')
        // Downgrade anything found in an inline span to 'mention' — a
        // one-line span is never a demonstrated usage.
        const downgraded: CodeAnalysis = {
          ...analysis,
          packages: new Map(
            [...analysis.packages].map(([pkg, entry]) => [
              pkg,
              { tier: 'mention' as const, line: entry.line },
            ]),
          ),
          unusedImportLines: [],
        }
        mergeAnalysis(downgraded, proseOk, at)

        // Bare package-name mentions (`tailwindcss`, `@tanstack/react-query`):
        // count them as mention-tier references when they are unambiguous —
        // taxonomy-known names or scoped package names.
        const trimmed = span.text.trim()
        const isScoped = /^@[\w.-]+\/[\w.-]+$/.test(trimmed)
        if (isScoped || isKnownPackage(trimmed)) recordRef(trimmed, 'mention', proseOk, at(0))
      }
    }
  }

  mergeMarkdown(body, bodyStartLine, 'SKILL.md')

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
    const relative = path.relative(skillDir, file).replace(/\\/g, '/')
    try {
      const text = fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n')
      if (isMarkdown) {
        const parsed = parseFrontmatter(text)
        mergeMarkdown(parsed.body, parsed.bodyStartLine, relative)
      } else {
        mergeAnalysis(analyzeCode(text, language), true, locator(relative, 1))
      }
    } catch {
      // binary/unreadable asset, skip
    }
  }

  return result
}
