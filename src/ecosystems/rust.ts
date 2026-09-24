import { isTomlTable, parseToml, tomlTable, type TomlTable } from '../toml.js'
import type { ImportBinding, SourceImport } from './types.js'

/**
 * Rust: `Cargo.toml` declares crates, source files `use` them. A crate named
 * `tokio-util` on crates.io is `tokio_util` in code, so declared names are
 * normalized to the identifier form — the one a skill's examples would show.
 */

const RUST_BUILTIN_ROOTS = new Set([
  'std',
  'core',
  'alloc',
  'crate',
  'self',
  'super',
  'Self',
  'proc_macro',
  'test',
])

/** The crate name as it appears in code. */
export function rustCrateName(name: string): string {
  return name.replace(/-/g, '_')
}

/** Reads every dependency section of a Cargo.toml: crate name -> version. */
export function readCargoToml(text: string): Record<string, string> {
  const deps: Record<string, string> = {}
  let root: TomlTable
  try {
    root = parseToml(text)
  } catch {
    return deps
  }

  const addTable = (table: TomlTable | undefined) => {
    if (!table) return
    for (const [rawName, value] of Object.entries(table)) {
      let version = '*'
      // `foo = { package = "bar" }` renames the crate: code refers to `foo`,
      // so the key (not `package`) is the name that matters.
      const name = rustCrateName(rawName)
      if (typeof value === 'string') version = value
      else if (isTomlTable(value)) {
        if (typeof value.version === 'string') version = value.version
        else if (typeof value.path === 'string') version = `path:${value.path}`
        else if (typeof value.git === 'string') version = `git:${value.git}`
        else if (value.workspace === true) version = 'workspace'
      }
      if (!(name in deps)) deps[name] = version
    }
  }

  addTable(tomlTable(root, 'dependencies'))
  addTable(tomlTable(root, 'dev-dependencies'))
  addTable(tomlTable(root, 'build-dependencies'))
  addTable(tomlTable(root, 'workspace', 'dependencies'))
  for (const target of Object.values(tomlTable(root, 'target') ?? {})) {
    if (!isTomlTable(target)) continue
    addTable(tomlTable(target, 'dependencies'))
    addTable(tomlTable(target, 'dev-dependencies'))
    addTable(tomlTable(target, 'build-dependencies'))
  }
  return deps
}

/** Blanks comments (nested block comments included) and string literals. */
function stripRustCommentsAndStrings(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  const blankTo = (stop: number) => {
    out += source.slice(i, stop).replace(/[^\n]/g, ' ')
    i = stop
  }
  while (i < n) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      blankTo(end === -1 ? n : end)
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      let depth = 0
      let j = i
      while (j < n) {
        if (source[j] === '/' && source[j + 1] === '*') {
          depth++
          j += 2
        } else if (source[j] === '*' && source[j + 1] === '/') {
          depth--
          j += 2
          if (depth === 0) break
        } else j++
      }
      blankTo(j)
      continue
    }
    // Raw strings: r"..." / r#"..."# / br"..."
    const raw = source.slice(i, i + 4).match(/^b?r(#*)"/)
    if (raw && (i === 0 || !/[\w]/.test(source[i - 1]))) {
      const closer = `"${raw[1]}`
      const end = source.indexOf(closer, i + raw[0].length)
      blankTo(end === -1 ? n : end + closer.length)
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < n && source[j] !== '"') {
        if (source[j] === '\\') j++
        j++
      }
      blankTo(Math.min(n, j + 1))
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Flattens a `use` tree into (module path, bindings) pairs:
 * `a::b::{c, d::{e, f as g}, self, *}` ->
 *   a::b -> [c, self], a::b::d -> [e, f as g], glob for a::b.
 */
function flattenUseTree(tree: string): { path: string; bindings: ImportBinding[]; glob: boolean }[] {
  const results: { path: string; bindings: ImportBinding[]; glob: boolean }[] = []

  const walk = (prefix: string[], text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const braceAt = trimmed.indexOf('{')
    if (braceAt === -1) {
      // A plain path, possibly renamed: `a::b::c as d`
      const asMatch = trimmed.match(/^(.*?)\s+as\s+([\w]+)$/)
      const pathText = (asMatch ? asMatch[1] : trimmed).trim()
      const parts = pathText.split('::').map(p => p.trim()).filter(Boolean)
      const leaf = parts.pop() ?? ''
      const modulePath = [...prefix, ...parts]
      if (modulePath.length === 0 && leaf && leaf !== '*' && leaf !== 'self') {
        // `use tokio;` — the crate itself is the item.
        results.push({
          path: leaf,
          bindings: [{ source: leaf, local: asMatch ? asMatch[2] : leaf }],
          glob: false,
        })
      } else if (leaf === '*') {
        results.push({ path: modulePath.join('::'), bindings: [], glob: true })
      } else if (leaf === 'self') {
        const last = modulePath[modulePath.length - 1] ?? ''
        results.push({
          path: modulePath.slice(0, -1).join('::') || last,
          bindings: last ? [{ source: last, local: asMatch ? asMatch[2] : last }] : [],
          glob: false,
        })
      } else if (leaf) {
        results.push({
          path: modulePath.join('::'),
          bindings: [{ source: leaf, local: asMatch ? asMatch[2] : leaf }],
          glob: false,
        })
      }
      return
    }
    const head = trimmed.slice(0, braceAt).replace(/::\s*$/, '').trim()
    const headParts = head ? head.split('::').map(p => p.trim()).filter(Boolean) : []
    const inner = trimmed.slice(braceAt + 1, trimmed.lastIndexOf('}'))
    // Split on top-level commas only.
    let depth = 0
    let current = ''
    const items: string[] = []
    for (const ch of inner) {
      if (ch === '{') depth++
      if (ch === '}') depth--
      if (ch === ',' && depth === 0) {
        items.push(current)
        current = ''
      } else current += ch
    }
    items.push(current)
    for (const item of items) walk([...prefix, ...headParts], item)
  }

  walk([], tree)
  return results
}

/** `use path::to::{items};` including `pub use` / `pub(crate) use` */
const USE_RE = /\buse\s+([^;]+);/g
/** `extern crate name;` | `extern crate name as alias;` */
const EXTERN_CRATE_RE = /\bextern\s+crate\s+(\w+)(?:\s+as\s+(\w+))?\s*;/g
/** Bare path usage without `use`: `serde_json::json!(...)` */
const PATH_USE_RE = /(?<![\w:])([a-z_][a-z0-9_]*)::(?!:)/g

export interface RustScanOptions {
  /**
   * Crates declared by the project. When given, bare `crate_name::item`
   * paths count as usage of that crate even without a `use` line — a common
   * Rust style the repo side should not miss. Skills are scanned without it,
   * since a bare path could just as well be a local module.
   */
  declaredCrates?: Set<string>
}

function rustPackageName(root: string): string {
  if (!root || RUST_BUILTIN_ROOTS.has(root)) return ''
  return root
}

/** Every `use`, `extern crate` and (optionally) bare crate path in a Rust source. */
export function scanRustImports(
  source: string,
  options: RustScanOptions = {},
): SourceImport[] {
  const normalized = source.replace(/\r\n/g, '\n')
  const text = stripRustCommentsAndStrings(normalized)
  const imports: SourceImport[] = []
  const seenBare = new Set<string>()

  for (const m of text.matchAll(USE_RE)) {
    const start = m.index
    const end = start + m[0].length
    for (const entry of flattenUseTree(m[1])) {
      if (!entry.path) continue
      const root = entry.path.split('::')[0] ?? ''
      const packageName = rustPackageName(root)
      // A single-segment `use foo;` is a local module unless the project
      // declares a crate of that name; with no declaration list, keep it.
      if (
        options.declaredCrates &&
        !entry.path.includes('::') &&
        !options.declaredCrates.has(root)
      ) {
        continue
      }
      imports.push({
        ecosystem: 'cargo',
        specifier: entry.path,
        packageName,
        bindings: entry.bindings,
        bindingsKnown: !entry.glob,
        text: normalized.slice(start, end).trim(),
        start,
        end,
      })
    }
  }

  for (const m of text.matchAll(EXTERN_CRATE_RE)) {
    const local = m[2] ?? m[1]
    imports.push({
      ecosystem: 'cargo',
      specifier: m[1],
      packageName: rustPackageName(m[1]),
      bindings: [{ source: m[1], local }],
      bindingsKnown: true,
      text: normalized.slice(m.index, m.index + m[0].length).trim(),
      start: m.index,
      end: m.index + m[0].length,
    })
  }

  if (options.declaredCrates) {
    for (const m of text.matchAll(PATH_USE_RE)) {
      const root = m[1]
      if (!options.declaredCrates.has(root) || seenBare.has(root)) continue
      // Skip roots already covered by a `use` line.
      if (imports.some(imp => imp.packageName === root)) continue
      seenBare.add(root)
      const lineStart = text.lastIndexOf('\n', m.index) + 1
      const lineEndAt = text.indexOf('\n', m.index)
      const lineEnd = lineEndAt === -1 ? text.length : lineEndAt
      imports.push({
        ecosystem: 'cargo',
        specifier: root,
        packageName: root,
        bindings: [{ source: root, local: root }],
        bindingsKnown: true,
        text: normalized.slice(lineStart, lineEnd).trim(),
        start: lineStart,
        end: lineEnd,
      })
    }
  }

  return imports.sort((a, b) => a.start - b.start)
}
