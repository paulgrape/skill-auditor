import fg from 'fast-glob'
import * as fs from 'fs'
import { createRequire } from 'module'
import * as path from 'path'
import {
  cacheDisabledByEnv,
  fingerprintProject,
  readCachedReality,
  writeCachedReality,
} from './cache.js'
import { ECOSYSTEMS, MANIFEST_GLOBS, SOURCE_GLOBS } from './ecosystems/globs.js'
import { readGoMod, scanGoImports } from './ecosystems/go.js'
import { scanJavaScriptImports } from './ecosystems/javascript.js'
import {
  readPyproject,
  readRequirements,
  scanPythonImports,
} from './ecosystems/python.js'
import { readCargoToml, scanRustImports } from './ecosystems/rust.js'
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

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
}

function readPackageJson(pkgPath: string): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  } catch {
    return null // missing or malformed — treat as no declared deps
  }
}

function depsOf(pkg: PackageJson): Record<string, string> {
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  }
}

/**
 * Workspace globs declared by the root package.json (npm/yarn) or
 * pnpm-workspace.yaml. Returned as-is, without the trailing `/package.json`.
 */
function workspacePatterns(
  projectRoot: string,
  rootPkg: PackageJson | null,
): string[] {
  const declared = rootPkg?.workspaces
  if (Array.isArray(declared)) return declared
  if (declared?.packages) return declared.packages

  const pnpmPath = path.join(projectRoot, 'pnpm-workspace.yaml')
  if (!fs.existsSync(pnpmPath)) return []
  try {
    const yaml = parseSimpleYaml(fs.readFileSync(pnpmPath, 'utf-8'))
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

/** Files matching `patterns` under the project, root-level ones first. */
function findFiles(projectRoot: string, patterns: string[]): string[] {
  const files = fg.sync(patterns, {
    cwd: projectRoot,
    ignore: DEFAULT_IGNORE,
    absolute: true,
    onlyFiles: true,
  })
  const depth = (file: string) => path.relative(projectRoot, file).split(/[\\/]/).length
  return [...new Set(files)].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

/** Everything the manifests say, plus what the source scans need to know from them. */
interface Declared {
  deps: Record<string, string>
  ecosystems: Set<Ecosystem>
  /** Go module paths declared by go.mod files: the project's own packages */
  goModules: string[]
  /** Top-level Python modules that are part of the project, not dependencies */
  pythonLocalModules: Set<string>
  /** Crate names declared in any Cargo.toml */
  cargoCrates: Set<string>
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
 * Reads declared dependencies for the "declared" side of ground truth.
 *
 * npm: in a monorepo the root package.json usually holds only tooling, while
 * the stack a skill should align with lives in the workspace packages — so
 * their dependencies are merged in too. Root declarations win on conflict,
 * being the most authoritative statement about the project as a whole.
 *
 * Other ecosystems: every manifest under the project is read (root first),
 * which covers Cargo workspaces and polyglot repos with a `backend/` Python
 * service next to a `frontend/` package.json without extra configuration.
 */
function readDeclared(projectRoot: string): Declared {
  const declared: Declared = {
    deps: {},
    ecosystems: new Set(),
    goModules: [],
    pythonLocalModules: new Set(),
    cargoCrates: new Set(),
  }

  // npm
  const rootPkgPath = path.join(projectRoot, 'package.json')
  const rootPkg = readPackageJson(rootPkgPath)
  if (fs.existsSync(rootPkgPath)) declared.ecosystems.add('npm')
  if (rootPkg) mergeFirstWins(declared.deps, depsOf(rootPkg))
  const patterns = workspacePatterns(projectRoot, rootPkg)
  if (patterns.length > 0) {
    const manifests = fg.sync(patterns.map(toManifestPattern), {
      cwd: projectRoot,
      ignore: DEFAULT_IGNORE,
      absolute: true,
    })
    for (const manifest of manifests) {
      const pkg = readPackageJson(manifest)
      if (pkg) mergeFirstWins(declared.deps, depsOf(pkg))
    }
  }

  // Python
  for (const file of findFiles(projectRoot, MANIFEST_GLOBS.python)) {
    const text = readText(file)
    if (text === null) continue
    declared.ecosystems.add('python')
    const deps = path.basename(file) === 'pyproject.toml'
      ? readPyproject(text)
      : readRequirements(text)
    mergeFirstWins(declared.deps, deps)
    for (const module of localPythonModules(path.dirname(file))) {
      declared.pythonLocalModules.add(module)
    }
  }
  for (const module of localPythonModules(projectRoot)) {
    declared.pythonLocalModules.add(module)
  }

  // Go
  for (const file of findFiles(projectRoot, MANIFEST_GLOBS.go)) {
    const text = readText(file)
    if (text === null) continue
    declared.ecosystems.add('go')
    const mod = readGoMod(text)
    if (mod.modulePath) declared.goModules.push(mod.modulePath)
    mergeFirstWins(declared.deps, mod.require)
  }

  // Cargo
  for (const file of findFiles(projectRoot, MANIFEST_GLOBS.cargo)) {
    const text = readText(file)
    if (text === null) continue
    declared.ecosystems.add('cargo')
    const crates = readCargoToml(text)
    for (const name of Object.keys(crates)) declared.cargoCrates.add(name)
    mergeFirstWins(declared.deps, crates)
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

/** Reads every file matching the ecosystem's globs and feeds it to `scan`. */
function scanSources(
  projectRoot: string,
  ecosystem: Ecosystem,
  collector: UsageCollector,
  scan: (source: string) => SourceImport[],
): number {
  const files = findFiles(projectRoot, SOURCE_GLOBS[ecosystem])
  for (const file of files) {
    const text = readText(file)
    if (text === null) continue
    for (const imp of scan(text)) collector.recordImport(imp, file)
  }
  return files.length
}

/**
 * The TypeScript-compiler path, kept for projects that opt into a full parse.
 * Produces the same records as the lexer: import/export specifiers, named
 * import source names, default and namespace locals, `require()` and dynamic
 * `import()` string arguments.
 */
function scanJavaScriptWithTsMorph(
  projectRoot: string,
  collector: UsageCollector,
): number {
  const files = findFiles(projectRoot, SOURCE_GLOBS.npm)
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
      continue // unparseable file, skip rather than crash the whole scan
    }

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
      if (spec) collector.record(topLevelPackage(spec), spec, file, 'npm', decl.getText().trim())
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

export interface BuildRepoRealityOptions {
  /** Use the fingerprinted cache (default true; SKILL_AUDITOR_NO_CACHE=1 also disables it) */
  cache?: boolean
  /** JS/TS parser: `lexer` (default) or `ts-morph` (optional peer dependency) */
  parser?: string
}

function scanRepoReality(projectRoot: string, parser: Parser): RepoReality {
  const declared = readDeclared(projectRoot)
  const collector = new UsageCollector(projectRoot)
  const present = new Set<Ecosystem>(declared.ecosystems)

  const jsFiles =
    parser === 'ts-morph'
      ? scanJavaScriptWithTsMorph(projectRoot, collector)
      : scanSources(projectRoot, 'npm', collector, scanJavaScriptImports)
  if (jsFiles > 0) present.add('npm')

  const pyFiles = scanSources(projectRoot, 'python', collector, source =>
    scanPythonImports(source, { localModules: declared.pythonLocalModules }),
  )
  if (pyFiles > 0) present.add('python')

  const goFiles = scanSources(projectRoot, 'go', collector, source =>
    scanGoImports(source, { localModule: declared.goModules[0] }),
  )
  if (goFiles > 0) present.add('go')

  const rsFiles = scanSources(projectRoot, 'cargo', collector, source =>
    scanRustImports(source, { declaredCrates: declared.cargoCrates }),
  )
  if (rsFiles > 0) present.add('cargo')

  return {
    ecosystems: ECOSYSTEMS.filter(e => present.has(e)),
    declaredDeps: declared.deps,
    usedImports: collector.usedImports,
    usedIdentifiers: collector.usedIdentifiers,
    importEvidence: collector.importEvidence,
  }
}

/**
 * The project's ground truth. Served from the cache when nothing the scan
 * reads has changed since the last run (see cache.ts), otherwise rebuilt.
 */
export function buildRepoReality(
  projectRoot: string,
  options: BuildRepoRealityOptions = {},
): RepoReality {
  const parser = resolveParser(options.parser)
  const useCache = options.cache !== false && !cacheDisabledByEnv()
  if (!useCache) return scanRepoReality(projectRoot, parser)

  const fingerprint = fingerprintProject(projectRoot, parser)
  const cached = readCachedReality(projectRoot, fingerprint)
  if (cached) return cached

  const reality = scanRepoReality(projectRoot, parser)
  writeCachedReality(projectRoot, fingerprint, reality)
  return reality
}
