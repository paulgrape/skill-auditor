import fg from 'fast-glob'
import * as fs from 'fs'
import * as path from 'path'
import { Project, SyntaxKind } from 'ts-morph'
import { frontmatterList, parseSimpleYaml } from './frontmatter.js'
import { topLevelPackage } from './packageNames.js'
import type { ImportEvidence, RepoReality } from './types.js'

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
]

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

/**
 * Reads declared dependencies for the "declared" side of ground truth.
 *
 * In a monorepo the root package.json usually holds only tooling, while the
 * stack a skill should align with lives in the workspace packages — so their
 * dependencies are merged in too. Root declarations win on conflict, being
 * the most authoritative statement about the project as a whole.
 */
function readDeclaredDeps(projectRoot: string): Record<string, string> {
  const rootPkg = readPackageJson(path.join(projectRoot, 'package.json'))

  const patterns = workspacePatterns(projectRoot, rootPkg)
  const workspaceDeps: Record<string, string> = {}
  if (patterns.length > 0) {
    const manifests = fg.sync(patterns.map(toManifestPattern), {
      cwd: projectRoot,
      ignore: DEFAULT_IGNORE,
      absolute: true,
    })
    for (const manifest of manifests) {
      const pkg = readPackageJson(manifest)
      if (pkg) Object.assign(workspaceDeps, depsOf(pkg))
    }
  }

  return { ...workspaceDeps, ...(rootPkg ? depsOf(rootPkg) : {}) }
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

interface ImportScanResult {
  usedImports: Record<string, Set<string>>
  usedIdentifiers: Record<string, Set<string>>
  importEvidence: Record<string, ImportEvidence[]>
}

/**
 * Walks all JS/TS/JSX/TSX source files and records every import/require
 * specifier actually used, grouped by top-level package name.
 *
 * Also captures project-relative file paths and import-line examples.
 */
function scanImportUsage(projectRoot: string): ImportScanResult {
  const files = fg.sync(['**/*.{ts,tsx,js,jsx,mjs,cjs}'], {
    cwd: projectRoot,
    ignore: DEFAULT_IGNORE,
    absolute: true,
  })

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  })
  const usedImports: Record<string, Set<string>> = {}
  const usedIdentifiers: Record<string, Set<string>> = {}
  const importEvidence: Record<string, ImportEvidence[]> = {}
  const seenEvidence = new Set<string>()

  const recordIdentifier = (specifier: string, identifier: string) => {
    const topLevel = topLevelPackage(specifier)
    if (!topLevel || !identifier) return
    if (!usedIdentifiers[topLevel]) usedIdentifiers[topLevel] = new Set()
    usedIdentifiers[topLevel].add(identifier)
  }

  const record = (specifier: string, file: string, example?: string) => {
    const topLevel = topLevelPackage(specifier)
    if (!topLevel) return

    if (!usedImports[topLevel]) usedImports[topLevel] = new Set()
    usedImports[topLevel].add(specifier)

    const relativeFile = toRelativePath(projectRoot, file)
    const dedupeKey = `${topLevel}|${specifier}|${relativeFile}`
    if (seenEvidence.has(dedupeKey)) return

    const entries = importEvidence[topLevel] ?? []
    if (entries.length >= MAX_EVIDENCE_PER_PACKAGE) return

    seenEvidence.add(dedupeKey)
    const entry: ImportEvidence = {
      packageName: topLevel,
      specifier,
      file: relativeFile,
    }
    if (example) entry.example = trimExample(example)
    entries.push(entry)
    importEvidence[topLevel] = entries
  }

  for (const file of files) {
    let source
    try {
      source = project.addSourceFileAtPath(file)
    } catch {
      continue // unparseable file, skip rather than crash the whole scan
    }

    for (const decl of source.getImportDeclarations()) {
      const specifier = decl.getModuleSpecifierValue()
      record(specifier, file, decl.getText().trim())

      // Record which identifiers the project actually imports from this
      // package — the source names (not local aliases), so skill examples can
      // be verified against real repo usage.
      for (const named of decl.getNamedImports()) {
        recordIdentifier(specifier, named.getName())
      }
      const defaultImport = decl.getDefaultImport()
      if (defaultImport) recordIdentifier(specifier, defaultImport.getText())
      const namespaceImport = decl.getNamespaceImport()
      if (namespaceImport) recordIdentifier(specifier, namespaceImport.getText())
    }
    for (const decl of source.getExportDeclarations()) {
      const spec = decl.getModuleSpecifierValue()
      if (spec) record(spec, file, decl.getText().trim())
    }
    // Cover require("pkg") / dynamic import("pkg") call-expression forms too.
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText()
      if (exprText === 'require' || exprText === 'import') {
        const arg = call.getArguments()[0]
        if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
          record(arg.getText().slice(1, -1), file, call.getText().trim())
        }
      }
    }
  }

  return { usedImports, usedIdentifiers, importEvidence }
}

export function buildRepoReality(projectRoot: string): RepoReality {
  const { usedImports, usedIdentifiers, importEvidence } =
    scanImportUsage(projectRoot)
  return {
    declaredDeps: readDeclaredDeps(projectRoot),
    usedImports,
    usedIdentifiers,
    importEvidence,
  }
}
