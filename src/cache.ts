import { createHash } from 'crypto'
import fg from 'fast-glob'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { setAwareReplacer } from './envelope.js'
import { DEFAULT_IGNORE } from './ignore.js'
import type { RepoReality } from './types.js'
import { readPackageVersion } from './version.js'

/**
 * Caches the RepoReality of a project between runs. The expensive part of a
 * scan is parsing every source file with the TypeScript compiler; an
 * agent's audit-fix-audit loop repeats it many times against an unchanged
 * repo. The cache is keyed on a fingerprint of every file the scan would
 * read (path, mtime, size), so any edit to project source invalidates it —
 * there is no way to get a stale reality by accident, only a slow one.
 *
 * Disk location: `$SKILL_AUDITOR_CACHE_DIR`, else `node_modules/.cache/
 * skill-auditor/` under the project when node_modules exists, else the OS
 * temp dir. `SKILL_AUDITOR_NO_CACHE=1` or `{ cache: false }` bypasses it.
 */

const SOURCE_GLOB = ['**/*.{ts,tsx,js,jsx,mjs,cjs}']
const MANIFEST_GLOB = [
  'package.json',
  '**/package.json',
  'pnpm-workspace.yaml',
  '.skill-auditor.json',
]

interface CacheEntry {
  version: string
  fingerprint: string
  reality: RepoReality
}

interface SerializedReality {
  declaredDeps: Record<string, string>
  usedImports: Record<string, string[]>
  usedIdentifiers: Record<string, string[]>
  importEvidence: RepoReality['importEvidence']
}

const memory = new Map<string, CacheEntry>()

export function cacheDisabledByEnv(): boolean {
  const value = process.env.SKILL_AUDITOR_NO_CACHE
  return value !== undefined && value !== '' && value !== '0'
}

function cacheDir(projectRoot: string): string {
  const override = process.env.SKILL_AUDITOR_CACHE_DIR
  if (override) return override
  const nodeModules = path.join(projectRoot, 'node_modules')
  if (fs.existsSync(nodeModules)) {
    return path.join(nodeModules, '.cache', 'skill-auditor')
  }
  return path.join(os.tmpdir(), 'skill-auditor-cache')
}

function cacheFile(projectRoot: string): string {
  const key = createHash('sha1').update(projectRoot).digest('hex').slice(0, 16)
  return path.join(cacheDir(projectRoot), `${key}.json`)
}

/**
 * A digest of everything the scan reads plus everything that changes how it
 * reads (ignore globs, tool version). Cheap relative to parsing: one stat
 * per file, no file contents.
 */
export function fingerprintProject(projectRoot: string): string {
  const entries = fg.sync([...SOURCE_GLOB, ...MANIFEST_GLOB], {
    cwd: projectRoot,
    ignore: DEFAULT_IGNORE,
    stats: true,
    onlyFiles: true,
  })
  const lines = entries
    .map(entry => {
      const stats = entry.stats
      return `${entry.path}|${stats?.mtimeMs ?? 0}|${stats?.size ?? 0}`
    })
    .sort()
  const hash = createHash('sha1')
  hash.update(readPackageVersion())
  hash.update('\n' + [...DEFAULT_IGNORE].sort().join(','))
  hash.update('\n' + lines.join('\n'))
  return hash.digest('hex')
}

function revive(serialized: SerializedReality): RepoReality {
  const toSets = (record: Record<string, string[]>) =>
    Object.fromEntries(
      Object.entries(record).map(([key, list]) => [key, new Set(list)]),
    )
  return {
    declaredDeps: serialized.declaredDeps ?? {},
    usedImports: toSets(serialized.usedImports ?? {}),
    usedIdentifiers: toSets(serialized.usedIdentifiers ?? {}),
    importEvidence: serialized.importEvidence ?? {},
  }
}

function readDisk(projectRoot: string): CacheEntry | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(projectRoot), 'utf-8'))
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof raw.fingerprint !== 'string' ||
      typeof raw.reality !== 'object'
    ) {
      return null
    }
    return {
      version: String(raw.version),
      fingerprint: raw.fingerprint,
      reality: revive(raw.reality as SerializedReality),
    }
  } catch {
    return null
  }
}

function writeDisk(projectRoot: string, entry: CacheEntry): void {
  try {
    const file = cacheFile(projectRoot)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(entry, setAwareReplacer))
  } catch {
    // Read-only checkout or unwritable temp dir: caching is best-effort.
  }
}

/** Returns the cached reality when its fingerprint still matches, else null. */
export function readCachedReality(
  projectRoot: string,
  fingerprint: string,
): RepoReality | null {
  const key = path.resolve(projectRoot)
  const inMemory = memory.get(key)
  if (inMemory && inMemory.fingerprint === fingerprint) return inMemory.reality

  const onDisk = readDisk(key)
  if (onDisk && onDisk.fingerprint === fingerprint) {
    memory.set(key, onDisk)
    return onDisk.reality
  }
  return null
}

export function writeCachedReality(
  projectRoot: string,
  fingerprint: string,
  reality: RepoReality,
): void {
  const key = path.resolve(projectRoot)
  const entry: CacheEntry = { version: readPackageVersion(), fingerprint, reality }
  memory.set(key, entry)
  writeDisk(key, entry)
}

/** Forgets every in-process entry (tests, long-running servers). */
export function clearRealityCache(): void {
  memory.clear()
}
