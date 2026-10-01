import { topLevelPackage } from '../packageNames.js'
import type { ImportBinding, SourceImport } from './types.js'

/**
 * A dependency-free import lexer for JavaScript and TypeScript (with JSX).
 *
 * It replaces the TypeScript compiler for the one question the audit asks of
 * project source — which modules does this file import, and which names does
 * it take from them — at a fraction of the install size and startup time.
 *
 * Strategy: a single pass masks everything that could hide a fake import or
 * break a naive match (comments, string and template literal contents,
 * regular expression literals), keeping only the string literals that are
 * module specifiers. Import forms are then matched with regular expressions
 * on the masked text and the statement text is sliced from the original.
 *
 * Known limits, all bounded to a single line by design: an apostrophe in JSX
 * text or a `</tag>` closer is read as an unterminated string or regex and
 * masks the rest of that line. Imports live at the top of a file, so this
 * does not lose them in practice; `--parser ts-morph` is the escape hatch.
 */

const KEYWORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'instanceof',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
])

/** Characters after which a `/` starts a regular expression, not a division. */
const REGEX_PREFIX_CHARS = new Set('(,=:[!&|?{};+-*%<>~^'.split(''))

/**
 * True when the text ending at `out` is the head of an import form whose
 * next token is a module specifier string.
 */
const SPECIFIER_CONTEXT_RE = /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*$/

function isIdentifierChar(c: string): boolean {
  return /[\w$]/.test(c)
}

/** Replaces every character except newlines so line numbers survive masking. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ')
}

interface Masked {
  text: string
}

/**
 * Masks comments, non-specifier strings, template literals and regex
 * literals with spaces (newlines preserved). Returns a same-length string.
 */
export function maskJavaScript(source: string): Masked {
  let out = ''
  let i = 0
  const n = source.length

  const lastSignificant = (): { char: string; word: string } => {
    let j = out.length - 1
    while (j >= 0 && /\s/.test(out[j])) j--
    if (j < 0) return { char: '', word: '' }
    const char = out[j]
    let k = j
    while (k >= 0 && isIdentifierChar(out[k])) k--
    return { char, word: out.slice(k + 1, j + 1) }
  }

  const regexStartsHere = (): boolean => {
    const { char, word } = lastSignificant()
    if (char === '') return true
    if (REGEX_PREFIX_CHARS.has(char)) return true
    if (char === '}') return true
    if (isIdentifierChar(char)) return KEYWORDS_BEFORE_REGEX.has(word)
    return false // `)`, `]`, `.`, quotes: division
  }

  /** Skips a template literal starting at `start` (the backtick); returns the index after it. */
  const skipTemplate = (start: number): number => {
    let j = start + 1
    while (j < n) {
      const c = source[j]
      if (c === '\\') {
        j += 2
        continue
      }
      if (c === '`') return j + 1
      if (c === '$' && source[j + 1] === '{') {
        j = skipTemplateExpression(j + 2)
        continue
      }
      j++
    }
    return n
  }

  /** Skips a `${ ... }` expression body; `start` is just after `${`. */
  const skipTemplateExpression = (start: number): number => {
    let depth = 1
    let j = start
    while (j < n && depth > 0) {
      const c = source[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '`') {
        j = skipTemplate(j)
        continue
      } else if (c === '"' || c === "'") {
        j = skipQuoted(j)
        continue
      }
      j++
    }
    return j
  }

  /** Skips a quoted string starting at `start`; stops at the closing quote or the line end. */
  const skipQuoted = (start: number): number => {
    const quote = source[start]
    let j = start + 1
    while (j < n) {
      const c = source[j]
      if (c === '\\') {
        j += 2
        continue
      }
      if (c === quote) return j + 1
      if (c === '\n') return j // unterminated (JSX text apostrophe): give up at the line
      j++
    }
    return n
  }

  /** Skips a regex literal starting at `start` (the slash); stops at the line end if unterminated. */
  const skipRegex = (start: number): number => {
    let j = start + 1
    let inClass = false
    while (j < n) {
      const c = source[j]
      if (c === '\\') {
        j += 2
        continue
      }
      if (c === '\n') return j
      if (inClass) {
        if (c === ']') inClass = false
      } else if (c === '[') {
        inClass = true
      } else if (c === '/') {
        j++
        while (j < n && /[a-z]/i.test(source[j])) j++ // flags
        return j
      }
      j++
    }
    return n
  }

  while (i < n) {
    const c = source[i]
    const next = source[i + 1]

    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? n : end
      out += blank(source.slice(i, stop))
      i = stop
      continue
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += blank(source.slice(i, stop))
      i = stop
      continue
    }
    if (c === '`') {
      const stop = skipTemplate(i)
      out += blank(source.slice(i, stop))
      i = stop
      continue
    }
    if (c === '"' || c === "'") {
      const stop = skipQuoted(i)
      const literal = source.slice(i, stop)
      // Only the tail can hold the `from` / `require(` head; slicing keeps
      // this check O(1) per string instead of O(file) per string.
      if (SPECIFIER_CONTEXT_RE.test(out.slice(-64))) {
        out += literal
      } else {
        // Keep the quotes so the shape of the code survives; hide the contents.
        const closed = literal.length > 1 && literal[literal.length - 1] === c
        out += c + blank(literal.slice(1, closed ? -1 : undefined)) + (closed ? c : '')
      }
      i = stop
      continue
    }
    if (c === '/' && regexStartsHere()) {
      const stop = skipRegex(i)
      out += blank(source.slice(i, stop))
      i = stop
      continue
    }
    out += c
    i++
  }

  return { text: out }
}

/**
 * Parses the clause of an import statement (`Default, { a, b as c }`,
 * `* as ns`, `type { T }`) into bindings. Named imports record the exported
 * name, so `{ useRouter as useNav }` verifies against a repo that imports
 * `useRouter`; usage inside a snippet is judged by the local alias.
 */
export function parseImportClause(clause: string): ImportBinding[] {
  const bindings: ImportBinding[] = []
  const withoutType = clause.replace(/^\s*type\s+/, '')

  const namespace = withoutType.match(/\*\s+as\s+([\w$]+)/)
  if (namespace) bindings.push({ source: namespace[1], local: namespace[1] })

  const braces = withoutType.match(/\{([^}]*)\}/)
  if (braces) {
    for (const part of braces[1].split(',')) {
      const trimmed = part.trim().replace(/^type\s+/, '')
      if (!trimmed) continue
      const asMatch = trimmed.match(/^([\w$]+)\s+as\s+([\w$]+)$/)
      if (asMatch) {
        bindings.push({ source: asMatch[1], local: asMatch[2] })
        continue
      }
      const name = trimmed.match(/^[\w$]+$/)?.[0]
      if (name) bindings.push({ source: name, local: name })
    }
  }

  const defaultName = withoutType
    .replace(/\{[^}]*\}/g, '')
    .replace(/\*\s+as\s+[\w$]+/g, '')
    .split(',')
    .map(s => s.trim())
    .find(s => /^[\w$]+$/.test(s))
  if (defaultName) bindings.push({ source: defaultName, local: defaultName })

  return bindings
}

/**
 * Parses the clause of a re-export (`* as ns`, `{ a, b as c, default as D }`)
 * into bindings the same way `parseImportClause` does for imports, so a
 * barrel file tells the repo scan which names the project takes from a
 * package. `default as D` records `D`, matching how a default import is
 * recorded under its local name. A bare `*` forwards everything and has no
 * name of its own.
 */
export function parseExportClause(clause: string): ImportBinding[] {
  const trimmed = clause.trim()
  const namespace = trimmed.match(/^\*\s+as\s+([\w$]+)$/)
  if (namespace) return [{ source: namespace[1], local: namespace[1] }]

  const braces = trimmed.match(/^\{([^}]*)\}$/)
  if (!braces) return []
  const bindings: ImportBinding[] = []
  for (const part of braces[1].split(',')) {
    const entry = part.trim().replace(/^type\s+/, '')
    if (!entry) continue
    const asMatch = entry.match(/^([\w$]+)\s+as\s+([\w$]+)$/)
    if (asMatch) {
      const source = asMatch[1] === 'default' ? asMatch[2] : asMatch[1]
      bindings.push({ source, local: asMatch[2] })
      continue
    }
    const name = entry.match(/^[\w$]+$/)?.[0]
    if (name) bindings.push({ source: name, local: name })
  }
  return bindings
}

// Every keyword is required to stand alone: `obj.require('x')` and
// `obj.import('x')` are method calls, not module imports (ts-morph agrees: it
// only counts a bare `require`/`import` callee).
/** `import <clause> from "x"` — the clause cannot contain quotes, `;` or parens. */
const IMPORT_FROM_RE =
  /(?<![.\w$])import\s+((?:type\s+)?[^'"`;()]*?)\s*from\s*(['"])([^'"\n]*)\2/g
/** `export { a } from "x"` | `export * from "x"` | `export * as ns from "x"` */
const EXPORT_FROM_RE =
  /(?<![.\w$])export\s+(?:type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]*)\2/g
/** `import "x"` (side effect) */
const SIDE_EFFECT_RE = /(?<![.\w$])import\s*(['"])([^'"\n]*)\1/g
/** `require("x")` — also covers TS `import x = require("x")` */
const REQUIRE_RE = /(?<![.\w$])require\s*\(\s*(['"])([^'"\n]*)\1\s*\)/g
/** `import("x")` with an optional options argument */
const DYNAMIC_IMPORT_RE = /(?<![.\w$])import\s*\(\s*(['"])([^'"\n]*)\1\s*[,)]/g

/**
 * Every module import in a JS/TS source text: static imports with their
 * bindings, re-exports, side-effect imports, `require()` and dynamic
 * `import()`. Sorted by position.
 */
export function scanJavaScriptImports(source: string): SourceImport[] {
  const { text } = maskJavaScript(source)
  const imports: SourceImport[] = []
  const seen = new Set<number>()

  const push = (
    start: number,
    end: number,
    specifier: string,
    bindings: ImportBinding[],
    bindingsKnown: boolean,
  ) => {
    if (seen.has(start)) return
    seen.add(start)
    imports.push({
      ecosystem: 'npm',
      specifier,
      packageName: topLevelPackage(specifier),
      bindings,
      bindingsKnown,
      text: source.slice(start, end).trim(),
      start,
      end,
    })
  }

  for (const m of text.matchAll(IMPORT_FROM_RE)) {
    push(m.index, m.index + m[0].length, m[3], parseImportClause(m[1]), true)
  }
  for (const m of text.matchAll(EXPORT_FROM_RE)) {
    // A re-export is its own use of what it forwards: there is no body below
    // it to check, so the bindings are recorded but not judged for use.
    push(m.index, m.index + m[0].length, m[3], parseExportClause(m[1]), false)
  }
  for (const m of text.matchAll(SIDE_EFFECT_RE)) {
    push(m.index, m.index + m[0].length, m[2], [], true)
  }
  for (const m of text.matchAll(REQUIRE_RE)) {
    push(m.index, m.index + m[0].length, m[2], [], false)
  }
  for (const m of text.matchAll(DYNAMIC_IMPORT_RE)) {
    push(m.index, m.index + m[0].length, m[2], [], false)
  }

  return imports.sort((a, b) => a.start - b.start)
}
