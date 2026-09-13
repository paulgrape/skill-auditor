import { describeConfig, prepareProject } from './config.js'
import { buildAlignmentReport } from './diff.js'
import { findSkillDirs } from './discoverSkills.js'
import { envelope } from './envelope.js'
import { detectGaps } from './gaps.js'
import { buildRepoReality, type BuildRepoRealityOptions } from './repoReality.js'
import { explainLowScore, scoreSkill } from './score.js'
import { extractSkillIdentifiers } from './skillIdentifiers.js'
import { buildSuggestions } from './suggestions.js'
import type {
  AlignmentReport,
  RepoReality,
  SkillScore,
  SkillSuggestion,
} from './types.js'

/** Everything the audit knows about one skill. */
export interface AuditResult {
  skillDir: string
  report: AlignmentReport
  score: SkillScore
  suggestions: SkillSuggestion[]
}

/** A skill directory the audit could not read or parse. */
export interface AuditError {
  skillDir: string
  error: string
}

/** Audits one skill directory against an already-built repo reality. */
export function auditSkill(repo: RepoReality, skillDir: string): AuditResult {
  const skill = extractSkillIdentifiers(skillDir)
  const report = buildAlignmentReport(skill, repo)
  const score = scoreSkill(report, skill, repo)
  const explanation = explainLowScore(report, score, skill)
  if (explanation) report.findings.push(explanation)
  const suggestions = buildSuggestions(report.findings)
  return { skillDir, report, score, suggestions }
}

/**
 * Audits each skill directory against one already-built repo reality. Throws
 * on the first unreadable skill; use auditSkillsSafely when one broken
 * SKILL.md must not abort the rest of the run.
 */
export function auditSkills(
  repo: RepoReality,
  skillDirs: string[],
): AuditResult[] {
  return skillDirs.map(skillDir => auditSkill(repo, skillDir))
}

/**
 * Audits every skill directory it can and reports the ones it cannot, so a
 * single unreadable SKILL.md under a skills root surfaces as one error entry
 * instead of taking the whole audit down with it.
 */
export function auditSkillsSafely(
  repo: RepoReality,
  skillDirs: string[],
): { results: AuditResult[]; errors: AuditError[] } {
  const results: AuditResult[] = []
  const errors: AuditError[] = []
  for (const skillDir of skillDirs) {
    try {
      results.push(auditSkill(repo, skillDir))
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      errors.push({ skillDir, error })
    }
  }
  return { results, errors }
}

/**
 * Machine-readable report builders. Every one returns a versioned envelope, so
 * the CLI, the MCP server and library consumers all emit the same shapes.
 */

export function scanReport(
  projectRoot: string,
  options: BuildRepoRealityOptions = {},
) {
  const loaded = prepareProject(projectRoot)
  return envelope({
    ...buildRepoReality(projectRoot, options),
    config: describeConfig(loaded),
  })
}

/**
 * Always an array, however many skills were audited — callers index, not
 * branch. `count` is the number of skills actually scored; `errors` lists the
 * skill directories that could not be audited and is empty on a clean run.
 */
export function auditReport(
  results: AuditResult[],
  errors: AuditError[] = [],
  extras: Record<string, unknown> = {},
) {
  return envelope({ count: results.length, results, errors, ...extras })
}

export function gapsReport(
  skillRoots: string[],
  projectRoot: string,
  checklistKey?: string,
  options: BuildRepoRealityOptions = {},
) {
  prepareProject(projectRoot)
  const repo = buildRepoReality(projectRoot, options)
  const skillDirs = findSkillDirs(skillRoots)
  return envelope({
    skillDirs,
    ...detectGaps(repo, skillRoots, checklistKey),
  })
}

export function validateReport(results: import('./types.js').SkillValidation[]) {
  return envelope({
    count: results.length,
    valid: results.every(r => r.valid),
    results,
  })
}
