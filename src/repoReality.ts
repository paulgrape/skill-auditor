import fg from 'fast-glob'
import * as fs from 'fs'
import { createRequire } from 'module'
import * as path from 'path'
import {
  cacheDisabledByEnv,
  DEFAULT_CONCURRENCY,
  fingerprintProject,
  fingerprintProjectAsync,
  mapConcurrent,
  readCachedReality,
  walkProject,
  walkProjectAsync,
  writeCachedReality,
  type WalkedProject,
} from './cache.js'
import { ECOSYSTEMS } from './ecosystems/globs.js'
import { readGoMod, readGoWork, scanGoImports } from './ecosystems/go.js'
import { scanJavaScriptImports } from './ecosystems/javascript.js'
import {
  readPipfile,
  readPyproject,
  readRequirements,
  readSetupCfg,
  readSetupPy,
  scanPythonImports,
} from './ecosystems/python.js'
import { readCargoManifest, scanRustImports } from './ecosystems/rust.js'
import type { SourceImport } from './ecosystems/types.js'
import { frontmatterList, parseSimpleYaml } from './frontmatter.js'
import { DEFAULT_IGNORE } from './ignore.js'
import { topLevelPackage } from './packageNames.js'
import type { Ecosystem, ImportEvidence, RepoReality } from './types.js'

/**
 * Which engine reads JS/TS source. The built-in lexer is the default and
 * needs no dependencies; `ts-morph` (the TypeScript compiler) is an optional
 * peer dependency for projects that want a full parse.
 */
export const PARSERS = ['lexer', 'ts-morph'] as const
export type Parser = (typeof PARSERS)[number]

/** Resolves the parser from an explicit request, `SKILL_AUDITOR_PARSER`, or the default. */
export function resolveParser(requested?: string): Parser {
  const value = requested ?? process.env.SKILL_AUDITOR_PARSER ?? 'lexer'
  if (!(PARSERS as readonly string[]).includes(value)) {
    throw new Error(
      `Unknown parser "${value}". Expected one of: ${PARSERS.join(', ')}.`,
    )
  }
  return value as Parser
}

type TsMorph = typeof import('ts-morph')
let tsMorph: TsMorph | undefined
function loadTsMorph(): TsMorph {
  if (tsMorph) return tsMorph
  try {
    tsMorph = createRequire(import.meta.url)('ts-morph') as TsMorph
  } catch {
    throw new Error(
      'ts-morph is not installed. It is an optional peer dependency: run `npm install -D ts-morph` in the project, or use the default lexer parser.',
    )
  }
  return tsMorph
}

/** Max evidence entries kept per package to avoid noisy output. */
const MAX_EVIDENCE_PER_PACKAGE = 5
/** Max length for example snippets. */
const MAX_EXAMPLE_LENGTH = 200

const JS_SOURCE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/
const PY_REQUIREMENTS_RE = /^requirements.*\.txt$/

interface PartitionedTree {
  sources: Record<Ecosystem, string[]>
  manifests: Record<Ecosystem, string[]>
}

function sortByDepth(projectRoot: string, files: string[]): string[] {
  const depth = (file: string) =>
    path.relative(projectRoot, file).split(/[\\/]/).length
  return [...new Set(files)].sort(
    (a, b) => depth(a) - depth(b) || a.localeCompare(b),
  )
}

/**
 * Splits a single project tree walk into per-ecosystem source and manifest
 * lists sorted root-first, avoiding repeated `fast-glob` passes.
 */
function partitionTree(
  projectRoot: string,
  tree: WalkedProject,
): PartitionedTree {
  const sources: Record<Ecosystem, string[]> = {
    npm: [],
    python: [],
    go: [],
    cargo: [],
  }
  const manifests: Record<Ecosystem, string[]> = {
    npm: [],
    python: [],
    go: [],
    cargo: [],
  }

  for (const file of tree.files) {
    const base = path.posix.basename(file.relativePath)
    const abs = file.absolutePath

    if (JS_SOURCE_RE.test(base)) sources.npm.push(abs)
    else if (base.endsWith('.py')) sources.python.push(abs)
    else if (base.endsWith('.go')) sources.go.push(abs)
    else if (base.endsWith('.rs')) sources.cargo.push(abs)

    if (base === 'package.json' || file.relativePath === 'pnpm-workspace.yaml') {
      manifests.npm.push(abs)
    } else if (
      base === 'pyproject.toml' ||
      PY_REQUIREMENTS_RE.test(base) ||
      base === 'Pipfile' ||
      base === 'setup.cfg' ||
      base === 'setup.py'
    ) {
      manifests.python.push(abs)
    } else if (base === 'go.mod' || base === 'go.work') {
      manifests.go.push(abs)
    } else if (base === 'Cargo.toml') {
      manifests.cargo.push(abs)
    }
  }

  for (const eco of ECOSYSTEMS) {
    sources[eco] = sortByDepth(projectRoot, sources[eco])
    manifests[eco] = sortByDepth(projectRoot, manifests[eco])
  }

  return { sources, manifests }
}

function readText(file: string, tree?: WalkedProject): string | null {
  const resolved = path.resolve(file)
  const cached = tree?.contentsByPath.get(resolved)
  if (cached !== undefined) return cached
  try {
    return fs.readFileSync(resolved, 'utf-8')
  } catch {
    return null
  }
}

async function readTextAsync(
  file: string,
  tree?: WalkedProject,
): Promise<string | null> {
  const resolved = path.resolve(file)
  const cached = tree?.contentsByPath.get(resolved)
  if (cached !== undefined) return cached
  try {
    return await fs.promises.readFile(resolved, 'utf-8')
  } catch {
    return null
  }
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
}

function parsePackageJson(raw: string | null): PackageJson | null {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null // missing or malformed — treat as no declared deps
  }
}

function depsOf(pkg: PackageJson): Record<string, string> {
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  }
}

/**
 * Workspace globs declared by the root package.json (npm/yarn) or
 * pnpm-workspace.yaml. Returned as-is, without the trailing `/package.json`.
 */
function workspacePatterns(
  projectRoot: string,
  rootPkg: PackageJson | null,
  tree: WalkedProject,
): string[] {
  const declared = rootPkg?.workspaces
  if (Array.isArray(declared)) return declared
  if (declared?.packages) return declared.packages

  const pnpmPath = path.join(projectRoot, 'pnpm-workspace.yaml')
  const raw = readText(pnpmPath, tree)
  if (raw === null) return []
  try {
    const yaml = parseSimpleYaml(raw)
    return frontmatterList(yaml, 'packages')
  } catch {
    return []
  }
}

/** Turns a workspace glob into a manifest glob, preserving `!` exclusions. */
function toManifestPattern(pattern: string): string {
  const negated = pattern.startsWith('!')
  const base = (negated ? pattern.slice(1) : pattern).replace(/\/+$/, '')
  return `${negated ? '!' : ''}${base}/package.json`
}

/** Everything the manifests say, plus what the source scans need to know from them. */
interface Declared {
  deps: Record<string, string>
  indirectDeps: Record<string, string>
  ecosystems: Set<Ecosystem>
  /** Every module path declared by a go.mod or replaced to a local path under the project */
  goModules: string[]
  /** Top-level Python modules that are part of the project, not dependencies */
  pythonLocalModules: Set<string>
  /** External crate names declared in any Cargo.toml */
  cargoCrates: Set<string>
  /** Workspace member crates and local path dependencies in Cargo.toml */
  cargoLocalCrates: Set<string>
}

/** Adds `source` entries to `target` without overriding earlier (more authoritative) ones. */
function mergeFirstWins(
  target: Record<string, string>,
  source: Record<string, string>,
): void {
  for (const [name, version] of Object.entries(source)) {
    if (!(name in target)) target[name] = version
  }
}

/**
 * Reads declared dependencies for the "declared" side of ground truth,
 * reusing the partitioned manifest list and cached file contents from the
 * single tree walk.
 */
function readDeclared(
  projectRoot: string,
  tree: WalkedProject,
  partitioned: PartitionedTree,
): Declared {
  const declared: Declared = {
    deps: {},
    indirectDeps: {},
    ecosystems: new Set(),
    goModules: [],
    pythonLocalModules: new Set(),
    cargoCrates: new Set(),
    cargoLocalCrates: new Set(),
  }

  // npm
  const rootPkgPath = path.resolve(projectRoot, 'package.json')
  const rootPkgText = readText(rootPkgPath, tree)
  const rootPkg = parsePackageJson(rootPkgText)
  if (rootPkgText !== null || fs.existsSync(rootPkgPath)) {
    declared.ecosystems.add('npm')
  }
  if (rootPkg) mergeFirstWins(declared.deps, depsOf(rootPkg))
  const patterns = workspacePatterns(projectRoot, rootPkg, tree)
  if (patterns.length > 0) {
    const manifests = fg.sync(patterns.map(toManifestPattern), {
      cwd: projectRoot,
      ignore: DEFAULT_IGNORE,
      absolute: true,
    })
    for (const manifest of manifests) {
      const pkg = parsePackageJson(readText(manifest, tree))
      if (pkg) mergeFirstWins(declared.deps, depsOf(pkg))
    }
  }

  // Python
  for (const file of partitioned.manifests.python) {
    const text = readText(file, tree)
    if (text === null) continue
    declared.ecosystems.add('python')
    const base = path.basename(file)
    let deps: Record<string, string>
    if (base === 'pyproject.toml') {
      deps = readPyproject(text)
    } else if (base === 'Pipfile') {
      deps = readPipfile(text)
    } else if (base === 'setup.cfg') {
      deps = readSetupCfg(text)
    } else if (base === 'setup.py') {
      deps = readSetupPy(text)
    } else {
      deps = readRequirements(text, { filePath: file })
    }
    mergeFirstWins(declared.deps, deps)
    for (const module of localPythonModules(path.dirname(file))) {
      declared.pythonLocalModules.add(module)
    }
  }
  for (const module of localPythonModules(projectRoot)) {
    declared.pythonLocalModules.add(module)
  }

  // Go
  const addLocalGoModule = (modPath: string) => {
    if (modPath && !declared.goModules.includes(modPath)) {
      declared.goModules.push(modPath)
    }
  }
  const applyGoReplaces = (replaceMap: Record<string, string>, baseDir: string) => {
    for (const [oldMod, target] of Object.entries(replaceMap)) {
      if (
        target.startsWith('./') ||
        target.startsWith('../') ||
        target.startsWith('/')
      ) {
        const targetDir = path.resolve(baseDir, target)
        if (fs.existsSync(targetDir)) {
          addLocalGoModule(oldMod)
          const targetGoMod = path.join(targetDir, 'go.mod')
          const targetText = readText(targetGoMod, tree)
          if (targetText !== null) {
            const parsedTarget = readGoMod(targetText)
            addLocalGoModule(parsedTarget.modulePath)
            mergeFirstWins(declared.deps, parsedTarget.require)
            mergeFirstWins(declared.indirectDeps, parsedTarget.indirect)
          }
        }
      }
    }
  }

  for (const file of partitioned.manifests.go) {
    const text = readText(file, tree)
    if (text === null) continue
    declared.ecosystems.add('go')
    const base = path.basename(file)
    const dir = path.dirname(file)
    if (base === 'go.work') {
      const work = readGoWork(text)
      for (const useDir of work.use) {
        const modFile = path.resolve(dir, useDir, 'go.mod')
        const modText = readText(modFile, tree)
        if (modText === null) continue
        const mod = readGoMod(modText)
        addLocalGoModule(mod.modulePath)
        mergeFirstWins(declared.deps, mod.require)
        mergeFirstWins(declared.indirectDeps, mod.indirect)
        applyGoReplaces(mod.replace, path.dirname(modFile))
      }
      applyGoReplaces(work.replace, dir)
      continue
    }
    const mod = readGoMod(text)
    addLocalGoModule(mod.modulePath)
    mergeFirstWins(declared.deps, mod.require)
    mergeFirstWins(declared.indirectDeps, mod.indirect)
    applyGoReplaces(mod.replace, dir)
  }
  for (const localMod of declared.goModules) {
    delete declared.deps[localMod]
    delete declared.indirectDeps[localMod]
  }
  for (const directMod of Object.keys(declared.deps)) {
    delete declared.indirectDeps[directMod]
  }

  // Cargo
  const cargoFiles = partitioned.manifests.cargo
  const seenCargoFiles = new Set<string>(cargoFiles.map(f => path.resolve(f)))
  const pendingCargoDeps: Record<string, string>[] = []

  const visitCargoFile = (file: string) => {
    const text = readText(file, tree)
    if (text === null) return
    declared.ecosystems.add('cargo')
    const manifest = readCargoManifest(text)
    if (manifest.packageName) {
      declared.cargoLocalCrates.add(manifest.packageName)
    }
    for (const localDep of manifest.localPathDeps) {
      declared.cargoLocalCrates.add(localDep)
    }
    pendingCargoDeps.push(manifest.dependencies)

    if (manifest.workspaceMembers.length > 0) {
      const memberManifests = fg.sync(
        manifest.workspaceMembers.map(m => `${m.replace(/\/+$/, '')}/Cargo.toml`),
        {
          cwd: path.dirname(file),
          ignore: DEFAULT_IGNORE,
          absolute: true,
          onlyFiles: true,
        },
      )
      for (const memberFile of memberManifests) {
        const resolved = path.resolve(memberFile)
        if (!seenCargoFiles.has(resolved)) {
          seenCargoFiles.add(resolved)
          visitCargoFile(memberFile)
        }
      }
    }
  }

  for (const file of cargoFiles) {
    visitCargoFile(file)
  }
  for (const deps of pendingCargoDeps) {
    for (const [name, version] of Object.entries(deps)) {
      if (declared.cargoLocalCrates.has(name) || version.startsWith('path:')) {
        declared.cargoLocalCrates.add(name)
        continue
      }
      declared.cargoCrates.add(name)
      if (!(name in declared.deps)) declared.deps[name] = version
    }
  }

  return declared
}

/**
 * Top-level Python modules that live in the project itself: packages (a
 * directory with `__init__.py`) and modules (`.py` files) at the given root
 * and under its `src/`. Importing them is not importing a dependency.
 */
function localPythonModules(root: string): string[] {
  const modules: string[] = []
  for (const base of [root, path.join(root, 'src')]) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (fs.existsSync(path.join(base, entry.name, '__init__.py'))) {
          modules.push(entry.name)
        }
      } else if (entry.name.endsWith('.py')) {
        modules.push(entry.name.slice(0, -3))
      }
    }
  }
  return modules
}

function toRelativePath(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, '/')
}

function trimExample(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= MAX_EXAMPLE_LENGTH
    ? oneLine
    : oneLine.slice(0, MAX_EXAMPLE_LENGTH - 3) + '...'
}

/** Accumulates the "used" side of the reality across files and ecosystems. */
class UsageCollector {
  readonly usedImports: Record<string, Set<string>> = {}
  readonly usedIdentifiers: Record<string, Set<string>> = {}
  readonly importEvidence: Record<string, ImportEvidence[]> = {}
  private readonly seenEvidence = new Set<string>()

  constructor(private readonly projectRoot: string) {}

  recordIdentifier(packageName: string, identifier: string): void {
    if (!packageName || !identifier) return
    if (!this.usedIdentifiers[packageName]) this.usedIdentifiers[packageName] = new Set()
    this.usedIdentifiers[packageName].add(identifier)
  }

  record(
    packageName: string,
    specifier: string,
    file: string,
    ecosystem: Ecosystem,
    example?: string,
  ): void {
    if (!packageName) return
    if (!this.usedImports[packageName]) this.usedImports[packageName] = new Set()
    this.usedImports[packageName].add(specifier)

    const relativeFile = toRelativePath(this.projectRoot, file)
    const dedupeKey = `${packageName}|${specifier}|${relativeFile}`
    if (this.seenEvidence.has(dedupeKey)) return

    const entries = this.importEvidence[packageName] ?? []
    if (entries.length >= MAX_EVIDENCE_PER_PACKAGE) return

    this.seenEvidence.add(dedupeKey)
    const entry: ImportEvidence = {
      packageName,
      specifier,
      file: relativeFile,
      ecosystem,
    }
    if (example) entry.example = trimExample(example)
    entries.push(entry)
    this.importEvidence[packageName] = entries
  }

  /** Records one normalized import statement from any language scanner. */
  recordImport(imp: SourceImport, file: string): void {
    if (!imp.packageName) return
    this.record(imp.packageName, imp.specifier, file, imp.ecosystem, imp.text)
    for (const binding of imp.bindings) {
      this.recordIdentifier(imp.packageName, binding.source)
    }
  }
}

/** Reads every file in `files` synchronously (using cached text when present) and feeds it to `scan`. */
function scanSources(
  files: string[],
  tree: WalkedProject,
  collector: UsageCollector,
  scan: (source: string) => SourceImport[],
  onFileScanned?: () => void,
): number {
  for (const file of files) {
    const text = readText(file, tree)
    onFileScanned?.()
    if (text === null) continue
    for (const imp of scan(text)) collector.recordImport(imp, file)
  }
  return files.length
}

/** Reads every file in `files` with bounded async concurrency and feeds it to `scan` in deterministic order. */
async function scanSourcesAsync(
  files: string[],
  tree: WalkedProject,
  concurrency: number,
  collector: UsageCollector,
  scan: (source: string) => SourceImport[],
  onFileScanned?: () => void,
): Promise<number> {
  const texts = await mapConcurrent(files, concurrency, async file => {
    const text = await readTextAsync(file, tree)
    onFileScanned?.()
    return text
  })
  for (let i = 0; i < files.length; i++) {
    const text = texts[i]
    if (text === null) continue
    for (const imp of scan(text)) collector.recordImport(imp, files[i])
  }
  return files.length
}

/**
 * The TypeScript-compiler path, kept for projects that opt into a full parse.
 * Produces the same records as the lexer: import/export specifiers, named
 * import and re-export source names, default and namespace locals, `require()`
 * and dynamic `import()` string arguments.
 */
function scanJavaScriptWithTsMorph(
  files: string[],
  collector: UsageCollector,
  onFileScanned?: () => void,
): number {
  const { Project, SyntaxKind } = loadTsMorph()
  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  })

  for (const file of files) {
    let source
    try {
      source = project.addSourceFileAtPath(file)
    } catch {
      onFileScanned?.()
      continue // unparseable file, skip rather than crash the whole scan
    }
    onFileScanned?.()

    for (const decl of source.getImportDeclarations()) {
      const specifier = decl.getModuleSpecifierValue()
      const pkg = topLevelPackage(specifier)
      collector.record(pkg, specifier, file, 'npm', decl.getText().trim())
      for (const named of decl.getNamedImports()) {
        collector.recordIdentifier(pkg, named.getName())
      }
      const defaultImport = decl.getDefaultImport()
      if (defaultImport) collector.recordIdentifier(pkg, defaultImport.getText())
      const namespaceImport = decl.getNamespaceImport()
      if (namespaceImport) collector.recordIdentifier(pkg, namespaceImport.getText())
    }
    for (const decl of source.getExportDeclarations()) {
      const spec = decl.getModuleSpecifierValue()
      if (!spec) continue
      const pkg = topLevelPackage(spec)
      collector.record(pkg, spec, file, 'npm', decl.getText().trim())
      for (const named of decl.getNamedExports()) {
        // `default as D` has no exported name of its own; D stands in, as the
        // lexer does and as a default import is recorded.
        const name = named.getName()
        const alias = named.getAliasNode()?.getText()
        collector.recordIdentifier(pkg, name === 'default' && alias ? alias : name)
      }
      const namespaceExport = decl.getNamespaceExport()
      if (namespaceExport) collector.recordIdentifier(pkg, namespaceExport.getName())
    }
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText()
      if (exprText === 'require' || exprText === 'import') {
        const arg = call.getArguments()[0]
        if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
          const spec = arg.getText().slice(1, -1)
          collector.record(topLevelPackage(spec), spec, file, 'npm', call.getText().trim())
        }
      }
    }
  }
  return files.length
}

/** Progress event emitted during a repository scan. */
export interface ScanProgress {
  phase: 'walk' | 'manifests' | 'npm' | 'python' | 'go' | 'cargo' | 'complete'
  progress: number
  total: number
  message: string
}

export interface BuildRepoRealityOptions {
  /** Use the fingerprinted cache (default true; SKILL_AUDITOR_NO_CACHE=1 also disables it) */
  cache?: boolean
  /** JS/TS parser: `lexer` (default) or `ts-morph` (optional peer dependency) */
  parser?: string
  /** Max concurrent file reads in `buildRepoRealityAsync` (default 32) */
  concurrency?: number
  /** Optional progress listener (used by MCP `notifications/progress`) */
  onProgress?: (progress: ScanProgress) => void
}

function createProgressTracker(
  partitioned: PartitionedTree,
  treeFileCount: number,
  onProgress?: (progress: ScanProgress) => void,
) {
  const totalSources =
    partitioned.sources.npm.length +
    partitioned.sources.python.length +
    partitioned.sources.go.length +
    partitioned.sources.cargo.length
  const total = totalSources + 2
  const step = Math.max(1, Math.ceil(totalSources / 10))
  let scanned = 0
  let currentPhase: ScanProgress['phase'] = 'npm'

  return {
    walked() {
      onProgress?.({
        phase: 'walk',
        progress: 1,
        total,
        message: `Walked ${treeFileCount} project files`,
      })
    },
    manifests() {
      onProgress?.({
        phase: 'manifests',
        progress: 2,
        total,
        message: 'Parsed project manifests',
      })
    },
    startEcosystem(ecosystem: Ecosystem, count: number) {
      currentPhase = ecosystem
      if (count > 0) {
        onProgress?.({
          phase: ecosystem,
          progress: 2 + scanned,
          total,
          message: `Scanning ${count} ${ecosystem} source files`,
        })
      }
    },
    fileScanned() {
      scanned++
      if (totalSources > 10 && scanned < totalSources && scanned % step === 0) {
        onProgress?.({
          phase: currentPhase,
          progress: 2 + scanned,
          total,
          message: `Scanned ${scanned}/${totalSources} source files`,
        })
      }
    },
    complete() {
      onProgress?.({
        phase: 'complete',
        progress: total,
        total,
        message: 'Scan complete',
      })
    },
  }
}

function finalizeReality(
  declared: Declared,
  collector: UsageCollector,
  present: Set<Ecosystem>,
): RepoReality {
  const hasIndirect = Object.keys(declared.indirectDeps).length > 0
  return {
    ecosystems: ECOSYSTEMS.filter(e => present.has(e)),
    declaredDeps: declared.deps,
    usedImports: collector.usedImports,
    usedIdentifiers: collector.usedIdentifiers,
    importEvidence: collector.importEvidence,
    ...(hasIndirect ? { indirectDeps: declared.indirectDeps } : {}),
  }
}

function scanRepoReality(
  projectRoot: string,
  parser: Parser,
  tree: WalkedProject,
  onProgress?: (progress: ScanProgress) => void,
): RepoReality {
  const partitioned = partitionTree(projectRoot, tree)
  const tracker = createProgressTracker(
    partitioned,
    tree.files.length,
    onProgress,
  )
  tracker.walked()

  const declared = readDeclared(projectRoot, tree, partitioned)
  tracker.manifests()

  const collector = new UsageCollector(projectRoot)
  const present = new Set<Ecosystem>(declared.ecosystems)

  tracker.startEcosystem('npm', partitioned.sources.npm.length)
  const jsFiles =
    parser === 'ts-morph'
      ? scanJavaScriptWithTsMorph(
          partitioned.sources.npm,
          collector,
          () => tracker.fileScanned(),
        )
      : scanSources(
          partitioned.sources.npm,
          tree,
          collector,
          scanJavaScriptImports,
          () => tracker.fileScanned(),
        )
  if (jsFiles > 0) present.add('npm')

  tracker.startEcosystem('python', partitioned.sources.python.length)
  const pyFiles = scanSources(
    partitioned.sources.python,
    tree,
    collector,
    source => scanPythonImports(source, { localModules: declared.pythonLocalModules }),
    () => tracker.fileScanned(),
  )
  if (pyFiles > 0) present.add('python')

  tracker.startEcosystem('go', partitioned.sources.go.length)
  const goFiles = scanSources(
    partitioned.sources.go,
    tree,
    collector,
    source => scanGoImports(source, { localModules: declared.goModules }),
    () => tracker.fileScanned(),
  )
  if (goFiles > 0) present.add('go')

  tracker.startEcosystem('cargo', partitioned.sources.cargo.length)
  const rsFiles = scanSources(
    partitioned.sources.cargo,
    tree,
    collector,
    source =>
      scanRustImports(source, {
        declaredCrates: declared.cargoCrates,
        localCrates: declared.cargoLocalCrates,
      }),
    () => tracker.fileScanned(),
  )
  if (rsFiles > 0) present.add('cargo')

  tracker.complete()
  return finalizeReality(declared, collector, present)
}

async function scanRepoRealityAsync(
  projectRoot: string,
  parser: Parser,
  tree: WalkedProject,
  concurrency: number,
  onProgress?: (progress: ScanProgress) => void,
): Promise<RepoReality> {
  const partitioned = partitionTree(projectRoot, tree)
  const tracker = createProgressTracker(
    partitioned,
    tree.files.length,
    onProgress,
  )
  tracker.walked()

  const declared = readDeclared(projectRoot, tree, partitioned)
  tracker.manifests()

  const collector = new UsageCollector(projectRoot)
  const present = new Set<Ecosystem>(declared.ecosystems)

  tracker.startEcosystem('npm', partitioned.sources.npm.length)
  const jsFiles =
    parser === 'ts-morph'
      ? scanJavaScriptWithTsMorph(
          partitioned.sources.npm,
          collector,
          () => tracker.fileScanned(),
        )
      : await scanSourcesAsync(
          partitioned.sources.npm,
          tree,
          concurrency,
          collector,
          scanJavaScriptImports,
          () => tracker.fileScanned(),
        )
  if (jsFiles > 0) present.add('npm')

  tracker.startEcosystem('python', partitioned.sources.python.length)
  const pyFiles = await scanSourcesAsync(
    partitioned.sources.python,
    tree,
    concurrency,
    collector,
    source => scanPythonImports(source, { localModules: declared.pythonLocalModules }),
    () => tracker.fileScanned(),
  )
  if (pyFiles > 0) present.add('python')

  tracker.startEcosystem('go', partitioned.sources.go.length)
  const goFiles = await scanSourcesAsync(
    partitioned.sources.go,
    tree,
    concurrency,
    collector,
    source => scanGoImports(source, { localModules: declared.goModules }),
    () => tracker.fileScanned(),
  )
  if (goFiles > 0) present.add('go')

  tracker.startEcosystem('cargo', partitioned.sources.cargo.length)
  const rsFiles = await scanSourcesAsync(
    partitioned.sources.cargo,
    tree,
    concurrency,
    collector,
    source =>
      scanRustImports(source, {
        declaredCrates: declared.cargoCrates,
        localCrates: declared.cargoLocalCrates,
      }),
    () => tracker.fileScanned(),
  )
  if (rsFiles > 0) present.add('cargo')

  tracker.complete()
  return finalizeReality(declared, collector, present)
}

/**
 * The project's ground truth (asynchronous, bounded file-read concurrency).
 * Walks the project tree once, shares that walk between fingerprinting and
 * scanning, and serves from cache when nothing changed since the last run.
 */
export async function buildRepoRealityAsync(
  projectRoot: string,
  options: BuildRepoRealityOptions = {},
): Promise<RepoReality> {
  const parser = resolveParser(options.parser)
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const useCache = options.cache !== false && !cacheDisabledByEnv()
  const tree = await walkProjectAsync(projectRoot)

  if (!useCache) {
    return scanRepoRealityAsync(
      projectRoot,
      parser,
      tree,
      concurrency,
      options.onProgress,
    )
  }

  const fingerprint = await fingerprintProjectAsync(
    projectRoot,
    parser,
    tree,
    concurrency,
  )
  const cached = readCachedReality(projectRoot, fingerprint)
  if (cached) {
    options.onProgress?.({
      phase: 'walk',
      progress: 0,
      total: 1,
      message: `Checked ${tree.files.length} project files against cache`,
    })
    options.onProgress?.({
      phase: 'complete',
      progress: 1,
      total: 1,
      message: 'Loaded project reality from cache',
    })
    return cached
  }

  const reality = await scanRepoRealityAsync(
    projectRoot,
    parser,
    tree,
    concurrency,
    options.onProgress,
  )
  writeCachedReality(projectRoot, fingerprint, reality)
  return reality
}

/**
 * The project's ground truth (synchronous). Served from the cache when nothing
 * the scan reads has changed since the last run (see cache.ts), otherwise
 * rebuilt from a single tree walk.
 *
 * @deprecated Prefer {@link buildRepoRealityAsync} for non-blocking, bounded-concurrency scans. The synchronous path will be removed in 3.0.
 */
export function buildRepoReality(
  projectRoot: string,
  options: BuildRepoRealityOptions = {},
): RepoReality {
  const parser = resolveParser(options.parser)
  const useCache = options.cache !== false && !cacheDisabledByEnv()
  const tree = walkProject(projectRoot)

  if (!useCache) {
    return scanRepoReality(projectRoot, parser, tree, options.onProgress)
  }

  const fingerprint = fingerprintProject(projectRoot, parser, tree)
  const cached = readCachedReality(projectRoot, fingerprint)
  if (cached) {
    options.onProgress?.({
      phase: 'walk',
      progress: 0,
      total: 1,
      message: `Checked ${tree.files.length} project files against cache`,
    })
    options.onProgress?.({
      phase: 'complete',
      progress: 1,
      total: 1,
      message: 'Loaded project reality from cache',
    })
    return cached
  }

  const reality = scanRepoReality(projectRoot, parser, tree, options.onProgress)
  writeCachedReality(projectRoot, fingerprint, reality)
  return reality
}
