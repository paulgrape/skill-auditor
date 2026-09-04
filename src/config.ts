import * as fs from 'fs'
import * as path from 'path'
import { configureIgnore } from './ignore.js'
import { configureTaxonomy } from './taxonomy.js'

/**
 * Per-project configuration, read from `.skill-auditor.json` at the project
 * root or from a `"skill-auditor"` key in its package.json (the file wins).
 *
 * Only the *vocabulary* is configurable — which packages belong to which
 * category, what a must-have checklist contains, which paths to skip. The
 * scoring weights and anti-gaming thresholds are deliberately not: a project
 * that could relax them would get a score that no longer means anything.
 */
export interface ProjectConfig {
  /** Extra category -> package names, merged into the built-in taxonomy */
  taxonomy?: Record<string, string[]>
  /** Extra checklist key -> required categories (may reference custom categories) */
  checklists?: Record<string, string[]>
  /** Extra fast-glob patterns to skip when scanning the project */
  ignore?: string[]
}

export interface LoadedProjectConfig {
  /** Where the config came from, relative to the project root; null when none */
  source: string | null
  config: ProjectConfig
}

export const CONFIG_FILENAME = '.skill-auditor.json'
const PACKAGE_JSON_KEY = 'skill-auditor'

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isStringArrayMap(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isStringArray)
  )
}

/** Keeps only well-typed fields; anything else is a config error worth naming. */
function coerce(raw: unknown, source: string): ProjectConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${source}: expected a JSON object.`)
  }
  const record = raw as Record<string, unknown>
  const config: ProjectConfig = {}

  if (record.taxonomy !== undefined) {
    if (!isStringArrayMap(record.taxonomy)) {
      throw new Error(`${source}: "taxonomy" must map category names to arrays of package names.`)
    }
    config.taxonomy = record.taxonomy
  }
  if (record.checklists !== undefined) {
    if (!isStringArrayMap(record.checklists)) {
      throw new Error(`${source}: "checklists" must map checklist keys to arrays of category names.`)
    }
    config.checklists = record.checklists
  }
  if (record.ignore !== undefined) {
    if (!isStringArray(record.ignore)) {
      throw new Error(`${source}: "ignore" must be an array of glob patterns.`)
    }
    config.ignore = record.ignore
  }

  const known = new Set(['taxonomy', 'checklists', 'ignore', '$schema'])
  const unknown = Object.keys(record).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(
      `${source}: unknown field(s) ${unknown.map(k => `"${k}"`).join(', ')}. Scoring thresholds are not configurable; supported fields are taxonomy, checklists, ignore.`,
    )
  }
  return config
}

/** Reads the project's configuration without applying it. Throws on malformed config. */
export function loadProjectConfig(projectRoot: string): LoadedProjectConfig {
  const filePath = path.join(projectRoot, CONFIG_FILENAME)
  if (fs.existsSync(filePath)) {
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`${CONFIG_FILENAME}: invalid JSON (${reason}).`)
    }
    return { source: CONFIG_FILENAME, config: coerce(raw, CONFIG_FILENAME) }
  }

  const pkgPath = path.join(projectRoot, 'package.json')
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    if (pkg && typeof pkg === 'object' && PACKAGE_JSON_KEY in pkg) {
      const source = `package.json#${PACKAGE_JSON_KEY}`
      return { source, config: coerce(pkg[PACKAGE_JSON_KEY], source) }
    }
  } catch {
    // missing or malformed package.json: the scan already tolerates this
  }

  return { source: null, config: {} }
}

/** Installs a configuration into the live taxonomy and ignore tables. */
export function applyProjectConfig(config: ProjectConfig): void {
  configureTaxonomy({ taxonomy: config.taxonomy, checklists: config.checklists })
  configureIgnore(config.ignore)
}

/**
 * Loads and applies the configuration for a project in one step. Every entry
 * point that analyzes a project calls this first, so a custom category is
 * known before any checklist key or package is looked at.
 */
export function prepareProject(projectRoot: string): LoadedProjectConfig {
  const loaded = loadProjectConfig(projectRoot)
  applyProjectConfig(loaded.config)
  return loaded
}

/** The shape `docs` and `scan` report so an agent can write a valid config. */
export function describeConfig(loaded: LoadedProjectConfig) {
  return {
    file: CONFIG_FILENAME,
    source: loaded.source,
    taxonomy: loaded.config.taxonomy ?? {},
    checklists: loaded.config.checklists ?? {},
    ignore: loaded.config.ignore ?? [],
  }
}
