import fg from 'fast-glob'
import * as fs from 'fs'
import * as path from 'path'
import {
  frontmatterList,
  frontmatterString,
  parseFrontmatter,
} from './frontmatter.js'
import { topLevelPackage } from './packageNames.js'
import { isKnownPackage, PROSE_MIN_WORDS } from './taxonomy.js'
import type {
  PackageReference,
  ReferenceSubstantiation,
  SkillIdentifiers,
} from './types.js'

/** Matches fenced code blocks: ```lang\n...\n``` */
const FENCED_BLOCK_RE = /```[\w-]*\n([\s\S]*?)```/g
/** Matches inline code spans: `like this` */
const INLINE_CODE_RE = /`([^`\n]+)`/g

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
 * Parses the binding names introduced by a JS import statement's clause,
 * e.g. `import Default, { a, b as c } from 'x'` -> ["Default", "a" -> "c"].
 * Returns [] for side-effect imports (`import 'x'`).
 */
function importBindingNames(importStatement: string): string[] {
  const clauseMatch = importStatement.match(
    /import\s+([\w*{}\s,$]+?)\s+from\s+["']/,
  )
  if (!clauseMatch) return []
  const clause = clauseMatch[1]
  const names: string[] = []

  const namespace = clause.match(/\*\s+as\s+([\w$]+)/)
  if (namespace) names.push(namespace[1])

  const braces = clause.match(/\{([^}]*)\}/)
  if (braces) {
    for (const part of braces[1].split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const asMatch = trimmed.match(/\s+as\s+([\w$]+)$/)
      names.push(asMatch ? asMatch[1] : trimmed.split(/\s+/)[0])
    }
  }

  const defaultName = clause
    .replace(/\{[^}]*\}/g, '')
    .replace(/\*\s+as\s+[\w$]+/g, '')
    .split(',')
    .map(s => s.trim())
    .find(s => /^[\w$]+$/.test(s))
  if (defaultName) names.push(defaultName)

  return names
}

/** True if `identifier` appears as a standalone word anywhere in `code`. */
function identifierUsedIn(code: string, identifier: string): boolean {
  const re = new RegExp(
    `\\b${identifier.replace(/\$/g, '\\$')}\\b`,
  )
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

/**
 * Analyzes one code snippet (fenced block or bundled script file).
 * Distinguishes imports whose bindings are actually used ('usage') from
 * imports that just sit there ('fenced') — the latter is the cheapest way to
 * stuff references into a skill, so it is worth almost nothing.
 */
function analyzeCode(code: string): CodeAnalysis {
  const result: CodeAnalysis = {
    packages: new Map(),
    importedIdentifiers: new Map(),
    importSpecifiers: new Set(),
    apiCalls: new Set(),
    unusedImportCount: 0,
  }

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

    const bindings = importBindingNames(m[0])
    const codeAfterImport =
      code.slice(0, m.index) + code.slice((m.index ?? 0) + m[0].length)
    const used = bindings.filter(b => identifierUsedIn(codeAfterImport, b))

    if (bindings.length > 0) {
      const ids = result.importedIdentifiers.get(pkg) ?? new Set<string>()
      for (const b of bindings) ids.add(b)
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

  for (const m of code.matchAll(PY_IMPORT_RE)) {
    // Skip JS imports that also match this pattern ("import Link from '...'"):
    // JS import lines always quote the module specifier, Python's never do.
    const lineStart = code.lastIndexOf('\n', m.index ?? 0) + 1
    const lineEnd = code.indexOf('\n', (m.index ?? 0) + 1)
    const line = code.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    if (/["']/.test(line)) continue

    const pkg = m[1].split('.')[0]
    if (pkg) upgrade(pkg, 'fenced')
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

interface MarkdownSection {
  /** Words of prose in the section (code stripped) */
  proseWords: number
  fencedBlocks: string[]
  inlineSpans: string[]
}

/**
 * Splits a markdown body into heading-delimited sections so references can be
 * judged against the prose that actually explains them.
 */
function splitSections(body: string): MarkdownSection[] {
  const lines = body.split('\n')
  const chunks: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      chunks.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) chunks.push(current)

  return chunks.map(chunk => {
    const text = chunk.join('\n')
    const fencedBlocks: string[] = []
    let withoutFences = text.replace(FENCED_BLOCK_RE, (_m, code: string) => {
      fencedBlocks.push(code)
      return ' '
    })
    // Markdown table rows are catalogs/enumerations (e.g. "common packages"
    // reference tables), not teaching content — inline code inside them must
    // not count as package references, or list-style skills get flagged as
    // stuffing and stuffers get free references.
    const withoutTables = withoutFences
      .split('\n')
      .filter(line => !/^\s*\|.*\|\s*$/.test(line))
      .join('\n')

    const inlineSpans: string[] = []
    const prosePart = withoutTables.replace(
      INLINE_CODE_RE,
      (_m, span: string) => {
        inlineSpans.push(span)
        return ' '
      },
    )
    // Strip heading markers and markdown punctuation, count remaining words.
    const prose = prosePart.replace(/^#{1,6}\s+/gm, '')
    const proseWords = prose.split(/\s+/).filter(w => /\w/.test(w)).length

    return { proseWords, fencedBlocks, inlineSpans }
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
  const { data: frontmatter, body } = parseFrontmatter(raw)

  const result: SkillIdentifiers = {
    skillName: frontmatterString(frontmatter, 'name') ?? path.basename(skillDir),
    skillPath: skillDir,
    categories: new Set(frontmatterList(frontmatter, 'categories')),
    packages: new Set(),
    importSpecifiers: new Set(),
    apiCalls: new Set(),
    packageRefs: {},
    importedIdentifiers: {},
    unusedImportCount: 0,
  }

  const recordRef = (
    pkg: string,
    tier: ReferenceSubstantiation,
    proseOk: boolean,
  ) => {
    result.packages.add(pkg)
    const existing = result.packageRefs[pkg]
    if (!existing) {
      result.packageRefs[pkg] = {
        packageName: pkg,
        substantiation: tier,
        substantiatedByProse: proseOk,
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

  const mergeAnalysis = (analysis: CodeAnalysis, proseOk: boolean) => {
    for (const [pkg, tier] of analysis.packages) recordRef(pkg, tier, proseOk)
    for (const [pkg, ids] of analysis.importedIdentifiers) {
      const target = result.importedIdentifiers[pkg] ?? new Set<string>()
      for (const id of ids) target.add(id)
      result.importedIdentifiers[pkg] = target
    }
    for (const spec of analysis.importSpecifiers)
      result.importSpecifiers.add(spec)
    for (const call of analysis.apiCalls) result.apiCalls.add(call)
    result.unusedImportCount += analysis.unusedImportCount
  }

  for (const section of splitSections(body)) {
    const proseOk = section.proseWords >= PROSE_MIN_WORDS

    for (const block of section.fencedBlocks) {
      mergeAnalysis(analyzeCode(block), proseOk)
    }

    // Inline code spans: imports/requires still count as code, but a package
    // name that only ever appears inline is a bare mention.
    for (const span of section.inlineSpans) {
      const analysis = analyzeCode(span)
      // Downgrade anything found in an inline span to 'mention' — a one-line
      // span is never a demonstrated usage.
      const downgraded: CodeAnalysis = {
        ...analysis,
        packages: new Map(
          [...analysis.packages.keys()].map(pkg => [pkg, 'mention' as const]),
        ),
        unusedImportCount: 0,
      }
      mergeAnalysis(downgraded, proseOk)

      // Bare package-name mentions (`tailwindcss`, `@tanstack/react-query`):
      // count them as mention-tier references when they are unambiguous —
      // taxonomy-known names or scoped package names.
      const trimmed = span.trim()
      const isScoped = /^@[\w.-]+\/[\w.-]+$/.test(trimmed)
      if (isScoped || isKnownPackage(trimmed))
        recordRef(trimmed, 'mention', proseOk)
    }
  }

  // Bundled scripts/references are already code — parse them directly, no
  // fence-stripping needed. Real files don't need surrounding prose.
  const bundledFiles = fg.sync(['scripts/**/*.*', 'references/**/*.*'], {
    cwd: skillDir,
    absolute: true,
  })
  for (const file of bundledFiles) {
    try {
      mergeAnalysis(analyzeCode(fs.readFileSync(file, 'utf-8')), true)
    } catch {
      // binary/unreadable asset, skip
    }
  }

  return result
}
