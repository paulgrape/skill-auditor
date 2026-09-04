import { buildAlignmentReport } from './diff.js'
import { findSkillDirs } from './discoverSkills.js'
import { envelope } from './envelope.js'
import { detectGaps } from './gaps.js'
import { buildRepoReality } from './repoReality.js'
import { scoreSkill } from './score.js'
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

export function scanReport(projectRoot: string) {
  return envelope(buildRepoReality(projectRoot))
}

/**
 * Always an array, however many skills were audited — callers index, not
 * branch. `count` is the number of skills actually scored; `errors` lists the
 * skill directories that could not be audited and is empty on a clean run.
 */
export function auditReport(results: AuditResult[], errors: AuditError[] = []) {
  return envelope({ count: results.length, results, errors })
}

export function gapsReport(
  skillRoots: string[],
  projectRoot: string,
  checklistKey?: string,
) {
  const repo = buildRepoReality(projectRoot)
  const skillDirs = findSkillDirs(skillRoots)
  return envelope({
    skillDirs,
    ...detectGaps(repo, skillRoots, checklistKey),
  })
}
