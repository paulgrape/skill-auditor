/**
 * Minimal TOML reader for the subset dependency manifests use: tables,
 * dotted and quoted keys, strings (basic, literal, multi-line), numbers,
 * booleans, arrays (multi-line, trailing commas, comments) and inline tables.
 * Dates are kept as strings. Arrays of tables (`[[x]]`) become arrays.
 *
 * Dependency-free on purpose, like the YAML reader: pyproject.toml and
 * Cargo.toml only need `[table]` + `key = value` to yield a dependency list.
 */

export type TomlValue =
  | string
  | number
  | boolean
  | TomlValue[]
  | { [key: string]: TomlValue }

export type TomlTable = { [key: string]: TomlValue }

class Reader {
  pos = 0
  constructor(readonly text: string) {}

  peek(offset = 0): string {
    return this.text[this.pos + offset] ?? ''
  }

  eof(): boolean {
    return this.pos >= this.text.length
  }

  /** Skips spaces, tabs and comments, staying on the current line. */
  skipInline(): void {
    while (!this.eof()) {
      const c = this.peek()
      if (c === ' ' || c === '\t' || c === '\r') this.pos++
      else if (c === '#') this.skipToLineEnd()
      else break
    }
  }

  /** Skips whitespace, newlines and comments. */
  skipAll(): void {
    while (!this.eof()) {
      const c = this.peek()
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') this.pos++
      else if (c === '#') this.skipToLineEnd()
      else break
    }
  }

  skipToLineEnd(): void {
    while (!this.eof() && this.peek() !== '\n') this.pos++
  }
}

function isBareKeyChar(c: string): boolean {
  return /[A-Za-z0-9_-]/.test(c)
}

function readBasicString(r: Reader): string {
  // Opening quote already consumed. Handles escapes; stops at the closing quote.
  let out = ''
  while (!r.eof()) {
    const c = r.peek()
    if (c === '"') {
      r.pos++
      return out
    }
    if (c === '\\') {
      const next = r.peek(1)
      const escapes: Record<string, string> = {
        n: '\n',
        t: '\t',
        r: '\r',
        '"': '"',
        '\\': '\\',
        b: '\b',
        f: '\f',
      }
      if (next in escapes) {
        out += escapes[next]
        r.pos += 2
        continue
      }
      if (next === 'u' || next === 'U') {
        const length = next === 'u' ? 4 : 8
        const hex = r.text.slice(r.pos + 2, r.pos + 2 + length)
        out += String.fromCodePoint(parseInt(hex, 16) || 0)
        r.pos += 2 + length
        continue
      }
      out += next
      r.pos += 2
      continue
    }
    if (c === '\n') break // unterminated: end at the line
    out += c
    r.pos++
  }
  return out
}

function readMultilineString(r: Reader, quote: '"' | "'"): string {
  // Opening triple already consumed.
  const closing = quote.repeat(3)
  const end = r.text.indexOf(closing, r.pos)
  const body = end === -1 ? r.text.slice(r.pos) : r.text.slice(r.pos, end)
  r.pos = end === -1 ? r.text.length : end + 3
  // A newline immediately after the opening delimiter is trimmed.
  return body.replace(/^\r?\n/, '')
}

function readLiteralString(r: Reader): string {
  const end = r.text.indexOf("'", r.pos)
  const lineEnd = r.text.indexOf('\n', r.pos)
  const terminated = end !== -1 && (lineEnd === -1 || end < lineEnd)
  const stop = terminated ? end : lineEnd === -1 ? r.text.length : lineEnd
  const value = r.text.slice(r.pos, stop)
  r.pos = terminated ? end + 1 : stop // unterminated: end at the line
  return value
}

function readKeyPart(r: Reader): string {
  const c = r.peek()
  if (c === '"') {
    r.pos++
    return readBasicString(r)
  }
  if (c === "'") {
    r.pos++
    return readLiteralString(r)
  }
  let key = ''
  while (!r.eof() && isBareKeyChar(r.peek())) {
    key += r.peek()
    r.pos++
  }
  return key
}

/** Reads `a.b."c d"` into its parts. */
function readDottedKey(r: Reader): string[] {
  const parts: string[] = []
  for (;;) {
    r.skipInline()
    parts.push(readKeyPart(r))
    r.skipInline()
    if (r.peek() === '.') {
      r.pos++
      continue
    }
    return parts
  }
}

function readArray(r: Reader): TomlValue[] {
  // '[' already consumed.
  const items: TomlValue[] = []
  for (;;) {
    r.skipAll()
    if (r.eof()) return items
    if (r.peek() === ']') {
      r.pos++
      return items
    }
    items.push(readValue(r))
    r.skipAll()
    if (r.peek() === ',') r.pos++
  }
}

function readInlineTable(r: Reader): TomlTable {
  // '{' already consumed.
  const table: TomlTable = {}
  for (;;) {
    r.skipAll()
    if (r.eof()) return table
    if (r.peek() === '}') {
      r.pos++
      return table
    }
    const key = readDottedKey(r)
    r.skipInline()
    if (r.peek() === '=') r.pos++
    r.skipInline()
    assign(table, key, readValue(r))
    r.skipAll()
    if (r.peek() === ',') r.pos++
  }
}

function readValue(r: Reader): TomlValue {
  r.skipInline()
  const c = r.peek()
  if (c === '"') {
    if (r.peek(1) === '"' && r.peek(2) === '"') {
      r.pos += 3
      return readMultilineString(r, '"')
    }
    r.pos++
    return readBasicString(r)
  }
  if (c === "'") {
    if (r.peek(1) === "'" && r.peek(2) === "'") {
      r.pos += 3
      return readMultilineString(r, "'")
    }
    r.pos++
    return readLiteralString(r)
  }
  if (c === '[') {
    r.pos++
    return readArray(r)
  }
  if (c === '{') {
    r.pos++
    return readInlineTable(r)
  }
  // Bare scalar: up to a delimiter.
  let raw = ''
  while (!r.eof() && !/[\s,\]}#]/.test(r.peek())) {
    raw += r.peek()
    r.pos++
  }
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^[+-]?(?:\d[\d_]*)(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?$/.test(raw)) {
    return Number(raw.replace(/_/g, ''))
  }
  if (/^0x[0-9a-fA-F_]+$/.test(raw)) return parseInt(raw.replace(/_/g, ''), 16)
  return raw // dates, inf/nan, or something we do not model
}

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Walks (creating) nested tables for every part but the last, then sets the leaf. */
function assign(root: TomlTable, key: string[], value: TomlValue): void {
  let table = root
  for (const part of key.slice(0, -1)) {
    const existing = table[part]
    if (!isTable(existing)) table[part] = {}
    table = table[part] as TomlTable
  }
  const leaf = key[key.length - 1] ?? ''
  table[leaf] = value
}

/** Resolves (creating) the table a `[header]` names. */
function tableAt(root: TomlTable, key: string[]): TomlTable {
  let table = root
  for (const part of key) {
    const existing = table[part]
    if (Array.isArray(existing)) {
      // Continue into the latest array-of-tables entry.
      const last = existing[existing.length - 1]
      if (isTable(last)) {
        table = last
        continue
      }
    }
    if (!isTable(existing)) table[part] = {}
    table = table[part] as TomlTable
  }
  return table
}

export function parseToml(text: string): TomlTable {
  const r = new Reader(text.replace(/\r\n/g, '\n'))
  const root: TomlTable = {}
  let current = root

  for (;;) {
    r.skipAll()
    if (r.eof()) return root

    if (r.peek() === '[') {
      const isArrayTable = r.peek(1) === '['
      r.pos += isArrayTable ? 2 : 1
      const key = readDottedKey(r)
      r.skipInline()
      if (r.peek() === ']') r.pos++
      if (isArrayTable && r.peek() === ']') r.pos++

      if (isArrayTable) {
        const parent = tableAt(root, key.slice(0, -1))
        const leaf = key[key.length - 1] ?? ''
        const list = Array.isArray(parent[leaf]) ? (parent[leaf] as TomlValue[]) : []
        const entry: TomlTable = {}
        list.push(entry)
        parent[leaf] = list
        current = entry
      } else {
        current = tableAt(root, key)
      }
      r.skipToLineEnd()
      continue
    }

    const key = readDottedKey(r)
    r.skipInline()
    if (r.peek() !== '=') {
      // Not a key/value line we understand: skip it.
      r.skipToLineEnd()
      continue
    }
    r.pos++
    const value = readValue(r)
    if (key.some(part => part !== '')) assign(current, key, value)
    r.skipToLineEnd()
  }
}

/** Reads a nested table by dotted path, or undefined. */
export function tomlTable(root: TomlTable, ...pathParts: string[]): TomlTable | undefined {
  let table: TomlValue | undefined = root
  for (const part of pathParts) {
    if (!isTable(table)) return undefined
    table = table[part]
  }
  return isTable(table) ? table : undefined
}

/** Reads a string array by dotted path, dropping non-string items. */
export function tomlStringArray(root: TomlTable, ...pathParts: string[]): string[] {
  let value: TomlValue | undefined = root
  for (const part of pathParts) {
    if (!isTable(value)) return []
    value = value[part]
  }
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export { isTable as isTomlTable }
