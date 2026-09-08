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
}

/**
 * Reduces an import path to the module that most likely provides it. The
 * same heuristic runs on both sides of the audit so a skill's
 * `github.com/gin-gonic/gin/binding` and the repo's `github.com/gin-gonic/gin`
 * land on one name. `localModule` excludes the project's own packages.
 */
export function goPackageName(importPath: string, localModule?: string): string {
  const segments = importPath.split('/')
  const host = segments[0] ?? ''
  if (!host.includes('.')) return '' // standard library or a bare local path
  if (localModule && (importPath === localModule || importPath.startsWith(localModule + '/'))) {
    return ''
  }
  const depth = THREE_SEGMENT_HOSTS.has(host) ? 3 : 2
  return segments.slice(0, depth).join('/')
}

/**
 * Reads the `module` directive and direct `require` entries of a go.mod.
 * Required module paths go through the same reduction as imports, so
 * `github.com/redis/go-redis/v9` in go.mod and the `v9` import path in source
 * land on one name (indirect requirements are transitive, not the stack).
 */
export function readGoMod(text: string): GoModule {
  const result: GoModule = { modulePath: '', require: {} }
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let inRequireBlock = false

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
      inRequireBlock = true
      continue
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false
      continue
    }

    const entry = inRequireBlock
      ? line
      : line.startsWith('require ')
        ? line.slice('require '.length)
        : null
    if (entry === null) continue
    if (/\/\/ indirect$/.test(entry)) continue // transitive, not the project's stack
    const match = entry.match(/^(\S+)\s+(\S+)/)
    if (!match) continue
    const name = goPackageName(match[1]) || match[1]
    if (!(name in result.require)) result.require[name] = match[2]
  }
  return result
}

/** Blanks comments and raw strings so a quoted `import` in a comment is not read. */
function stripGoComments(source: string): string {
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

  const push = (start: number, end: number, alias: string | undefined, path: string) => {
    const local = alias && alias !== '_' && alias !== '.' ? alias : path.split('/').pop() ?? path
    const bindings = alias === '_' || alias === '.' ? [] : [{ source: local, local }]
    imports.push({
      ecosystem: 'go',
      specifier: path,
      packageName: goPackageName(path, options.localModule),
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
