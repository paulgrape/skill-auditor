import { isPythonStdlib } from '../pythonStdlib.js'
import { parseToml, tomlStringArray, tomlTable, type TomlTable } from '../toml.js'
import type { ImportBinding, SourceImport } from './types.js'

/**
 * Python: `pyproject.toml` / `requirements*.txt` declare, `import` and
 * `from ... import` use. Distribution names are PEP 503-normalized
 * (`Django` -> `django`, `python_dotenv` -> `python-dotenv`); import names are
 * whatever the source writes. The two coincide for most packages, and when
 * they do not (`scikit-learn` / `sklearn`) the import side of the ground truth
 * still matches a skill that imports the same module the repo does.
 */

/** PEP 503 name normalization. */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

/**
 * Splits a PEP 508 requirement (`requests[security]>=2.0; python_version>"3"`)
 * into a normalized name and its version specifier ('*' when unpinned).
 */
export function parseRequirement(spec: string): { name: string; version: string } | null {
  const trimmed = spec.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) return null
  // URL requirements (`pkg @ https://...`) and bare URLs/paths carry no usable version.
  const match = trimmed.match(/^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(\[[^\]]*\])?\s*(.*)$/)
  if (!match) return null
  const name = normalizePythonName(match[1])
  let rest = match[3].split(';')[0].trim()
  if (rest.startsWith('@')) rest = rest.slice(1).trim()
  return { name, version: rest || '*' }
}

function addRequirementList(
  deps: Record<string, string>,
  list: string[],
): void {
  for (const spec of list) {
    const parsed = parseRequirement(spec)
    if (parsed && !(parsed.name in deps)) deps[parsed.name] = parsed.version
  }
}

/** Poetry/PDM-style `name = "^1.0"` or `name = { version = "...", ... }` tables. */
function addDependencyTable(
  deps: Record<string, string>,
  table: TomlTable | undefined,
): void {
  if (!table) return
  for (const [rawName, value] of Object.entries(table)) {
    if (rawName === 'python') continue
    const name = normalizePythonName(rawName)
    let version = '*'
    if (typeof value === 'string') version = value
    else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const v = value.version
      if (typeof v === 'string') version = v
      else if (typeof value.path === 'string') version = `path:${value.path}`
      else if (typeof value.git === 'string') version = `git:${value.git}`
    }
    if (!(name in deps)) deps[name] = version
  }
}

/** Declared dependencies from a pyproject.toml (PEP 621, PEP 735, Poetry, PDM). */
export function readPyproject(text: string): Record<string, string> {
  const deps: Record<string, string> = {}
  let root: TomlTable
  try {
    root = parseToml(text)
  } catch {
    return deps
  }

  addRequirementList(deps, tomlStringArray(root, 'project', 'dependencies'))
  for (const list of Object.values(tomlTable(root, 'project', 'optional-dependencies') ?? {})) {
    if (Array.isArray(list)) {
      addRequirementList(deps, list.filter((x): x is string => typeof x === 'string'))
    }
  }
  for (const list of Object.values(tomlTable(root, 'dependency-groups') ?? {})) {
    if (Array.isArray(list)) {
      addRequirementList(deps, list.filter((x): x is string => typeof x === 'string'))
    }
  }

  const poetry = tomlTable(root, 'tool', 'poetry')
  if (poetry) {
    addDependencyTable(deps, tomlTable(poetry, 'dependencies'))
    addDependencyTable(deps, tomlTable(poetry, 'dev-dependencies'))
    for (const group of Object.values(tomlTable(poetry, 'group') ?? {})) {
      if (typeof group === 'object' && group !== null && !Array.isArray(group)) {
        addDependencyTable(deps, tomlTable(group as TomlTable, 'dependencies'))
      }
    }
  }
  for (const list of Object.values(tomlTable(root, 'tool', 'pdm', 'dev-dependencies') ?? {})) {
    if (Array.isArray(list)) {
      addRequirementList(deps, list.filter((x): x is string => typeof x === 'string'))
    }
  }

  return deps
}

/** Declared dependencies from a requirements.txt-style file. */
export function readRequirements(text: string): Record<string, string> {
  const deps: Record<string, string> = {}
  // Backslash continuations join lines; comments and pip options are dropped.
  const joined = text.replace(/\\\r?\n/g, ' ')
  addRequirementList(
    deps,
    joined
      .split('\n')
      .map(line => line.replace(/\s#.*$/, '').trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('-')),
  )
  return deps
}

/**
 * Lines of Python source with comments and string literals removed, so a
 * docstring that quotes an import does not count as one. Triple-quoted
 * strings are tracked across lines; single-line strings are blanked.
 */
function stripPythonStringsAndComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    if (c === '#') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? n : end
      out += ' '.repeat(stop - i) // same length: offsets stay aligned
      i = stop
      continue
    }
    if (c === '"' || c === "'") {
      const triple = source[i + 1] === c && source[i + 2] === c
      if (triple) {
        const end = source.indexOf(c.repeat(3), i + 3)
        const stop = end === -1 ? n : end + 3
        out += source.slice(i, stop).replace(/[^\n]/g, ' ')
        i = stop
        continue
      }
      let j = i + 1
      while (j < n && source[j] !== c && source[j] !== '\n') {
        if (source[j] === '\\') j++
        j++
      }
      const stop = j < n && source[j] === c ? j + 1 : j
      out += ' '.repeat(stop - i)
      i = stop
      continue
    }
    out += c
    i++
  }
  return out
}

export interface PythonScanOptions {
  /** Top-level module names that are part of the project itself, not dependencies */
  localModules?: Set<string>
}

function pythonPackage(module: string, options: PythonScanOptions): string {
  const top = module.split('.')[0]
  if (!top || module.startsWith('.')) return ''
  if (isPythonStdlib(top)) return ''
  if (options.localModules?.has(top)) return ''
  return top
}

/** `import a.b as c, d` — one entry per comma-separated module. */
const IMPORT_RE = /^[ \t]*import[ \t]+([^\n]+)$/gm
/** `from a.b import (x, y as z)` — the parenthesized list may span lines. */
const FROM_IMPORT_RE = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)/gm

/**
 * Every import statement in a Python source. `import numpy as np` binds the
 * module itself under its local name; `from x import a as b` binds `a` as `b`.
 */
export function scanPythonImports(
  source: string,
  options: PythonScanOptions = {},
): SourceImport[] {
  const normalized = source.replace(/\r\n/g, '\n')
  const text = stripPythonStringsAndComments(normalized)
  const imports: SourceImport[] = []

  for (const m of text.matchAll(IMPORT_RE)) {
    const body = m[1].replace(/\\\s*$/, '').trim()
    if (!body) continue
    const start = m.index
    const end = start + m[0].length
    for (const part of body.split(',')) {
      const entry = part.trim().match(/^([\w.]+)(?:\s+as\s+(\w+))?$/)
      if (!entry) continue
      const module = entry[1]
      const local = entry[2] ?? module.split('.')[0]
      const binding: ImportBinding = { source: local, local }
      imports.push({
        ecosystem: 'python',
        specifier: module,
        packageName: pythonPackage(module, options),
        bindings: [binding],
        bindingsKnown: true,
        text: normalized.slice(start, end).trim(),
        start,
        end,
      })
    }
  }

  for (const m of text.matchAll(FROM_IMPORT_RE)) {
    const module = m[1]
    const start = m.index
    const end = start + m[0].length
    const names = m[2].replace(/[()]/g, '')
    const bindings: ImportBinding[] = []
    for (const part of names.split(',')) {
      const entry = part.trim().match(/^(\w+|\*)(?:\s+as\s+(\w+))?$/)
      if (!entry || entry[1] === '*') continue
      bindings.push({ source: entry[1], local: entry[2] ?? entry[1] })
    }
    imports.push({
      ecosystem: 'python',
      specifier: module,
      packageName: pythonPackage(module, options),
      bindings,
      bindingsKnown: true,
      text: normalized.slice(start, end).trim(),
      start,
      end,
    })
  }

  return imports.sort((a, b) => a.start - b.start)
}
