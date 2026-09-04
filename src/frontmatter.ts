/**
 * Minimal YAML reader for the subset SKILL.md frontmatter and
 * pnpm-workspace.yaml actually use: top-level scalars, inline lists, block
 * lists, block scalars and one level of nested mapping (the spec's
 * `metadata:` block, a map of string keys to string values). Deeper nesting
 * is skipped without consuming the next top-level key.
 *
 * A dependency-free parser is deliberate — the alternative (gray-matter and
 * its yaml engine) more than doubles install size for a handful of keys.
 */

export type YamlValue = string | string[] | Record<string, string>

export interface Frontmatter {
  data: Record<string, YamlValue>
  /** Everything after the closing fence, or the whole input when there is none */
  body: string
  hasFrontmatter: boolean
  /** 1-based line number in the original document where `body` starts */
  bodyStartLine: number
}

/** Reads a key as a nested string mapping, or undefined for anything else. */
export function frontmatterMap(
  data: Record<string, YamlValue>,
  key: string,
): Record<string, string> | undefined {
  const value = data[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined
}

const KEY_RE = /^([A-Za-z0-9_.$-]+):(?:\s+(.*))?$/
const LIST_ITEM_RE = /^\s*-\s+(.*)$/
const BLOCK_SCALAR_RE = /^[|>][+-]?$/

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function isSkippable(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    if (
      (first === '"' || first === "'") &&
      trimmed[trimmed.length - 1] === first
    ) {
      const inner = trimmed.slice(1, -1)
      return first === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner
    }
  }
  return trimmed
}

/**
 * Drops a trailing YAML comment. Only ` #` starts a comment on a plain scalar,
 * so values containing `#` (URLs, CSS colors) survive; quoted values are cut
 * only after their closing quote.
 */
function stripComment(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('#')) return ''

  const quote = trimmed[0]
  if (quote === '"' || quote === "'") {
    for (let i = 1; i < trimmed.length; i++) {
      if (trimmed[i] === '\\' && quote === '"') {
        i++
        continue
      }
      if (trimmed[i] === quote) return trimmed.slice(0, i + 1)
    }
    return trimmed
  }

  const comment = trimmed.search(/\s#/)
  return comment === -1 ? trimmed : trimmed.slice(0, comment).trim()
}

function parseInlineList(value: string): string[] {
  const end = value.lastIndexOf(']')
  const inner = value.slice(1, end === -1 ? undefined : end)
  return inner.split(',').map(unquote).filter(Boolean)
}

/** Collects a `key: |`-style block scalar's indented lines. */
function readBlockScalar(
  lines: string[],
  start: number,
  fold: boolean,
): { value: string; next: number } {
  const collected: string[] = []
  let i = start
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      collected.push('')
      continue
    }
    if (indentOf(line) === 0) break
    collected.push(line.trim())
  }
  while (collected.length > 0 && collected[collected.length - 1] === '') {
    collected.pop()
  }
  return { value: collected.join(fold ? ' ' : '\n'), next: i }
}

/**
 * Collects whatever block follows a key with no inline value: a list of
 * `- item` lines, or an indented mapping of `key: value` lines. Deeper
 * nesting inside the mapping is skipped so it cannot be mistaken for the next
 * top-level key.
 */
function readBlock(
  lines: string[],
  start: number,
): { value: string[] | Record<string, string>; next: number } {
  const items: string[] = []
  const mapping: Record<string, string> = {}
  let mappingIndent = -1
  let i = start
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (isSkippable(line)) continue

    const item = line.match(LIST_ITEM_RE)
    if (item) {
      items.push(unquote(stripComment(item[1])))
      continue
    }

    const indent = indentOf(line)
    if (indent === 0) break

    if (mappingIndent === -1) mappingIndent = indent
    if (indent !== mappingIndent) continue // deeper nesting: not modelled
    const entry = line.trim().match(KEY_RE)
    if (entry) {
      const rest = stripComment(entry[2] ?? '')
      if (rest !== '' && !BLOCK_SCALAR_RE.test(rest)) {
        mapping[entry[1]] = rest.startsWith('[')
          ? parseInlineList(rest).join(', ')
          : unquote(rest)
      }
    }
  }
  const value = Object.keys(mapping).length > 0 ? mapping : items
  return { value, next: i }
}

export function parseSimpleYaml(text: string): Record<string, YamlValue> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const data: Record<string, YamlValue> = {}

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isSkippable(line) || indentOf(line) > 0) {
      i++
      continue
    }

    const match = line.match(KEY_RE)
    if (!match) {
      i++
      continue
    }

    const key = match[1]
    const rest = stripComment(match[2] ?? '')

    if (rest === '') {
      const { value, next } = readBlock(lines, i + 1)
      data[key] = value
      i = next
      continue
    }

    if (BLOCK_SCALAR_RE.test(rest)) {
      const { value, next } = readBlockScalar(lines, i + 1, rest.startsWith('>'))
      data[key] = value
      i = next
      continue
    }

    data[key] = rest.startsWith('[') ? parseInlineList(rest) : unquote(rest)
    i++
  }

  return data
}

export function parseFrontmatter(raw: string): Frontmatter {
  const normalized = raw.replace(/\r\n/g, '\n')
  const match = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!match) {
    return { data: {}, body: normalized, hasFrontmatter: false, bodyStartLine: 1 }
  }

  return {
    data: parseSimpleYaml(match[1]),
    body: normalized.slice(match[0].length),
    hasFrontmatter: true,
    bodyStartLine: match[0].split('\n').length,
  }
}

/** Reads a key as a string list, tolerating the single-scalar shorthand. */
export function frontmatterList(
  data: Record<string, YamlValue>,
  key: string,
): string[] {
  const value = data[key]
  if (Array.isArray(value)) return value.filter(Boolean)
  return typeof value === 'string' && value ? [value] : []
}

/**
 * The taxonomy categories a skill declares. The spec-conformant home is
 * `metadata.categories` (a comma- or space-separated string, since metadata
 * values must be strings); a top-level `categories:` list is still read as a
 * legacy fallback and flagged by `validate`.
 */
export function declaredCategories(data: Record<string, YamlValue>): string[] {
  const fromMetadata = frontmatterMap(data, 'metadata')?.categories
  if (fromMetadata) {
    return fromMetadata
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
  }
  return frontmatterList(data, 'categories')
}

/** Reads a key as a non-empty string, or undefined when absent or a list. */
export function frontmatterString(
  data: Record<string, YamlValue>,
  key: string,
): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}
