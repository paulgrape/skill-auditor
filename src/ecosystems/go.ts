import type { SourceImport } from './types.js'

/**
 * Go: `go.mod` declares modules, source files import package paths. A module
 * is identified by its path; the standard library has no dot in the first
 * path segment (`fmt`, `net/http`) and is not a dependency.
 */

/** Hosts whose module paths are `host/owner/repo`; other hosts are `host/name`. */
const THREE_SEGMENT_HOSTS = new Set([
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'golang.org',
  'codeberg.org',
  'gitee.com',
])

export interface GoModule {
  /** The `module` directive, i.e. the project's own import path prefix */
  modulePath: string
  /** Direct requirements: module path -> version */
  require: Record<string, string>
  /** Indirect requirements (`// indirect`): module path -> version */
  indirect: Record<string, string>
  /** Replace directives: replaced module path -> target (local path or module path) */
  replace: Record<string, string>
}

export interface GoWork {
  /** Workspace member directories from `use` directives */
  use: string[]
  /** Replace directives in go.work */
  replace: Record<string, string>
}

/**
 * Reduces an import path to the module that most likely provides it. The
 * same heuristic runs on both sides of the audit so a skill's
 * `github.com/gin-gonic/gin/binding` and the repo's `github.com/gin-gonic/gin`
 * land on one name. `localModules` (one path or several, for a repo with
 * more than one go.mod) excludes the project's own packages.
 */
export function goPackageName(
  importPath: string,
  localModules?: string | readonly string[],
): string {
  const segments = importPath.split('/')
  const host = segments[0] ?? ''
  if (!host.includes('.')) return '' // standard library or a bare local path
  const locals = typeof localModules === 'string' ? [localModules] : localModules ?? []
  if (locals.some(local => local && (importPath === local || importPath.startsWith(local + '/')))) {
    return ''
  }
  const depth = THREE_SEGMENT_HOSTS.has(host) ? 3 : 2
  return segments.slice(0, depth).join('/')
}

function parseReplaceEntry(
  entry: string,
  targetMap: Record<string, string>,
): void {
  const cleaned = entry.replace(/\/\/.*$/, '').trim()
  const arrowAt = cleaned.indexOf('=>')
  if (arrowAt === -1) return
  const left = cleaned.slice(0, arrowAt).trim().split(/\s+/)[0] ?? ''
  const right = cleaned.slice(arrowAt + 2).trim().split(/\s+/)[0] ?? ''
  if (!left || !right) return
  const from = goPackageName(left) || left
  const to =
    right.startsWith('./') || right.startsWith('../') || right.startsWith('/')
      ? right
      : goPackageName(right) || right
  targetMap[from] = to
}

/**
 * Reads the `module` directive, direct and `// indirect` `require` entries,
 * and `replace` directives of a go.mod. Required module paths go through the
 * same reduction as imports, so `github.com/redis/go-redis/v9` in go.mod and
 * the `v9` import path in source land on one name.
 */
export function readGoMod(text: string): GoModule {
  const result: GoModule = {
    modulePath: '',
    require: {},
    indirect: {},
    replace: {},
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let blockKind: 'require' | 'replace' | null = null

  for (const raw of lines) {
    const line = raw.replace(/\/\/(.*)$/, (_m, comment: string) =>
      /\bindirect\b/.test(comment) ? ' // indirect' : '',
    ).trim()
    if (!line) continue

    if (line.startsWith('module ')) {
      result.modulePath = line.slice('module '.length).trim().replace(/^"|"$/g, '')
      continue
    }
    if (line === 'require (') {
      blockKind = 'require'
      continue
    }
    if (line === 'replace (') {
      blockKind = 'replace'
      continue
    }
    if (blockKind && line === ')') {
      blockKind = null
      continue
    }

    if (blockKind === 'replace' || line.startsWith('replace ')) {
      const replaceBody =
        blockKind === 'replace' ? line : line.slice('replace '.length)
      parseReplaceEntry(replaceBody, result.replace)
      continue
    }

    const entry =
      blockKind === 'require'
        ? line
        : line.startsWith('require ')
          ? line.slice('require '.length)
          : null
    if (entry === null) continue
    const isIndirect = /\/\/ indirect$/.test(entry)
    const stripped = isIndirect ? entry.replace(/\/\/ indirect$/, '').trim() : entry
    const match = stripped.match(/^(\S+)\s+(\S+)/)
    if (!match) continue
    const name = goPackageName(match[1]) || match[1]
    if (isIndirect) {
      if (!(name in result.indirect)) result.indirect[name] = match[2]
    } else {
      if (!(name in result.require)) result.require[name] = match[2]
    }
  }
  return result
}

/** Reads `use` and `replace` directives from a `go.work` file. */
export function readGoWork(text: string): GoWork {
  const result: GoWork = { use: [], replace: {} }
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let blockKind: 'use' | 'replace' | null = null

  const pushUse = (rawDir: string) => {
    const dir = rawDir.trim().replace(/^"|"$/g, '')
    if (dir && !result.use.includes(dir)) result.use.push(dir)
  }

  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (!line) continue
    if (line === 'use (') {
      blockKind = 'use'
      continue
    }
    if (line === 'replace (') {
      blockKind = 'replace'
      continue
    }
    if (blockKind && line === ')') {
      blockKind = null
      continue
    }
    if (blockKind === 'use') {
      pushUse(line)
      continue
    }
    if (line.startsWith('use ')) {
      pushUse(line.slice('use '.length))
      continue
    }
    if (blockKind === 'replace' || line.startsWith('replace ')) {
      const body = blockKind === 'replace' ? line : line.slice('replace '.length)
      parseReplaceEntry(body, result.replace)
    }
  }
  return result
}

/** Blanks comments and raw strings so a quoted `import` in a comment is not read. */
export function stripGoComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? n : end
      out += ' '.repeat(stop - i)
      i = stop
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    if (c === '`') {
      const end = source.indexOf('`', i + 1)
      const stop = end === -1 ? n : end + 1
      out += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    out += c
    i++
  }
  return out
}

/** `import "path"` | `import alias "path"` */
const SINGLE_IMPORT_RE = /\bimport\s+(?:([\w.]+)\s+)?"([^"\n]+)"/g
/** `import ( ... )` */
const BLOCK_IMPORT_RE = /\bimport\s*\(([^)]*)\)/g
/** One line inside a block: `alias "path"` or `"path"` */
const BLOCK_ENTRY_RE = /(?:([\w.]+)\s+)?"([^"\n]+)"/g

export interface GoScanOptions {
  /** The project's own module path, whose packages are not dependencies */
  localModule?: string
  /**
   * Every module path the project declares. A repo with several go.mod files
   * (an API at the root, a worker under `services/`) owns all of them, so an
   * import of any is local, not a dependency.
   */
  localModules?: readonly string[]
}

/**
 * Every import in a Go source. The binding is the package's local name (its
 * alias, or the last path segment), which is what usage looks like: `gin.`.
 */
export function scanGoImports(
  source: string,
  options: GoScanOptions = {},
): SourceImport[] {
  const normalized = source.replace(/\r\n/g, '\n')
  const text = stripGoComments(normalized)
  const imports: SourceImport[] = []
  const localModules = [
    ...(options.localModule ? [options.localModule] : []),
    ...(options.localModules ?? []),
  ]

  const push = (start: number, end: number, alias: string | undefined, path: string) => {
    const local = alias && alias !== '_' && alias !== '.' ? alias : path.split('/').pop() ?? path
    const bindings = alias === '_' || alias === '.' ? [] : [{ source: local, local }]
    imports.push({
      ecosystem: 'go',
      specifier: path,
      packageName: goPackageName(path, localModules),
      bindings,
      bindingsKnown: true,
      text: normalized.slice(start, end).trim(),
      start,
      end,
    })
  }

  for (const m of text.matchAll(BLOCK_IMPORT_RE)) {
    const bodyStart = m.index + m[0].indexOf('(') + 1
    for (const entry of m[1].matchAll(BLOCK_ENTRY_RE)) {
      const start = bodyStart + entry.index
      push(start, start + entry[0].length, entry[1], entry[2])
    }
  }
  for (const m of text.matchAll(SINGLE_IMPORT_RE)) {
    push(m.index, m.index + m[0].length, m[1], m[2])
  }

  return imports.sort((a, b) => a.start - b.start)
}
