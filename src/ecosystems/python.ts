import * as fs from 'fs'
import * as path from 'path'
import { isPythonStdlib } from '../pythonStdlib.js'
import { parseToml, tomlStringArray, tomlTable, type TomlTable } from '../toml.js'
import type { ImportBinding, SourceImport } from './types.js'

/**
 * Python: `pyproject.toml` / `requirements*.txt` / `Pipfile` / `setup.cfg` /
 * `setup.py` declare, `import` and `from ... import` use. Distribution names
 * are PEP 503-normalized (`Django` -> `django`, `python_dotenv` ->
 * `python-dotenv`); import names are mapped through `PYTHON_IMPORT_TO_DIST`
 * for known mismatches (`sklearn` -> `scikit-learn`, `PIL` -> `pillow`, etc.)
 * and PEP 503-normalized so declared and imported package names align.
 */

/** PEP 503 name normalization. */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

/**
 * Top PyPI distribution-name vs top-level import-name mismatches. Keys are
 * lowercase import names (or two-segment namespace imports like
 * `google.protobuf`); values are PEP 503-normalized distribution names.
 */
export const PYTHON_IMPORT_TO_DIST: Readonly<Record<string, string>> = {
  sklearn: 'scikit-learn',
  skimage: 'scikit-image',
  pil: 'pillow',
  cv2: 'opencv-python',
  bs4: 'beautifulsoup4',
  yaml: 'pyyaml',
  dotenv: 'python-dotenv',
  jwt: 'pyjwt',
  dateutil: 'python-dateutil',
  attr: 'attrs',
  git: 'gitpython',
  crypto: 'pycryptodome',
  cryptodome: 'pycryptodome',
  nacl: 'pynacl',
  serial: 'pyserial',
  usb: 'pyusb',
  magic: 'python-magic',
  slugify: 'python-slugify',
  docx: 'python-docx',
  pptx: 'python-pptx',
  xlsxwriter: 'xlsxwriter',
  multipart: 'python-multipart',
  jose: 'python-jose',
  fitz: 'pymupdf',
  graphql: 'graphql-core',
  openssl: 'pyopenssl',
  zmq: 'pyzmq',
  websocket: 'websocket-client',
  mysqldb: 'mysqlclient',
  tortoise: 'tortoise-orm',
  pydantic_settings: 'pydantic-settings',
  'google.protobuf': 'protobuf',
  'google.cloud': 'google-cloud',
  memcache: 'python-memcached',
  ldap: 'python-ldap',
  daemon: 'python-daemon',
  whois: 'python-whois',
  telegram: 'python-telegram-bot',
  discord: 'discord-py',
  github: 'pygithub',
  socks: 'pysocks',
  dns: 'dnspython',
  cairo: 'pycairo',
  gi: 'pygobject',
  wx: 'wxpython',
  impala: 'impyla',
  levenshtein: 'python-levenshtein',
  editor: 'python-editor',
  rapidjson: 'python-rapidjson',
  pythonjsonlogger: 'python-json-logger',
  decouple: 'python-decouple',
   box: 'python-box',
  dateparser: 'dateparser',
   pinecone: 'pinecone-client',
}

/** Resolves a Python import path (`sklearn.ensemble`, `PIL`, `pydantic_settings`) to its normalized distribution name. */
export function resolvePythonDistName(modulePath: string): string {
  const parts = modulePath.split('.')
  if (parts.length >= 2) {
    const twoSeg = `${parts[0]}.${parts[1]}`.toLowerCase()
    if (twoSeg in PYTHON_IMPORT_TO_DIST) return PYTHON_IMPORT_TO_DIST[twoSeg]
  }
  const top = (parts[0] ?? '').toLowerCase()
  if (top in PYTHON_IMPORT_TO_DIST) return PYTHON_IMPORT_TO_DIST[top]
  return normalizePythonName(top)
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

export interface ReadRequirementsOptions {
  /** Path to the requirements file on disk, used to resolve `-r` / `-c` includes relative to its directory. */
  filePath?: string
  /** Already-visited absolute file paths so recursive `-r` / `-c` includes are cycle-safe. */
  visited?: Set<string>
}

/**
 * Declared dependencies from a requirements.txt-style file. When `options.filePath`
 * is provided, `-r` / `--requirement` and `-c` / `--constraint` includes are
 * resolved relative to the file's directory with cycle detection.
 */
export function readRequirements(
  text: string,
  options: ReadRequirementsOptions = {},
): Record<string, string> {
  const deps: Record<string, string> = {}
  const visited = options.visited ?? new Set<string>()
  if (options.filePath) {
    visited.add(path.resolve(options.filePath))
  }

  // Backslash continuations join lines; inline comments are stripped.
  const joined = text.replace(/\\\r?\n/g, ' ')
  const lines = joined
    .split('\n')
    .map(line => line.replace(/\s#.*$/, '').trim())
    .filter(line => line && !line.startsWith('#'))

  for (const line of lines) {
    const includeMatch = line.match(
      /^(?:-r|--requirement|-c|--constraint)(?:=|\s+)(.+)$/,
    )
    if (includeMatch) {
      if (!options.filePath) continue
      const rawTarget = includeMatch[1].trim().replace(/^['"]|['"]$/g, '')
      if (!rawTarget) continue
      const targetPath = path.resolve(path.dirname(options.filePath), rawTarget)
      if (visited.has(targetPath)) continue
      visited.add(targetPath)
      let includedText: string
      try {
        includedText = fs.readFileSync(targetPath, 'utf-8')
      } catch {
        continue
      }
      const nested = readRequirements(includedText, {
        filePath: targetPath,
        visited,
      })
      for (const [name, version] of Object.entries(nested)) {
        if (!(name in deps)) deps[name] = version
      }
      continue
    }
    if (line.startsWith('-')) continue
    const parsed = parseRequirement(line)
    if (parsed && !(parsed.name in deps)) {
      deps[parsed.name] = parsed.version
    }
  }
  return deps
}

/** Declared dependencies from a Pipfile (`[packages]` and `[dev-packages]`). */
export function readPipfile(text: string): Record<string, string> {
  const deps: Record<string, string> = {}
  let root: TomlTable
  try {
    root = parseToml(text)
  } catch {
    return deps
  }
  addDependencyTable(deps, tomlTable(root, 'packages'))
  addDependencyTable(deps, tomlTable(root, 'dev-packages'))
  return deps
}

/** Declared dependencies from a static `setup.cfg` (`[options]` `install_requires` and `[options.extras_require]`). */
export function readSetupCfg(text: string): Record<string, string> {
  const deps: Record<string, string> = {}
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let section = ''
  let collectingReqKey = false

  const addSpecChunk = (chunk: string) => {
    for (const part of chunk.split('\n')) {
      const cleaned = part.replace(/\s#.*$/, '').trim()
      if (!cleaned || cleaned.startsWith('#')) continue
      const parsed = parseRequirement(cleaned)
      if (parsed && !(parsed.name in deps)) deps[parsed.name] = parsed.version
    }
  }

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    const secMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (secMatch) {
      section = secMatch[1].trim().toLowerCase()
      collectingReqKey = false
      continue
    }

    const isContinuation = /^[ \t]+/.test(raw)
    if (isContinuation && collectingReqKey) {
      addSpecChunk(trimmed)
      continue
    }

    const kvMatch = raw.match(/^([A-Za-z0-9_.-]+)\s*[:=]\s*(.*)$/)
    if (!kvMatch) {
      collectingReqKey = false
      continue
    }
    const key = kvMatch[1].toLowerCase()
    const val = kvMatch[2].trim()

    if (
      section === 'options' &&
      (key === 'install_requires' || key === 'setup_requires' || key === 'tests_require')
    ) {
      collectingReqKey = true
      if (val) addSpecChunk(val)
    } else if (section === 'options.extras_require') {
      collectingReqKey = true
      if (val) addSpecChunk(val)
    } else {
      collectingReqKey = false
    }
  }
  return deps
}

/** Declared dependencies from static `install_requires` and `extras_require` literals in `setup.py`. */
export function readSetupPy(text: string): Record<string, string> {
  const deps: Record<string, string> = {}
  // Strip line comments so commented-out requirements are ignored while keeping string literals intact.
  const withoutComments = text.replace(/^[ \t]*#.*$/gm, '')

  const extractListStrings = (listBody: string) => {
    for (const m of listBody.matchAll(/(['"])((?:\\.|(?!\1)[^\\\r\n])+)\1/g)) {
      const parsed = parseRequirement(m[2])
      if (parsed && !(parsed.name in deps)) deps[parsed.name] = parsed.version
    }
  }

  for (const m of withoutComments.matchAll(
    /\b(?:install_requires|setup_requires|tests_require)\s*=\s*\[([\s\S]*?)\]/g,
  )) {
    extractListStrings(m[1])
  }

  for (const m of withoutComments.matchAll(/\bextras_require\s*=\s*\{([\s\S]*?)\}/g)) {
    for (const listMatch of m[1].matchAll(/\[([\s\S]*?)\]/g)) {
      extractListStrings(listMatch[1])
    }
  }

  return deps
}

/**
 * Lines of Python source with comments and string literals removed, so a
 * docstring that quotes an import does not count as one. Triple-quoted
 * strings are tracked across lines; single-line strings are blanked.
 */
export function stripPythonStringsAndComments(source: string): string {
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
  return resolvePythonDistName(module)
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
