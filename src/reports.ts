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

/** Audits each skill directory against one already-built repo reality. */
export function auditSkills(
  repo: RepoReality,
  skillDirs: string[],
): AuditResult[] {
  return skillDirs.map(skillDir => {
    const skill = extractSkillIdentifiers(skillDir)
    const report = buildAlignmentReport(skill, repo)
    const score = scoreSkill(report, skill, repo)
    const suggestions = buildSuggestions(report.findings)
    return { skillDir, report, score, suggestions }
  })
}

/**
 * Machine-readable report builders. Every one returns a versioned envelope, so
 * the CLI, the MCP server and library consumers all emit the same shapes.
 */

export function scanReport(projectRoot: string) {
  return envelope(buildRepoReality(projectRoot))
}

/** Always an array, however many skills were audited — callers index, not branch. */
export function auditReport(results: AuditResult[]) {
  return envelope({ count: results.length, results })
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
