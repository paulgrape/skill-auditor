import { createHash } from 'crypto'
import fg from 'fast-glob'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { allManifestGlobs, allSourceGlobs } from './ecosystems/globs.js'
import { setAwareReplacer } from './envelope.js'
import { DEFAULT_IGNORE } from './ignore.js'
import { CATEGORY_TAXONOMY } from './taxonomy.js'
import type { RepoReality, SkillIdentifiers } from './types.js'
import { readPackageVersion } from './version.js'

/**
 * Caches the RepoReality of a project and per-skill SkillIdentifiers between
 * runs. The expensive part of a scan is walking and reading every source file;
 * an agent's audit-fix-audit loop (or `audit-all` followed by `gaps`) repeats
 * that work many times against an unchanged repo or skill set.
 *
 * Project and skill fingerprints use a SHA-1 content digest for files up to
 * `CONTENT_HASH_MAX_BYTES` (eliminating stale hits from same-size edits or
 * coarse filesystem mtime granularity) and fall back to `mtimeMs|size` above
 * that threshold so multi-megabyte files are not read just to check the cache.
 * Content read during fingerprinting is retained on the walked tree so a cache
 * miss never reads small files a second time.
 *
 * Disk location: `$SKILL_AUDITOR_CACHE_DIR`, else `node_modules/.cache/
 * skill-auditor/` under the project when node_modules exists, else the OS
 * temp dir. `SKILL_AUDITOR_NO_CACHE=1` or `{ cache: false }` bypasses it.
 */

/** Files at or below this size are fingerprinted by content hash; larger ones by mtime+size. */
export const CONTENT_HASH_MAX_BYTES = 64 * 1024

/** Default max in-flight async file operations during tree walk/scan. */
export const DEFAULT_CONCURRENCY = 32

const CONFIG_GLOB = ['.skill-auditor.json']
const SKILL_GLOBS = ['SKILL.md', 'scripts/**/*.*', 'references/**/*.*']

export interface WalkedFile {
  /** Path relative to the walked root, always forward-slashed */
  relativePath: string
  /** Resolved path on disk */
  absolutePath: string
  mtimeMs: number
  size: number
  /** UTF-8 content when already read during content-hash fingerprinting */
  content?: string
}

export interface WalkedProject {
  projectRoot: string
  files: WalkedFile[]
  /** Absolute file path -> UTF-8 contents captured during fingerprinting */
  contentsByPath: Map<string, string>
}

export interface WalkedSkill {
  skillDir: string
  files: WalkedFile[]
  contentsByPath: Map<string, string>
}

interface CacheEntry {
  version: string
  fingerprint: string
  reality: RepoReality
}

interface SerializedReality {
  ecosystems?: RepoReality['ecosystems']
  declaredDeps: Record<string, string>
  usedImports: Record<string, string[]>
  usedIdentifiers: Record<string, string[]>
  importEvidence: RepoReality['importEvidence']
  indirectDeps?: Record<string, string>
}

interface SkillCacheEntry {
  version: string
  fingerprint: string
  skill: SerializedSkill
}

interface SerializedSkill {
  skillName: string
  skillPath: string
  categories: string[]
  packages: string[]
  importSpecifiers: string[]
  apiCalls: string[]
  packageRefs: SkillIdentifiers['packageRefs']
  importedIdentifiers: Record<string, string[]>
  unusedImportCount: number
  locations: SkillIdentifiers['locations']
  codeEvidence: SkillIdentifiers['codeEvidence']
}

const memory = new Map<string, CacheEntry>()
const skillMemory = new Map<string, SkillCacheEntry>()

/** Runs `fn` over `items` with at most `concurrency` promises in flight, preserving order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const workers = Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex++
      results[current] = await fn(items[current], current)
    }
  })
  await Promise.all(workers)
  return results
}

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

function skillCacheDir(): string {
  const override = process.env.SKILL_AUDITOR_CACHE_DIR
  if (override) return `${override}-skills`
  const nodeModules = path.join(process.cwd(), 'node_modules')
  if (fs.existsSync(nodeModules)) {
    return path.join(nodeModules, '.cache', 'skill-auditor', 'skills')
  }
  return path.join(os.tmpdir(), 'skill-auditor-cache', 'skills')
}

function skillCacheFile(skillDir: string): string {
  const key = createHash('sha1')
    .update(path.resolve(skillDir))
    .digest('hex')
    .slice(0, 16)
  return path.join(skillCacheDir(), `${key}.json`)
}

function toWalkedFiles(root: string, entries: fg.Entry[]): WalkedFile[] {
  const resolvedRoot = path.resolve(root)
  return entries.map(entry => ({
    relativePath: entry.path.replace(/\\/g, '/'),
    absolutePath: path.resolve(resolvedRoot, entry.path),
    mtimeMs: entry.stats?.mtimeMs ?? 0,
    size: entry.stats?.size ?? 0,
  }))
}

/**
 * Walks the project tree once for all source files, manifests, and config.
 * Shared between fingerprinting and scanning so a cache miss never globs twice.
 */
export function walkProject(projectRoot: string): WalkedProject {
  const entries = fg.sync(
    [...allSourceGlobs(), ...allManifestGlobs(), ...CONFIG_GLOB],
    {
      cwd: projectRoot,
      ignore: DEFAULT_IGNORE,
      stats: true,
      onlyFiles: true,
    },
  )
  return {
    projectRoot: path.resolve(projectRoot),
    files: toWalkedFiles(projectRoot, entries),
    contentsByPath: new Map(),
  }
}

/** Async counterpart to {@link walkProject}. */
export async function walkProjectAsync(projectRoot: string): Promise<WalkedProject> {
  const entries = await fg(
    [...allSourceGlobs(), ...allManifestGlobs(), ...CONFIG_GLOB],
    {
      cwd: projectRoot,
      ignore: DEFAULT_IGNORE,
      stats: true,
      onlyFiles: true,
    },
  )
  return {
    projectRoot: path.resolve(projectRoot),
    files: toWalkedFiles(projectRoot, entries),
    contentsByPath: new Map(),
  }
}

function fingerprintFileSync(
  file: WalkedFile,
  contentsByPath: Map<string, string>,
): string {
  if (file.size <= CONTENT_HASH_MAX_BYTES) {
    try {
      const text = file.content ?? fs.readFileSync(file.absolutePath, 'utf-8')
      file.content = text
      contentsByPath.set(file.absolutePath, text)
      const digest = createHash('sha1').update(text).digest('hex')
      return `${file.relativePath}|sha1:${digest}`
    } catch {
      return `${file.relativePath}|${file.mtimeMs}|${file.size}`
    }
  }
  return `${file.relativePath}|${file.mtimeMs}|${file.size}`
}

async function fingerprintFileAsync(
  file: WalkedFile,
  contentsByPath: Map<string, string>,
): Promise<string> {
  if (file.size <= CONTENT_HASH_MAX_BYTES) {
    try {
      const text =
        file.content ?? (await fs.promises.readFile(file.absolutePath, 'utf-8'))
      file.content = text
      contentsByPath.set(file.absolutePath, text)
      const digest = createHash('sha1').update(text).digest('hex')
      return `${file.relativePath}|sha1:${digest}`
    } catch {
      return `${file.relativePath}|${file.mtimeMs}|${file.size}`
    }
  }
  return `${file.relativePath}|${file.mtimeMs}|${file.size}`
}

function finalizeProjectFingerprint(parser: string, lines: string[]): string {
  const sorted = [...lines].sort()
  const hash = createHash('sha1')
  hash.update(readPackageVersion())
  hash.update('\n' + parser)
  hash.update('\n' + [...DEFAULT_IGNORE].sort().join(','))
  hash.update('\n' + sorted.join('\n'))
  return hash.digest('hex')
}

/**
 * A digest of everything the scan reads plus everything that changes how it
 * reads (ignore globs, parser, tool version). Files up to
 * `CONTENT_HASH_MAX_BYTES` are hashed by content; larger files use mtime+size.
 */
export function fingerprintProject(
  projectRoot: string,
  parser = 'lexer',
  walked?: WalkedProject,
): string {
  const tree = walked ?? walkProject(projectRoot)
  const lines = tree.files.map(file =>
    fingerprintFileSync(file, tree.contentsByPath),
  )
  return finalizeProjectFingerprint(parser, lines)
}

/** Async counterpart to {@link fingerprintProject} with bounded file-read concurrency. */
export async function fingerprintProjectAsync(
  projectRoot: string,
  parser = 'lexer',
  walked?: WalkedProject,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<string> {
  const tree = walked ?? (await walkProjectAsync(projectRoot))
  const lines = await mapConcurrent(tree.files, concurrency, file =>
    fingerprintFileAsync(file, tree.contentsByPath),
  )
  return finalizeProjectFingerprint(parser, lines)
}

function revive(serialized: SerializedReality): RepoReality {
  const toSets = (record: Record<string, string[]>) =>
    Object.fromEntries(
      Object.entries(record).map(([key, list]) => [key, new Set(list)]),
    )
  return {
    ecosystems: serialized.ecosystems ?? [],
    declaredDeps: serialized.declaredDeps ?? {},
    usedImports: toSets(serialized.usedImports ?? {}),
    usedIdentifiers: toSets(serialized.usedIdentifiers ?? {}),
    importEvidence: serialized.importEvidence ?? {},
    ...(serialized.indirectDeps ? { indirectDeps: serialized.indirectDeps } : {}),
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

/** Walks a skill directory once for SKILL.md and bundled scripts/references. */
export function walkSkill(skillDir: string): WalkedSkill {
  const entries = fg.sync(SKILL_GLOBS, {
    cwd: skillDir,
    stats: true,
    onlyFiles: true,
  })
  return {
    skillDir: path.resolve(skillDir),
    files: toWalkedFiles(skillDir, entries),
    contentsByPath: new Map(),
  }
}

function taxonomySignature(): string {
  return Object.entries(CATEGORY_TAXONOMY)
    .map(([cat, pkgs]) => `${cat}:${pkgs.join(',')}`)
    .sort()
    .join('|')
}

/** Fingerprints a skill directory (`SKILL.md`, `scripts/`, `references/`, and active taxonomy). */
export function fingerprintSkill(
  skillDir: string,
  walked?: WalkedSkill,
): string {
  const tree = walked ?? walkSkill(skillDir)
  const lines = tree.files
    .map(file => fingerprintFileSync(file, tree.contentsByPath))
    .sort()
  const hash = createHash('sha1')
  hash.update(readPackageVersion())
  hash.update('\n' + taxonomySignature())
  hash.update('\n' + lines.join('\n'))
  return hash.digest('hex')
}

function serializeSkill(skill: SkillIdentifiers): SerializedSkill {
  return JSON.parse(
    JSON.stringify(skill, setAwareReplacer),
  ) as SerializedSkill
}

function reviveSkill(
  serialized: SerializedSkill,
  requestedSkillDir: string,
): SkillIdentifiers {
  const importedIdentifiers = Object.fromEntries(
    Object.entries(serialized.importedIdentifiers ?? {}).map(([pkg, ids]) => [
      pkg,
      new Set(ids),
    ]),
  )
  const packageRefs = Object.fromEntries(
    Object.entries(serialized.packageRefs ?? {}).map(([pkg, ref]) => [
      pkg,
      { ...ref, location: { ...ref.location } },
    ]),
  )
  return {
    skillName: serialized.skillName,
    skillPath: requestedSkillDir,
    categories: new Set(serialized.categories ?? []),
    packages: new Set(serialized.packages ?? []),
    importSpecifiers: new Set(serialized.importSpecifiers ?? []),
    apiCalls: new Set(serialized.apiCalls ?? []),
    packageRefs,
    importedIdentifiers,
    unusedImportCount: serialized.unusedImportCount ?? 0,
    locations: {
      packages: { ...(serialized.locations?.packages ?? {}) },
      importSpecifiers: { ...(serialized.locations?.importSpecifiers ?? {}) },
      apiCalls: { ...(serialized.locations?.apiCalls ?? {}) },
      unusedImports: [...(serialized.locations?.unusedImports ?? [])],
    },
    codeEvidence: {
      codeFences: serialized.codeEvidence?.codeFences ?? 0,
      shellFences: serialized.codeEvidence?.shellFences ?? 0,
    },
  }
}

function readSkillDisk(skillDir: string): SkillCacheEntry | null {
  try {
    const raw = JSON.parse(fs.readFileSync(skillCacheFile(skillDir), 'utf-8'))
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof raw.fingerprint !== 'string' ||
      typeof raw.skill !== 'object' ||
      raw.skill === null
    ) {
      return null
    }
    return {
      version: String(raw.version),
      fingerprint: raw.fingerprint,
      skill: raw.skill as SerializedSkill,
    }
  } catch {
    return null
  }
}

function writeSkillDisk(skillDir: string, entry: SkillCacheEntry): void {
  try {
    const file = skillCacheFile(skillDir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(entry))
  } catch {
    // Best-effort disk cache.
  }
}

/** Returns cached SkillIdentifiers when the skill directory's fingerprint matches. */
export function readCachedSkill(
  skillDir: string,
  fingerprint: string,
): SkillIdentifiers | null {
  const key = path.resolve(skillDir)
  const inMemory = skillMemory.get(key)
  if (inMemory && inMemory.fingerprint === fingerprint) {
    return reviveSkill(inMemory.skill, skillDir)
  }

  const onDisk = readSkillDisk(key)
  if (onDisk && onDisk.fingerprint === fingerprint) {
    skillMemory.set(key, onDisk)
    return reviveSkill(onDisk.skill, skillDir)
  }
  return null
}

export function writeCachedSkill(
  skillDir: string,
  fingerprint: string,
  skill: SkillIdentifiers,
): void {
  const key = path.resolve(skillDir)
  const entry: SkillCacheEntry = {
    version: readPackageVersion(),
    fingerprint,
    skill: serializeSkill(skill),
  }
  skillMemory.set(key, entry)
  writeSkillDisk(key, entry)
}

/** Forgets every in-process skill extraction entry. */
export function clearSkillCache(): void {
  skillMemory.clear()
}

/** Forgets every in-process entry (tests, long-running servers). */
export function clearRealityCache(): void {
  memory.clear()
  skillMemory.clear()
}
