import fg from 'fast-glob'
import * as fs from 'fs'
import * as path from 'path'
import type { SkillIdentifiers } from './types.js'

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

/**
 * Extracts the `categories:` list from a SKILL.md YAML frontmatter block.
 * Supports both inline (`categories: [seo, accessibility]`) and block
 * (`categories:\n  - seo\n  - accessibility`) list forms.
 */
function extractFrontmatterCategories(raw: string): string[] {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return []
  const fm = fmMatch[1]

  const inline = fm.match(/^categories:\s*\[([^\]]*)\]\s*$/m)
  if (inline) {
    return inline[1]
      .split(',')
      .map(s => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  const blockMatch = fm.match(/^categories:\s*\n((?:\s*-\s*.+\n?)+)/m)
  if (blockMatch) {
    return blockMatch[1]
      .split('\n')
      .map(line => line.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  return []
}

function topLevelPackage(specifier: string): string {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return ''
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
}

/** Pulls code-shaped text out of markdown: fenced blocks + inline spans, prose discarded. */
function extractCodeSnippets(markdown: string): string[] {
  const snippets: string[] = []
  for (const m of markdown.matchAll(FENCED_BLOCK_RE)) snippets.push(m[1])
  for (const m of markdown.matchAll(INLINE_CODE_RE)) snippets.push(m[1])
  return snippets
}

function extractFromCode(code: string, out: SkillIdentifiers) {
  for (const m of code.matchAll(IMPORT_FROM_RE)) {
    out.importSpecifiers.add(m[1])
    const pkg = topLevelPackage(m[1])
    if (pkg) out.packages.add(pkg)
  }
  for (const m of code.matchAll(REQUIRE_RE)) {
    out.importSpecifiers.add(m[1])
    const pkg = topLevelPackage(m[1])
    if (pkg) out.packages.add(pkg)
  }
  for (const m of code.matchAll(PY_IMPORT_RE)) {
    const pkg = m[1].split('.')[0]
    if (pkg) out.packages.add(pkg)
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
    if (!KEYWORDS.has(m[1])) out.apiCalls.add(m[1])
  }
}

/**
 * Extracts identifiers from a skill directory: the SKILL.md body's code-shaped
 * text, plus any bundled scripts/references verbatim (those are already code,
 * no markdown stripping needed).
 */
export function extractSkillIdentifiers(skillDir: string): SkillIdentifiers {
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`No SKILL.md found at ${skillMdPath}`)
  }
  // Normalize CRLF so fence/line-anchored regexes behave the same on Windows.
  const raw = fs.readFileSync(skillMdPath, 'utf-8').replace(/\r\n/g, '\n')

  const nameMatch = raw.match(/^name:\s*(.+)$/m)
  const skillName = nameMatch ? nameMatch[1].trim() : path.basename(skillDir)

  const result: SkillIdentifiers = {
    skillName,
    skillPath: skillDir,
    categories: new Set(extractFrontmatterCategories(raw)),
    packages: new Set(),
    importSpecifiers: new Set(),
    apiCalls: new Set(),
  }

  for (const snippet of extractCodeSnippets(raw)) {
    extractFromCode(snippet, result)
  }

  // Bundled scripts/references are already code — parse them directly, no fence-stripping needed.
  const bundledFiles = fg.sync(['scripts/**/*.*', 'references/**/*.*'], {
    cwd: skillDir,
    absolute: true,
  })
  for (const file of bundledFiles) {
    try {
      extractFromCode(fs.readFileSync(file, 'utf-8'), result)
    } catch {
      // binary/unreadable asset, skip
    }
  }

  return result
}
