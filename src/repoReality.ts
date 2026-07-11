import fg from 'fast-glob'
import * as fs from 'fs'
import * as path from 'path'
import { Project, SyntaxKind } from 'ts-morph'
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

/**
 * Reads package.json (deps + devDeps) for the "declared" side of ground truth.
 */
function readDeclaredDeps(projectRoot: string): Record<string, string> {
  const pkgPath = path.join(projectRoot, 'package.json')
  if (!fs.existsSync(pkgPath)) return {}

  let pkg: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  } catch {
    return {} // malformed package.json — treat as no declared deps
  }
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  }
}

function topLevelPackage(specifier: string): string {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return ''
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
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
  const importEvidence: Record<string, ImportEvidence[]> = {}
  const seenEvidence = new Set<string>()

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
      record(
        decl.getModuleSpecifierValue(),
        file,
        decl.getText().trim(),
      )
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

  return { usedImports, importEvidence }
}

function scanFileExtensions(projectRoot: string): Set<string> {
  const files = fg.sync(['**/*.*'], {
    cwd: projectRoot,
    ignore: DEFAULT_IGNORE,
  })
  const exts = new Set<string>()
  for (const f of files) {
    const ext = path.extname(f).replace('.', '')
    if (ext) exts.add(ext)
  }
  return exts
}

export function buildRepoReality(projectRoot: string): RepoReality {
  const { usedImports, importEvidence } = scanImportUsage(projectRoot)
  return {
    declaredDeps: readDeclaredDeps(projectRoot),
    usedImports,
    importEvidence,
    fileExtensions: scanFileExtensions(projectRoot),
  }
}
