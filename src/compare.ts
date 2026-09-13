import * as fs from 'fs'
import * as path from 'path'
import type { DriftFinding, DriftSeverity, SkillKind } from './types.js'

/**
 * Diffs two audit payloads so an agent (or a PR check) can see whether an
 * edit made a skill better, not just what its score is now. Skills are
 * matched by name first — audit JSON carries absolute paths, which differ
 * between machines — and by directory as a fallback.
 */

/** The subset of an audit result the comparison needs; tolerant of older payloads. */
export interface AuditResultLike {
  skillDir: string
  report: { skillName: string; findings: DriftFinding[] }
  score: { kind: SkillKind; overall: number | null; grade: string | null }
}

export interface SkillSnapshot {
  kind: SkillKind
  overall: number | null
  grade: string | null
  findings: number
  bySeverity: Record<DriftSeverity, number>
}

export interface SkillComparison {
  skillName: string
  skillDir: string
  status: 'improved' | 'regressed' | 'unchanged' | 'added' | 'removed'
  before: SkillSnapshot | null
  after: SkillSnapshot | null
  /** after.overall - before.overall; null when either side is unscored */
  scoreDelta: number | null
  /** Findings present before and gone after, as `kind: skillReference` */
  resolved: string[]
  /** Findings present after that were not there before */
  introduced: string[]
}

export interface AuditComparison {
  summary: Record<SkillComparison['status'], number>
  skills: SkillComparison[]
}

const SEVERITY_RANK: Record<DriftSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
}

function snapshot(result: AuditResultLike): SkillSnapshot {
  const bySeverity: Record<DriftSeverity, number> = {
    info: 0,
    warning: 0,
    critical: 0,
  }
  for (const finding of result.report.findings) bySeverity[finding.severity]++
  return {
    kind: result.score.kind,
    overall: result.score.overall,
    grade: result.score.grade,
    findings: result.report.findings.length,
    bySeverity,
  }
}

function findingKeys(result: AuditResultLike): Set<string> {
  return new Set(
    result.report.findings.map(f => `${f.kind}: ${f.skillReference}`),
  )
}

function worstSeverity(findings: DriftFinding[]): number {
  return findings.reduce(
    (worst, f) => Math.max(worst, SEVERITY_RANK[f.severity]),
    -1,
  )
}

function statusOf(
  before: AuditResultLike,
  after: AuditResultLike,
  resolved: string[],
  introduced: string[],
): SkillComparison['status'] {
  const scoreBefore = before.score.overall
  const scoreAfter = after.score.overall
  if (scoreBefore !== null && scoreAfter !== null && scoreBefore !== scoreAfter) {
    return scoreAfter > scoreBefore ? 'improved' : 'regressed'
  }
  // Same (or no) score: judge by the worst severity that moved.
  const introducedWorst = worstSeverity(
    after.report.findings.filter(f =>
      introduced.includes(`${f.kind}: ${f.skillReference}`),
    ),
  )
  const resolvedWorst = worstSeverity(
    before.report.findings.filter(f =>
      resolved.includes(`${f.kind}: ${f.skillReference}`),
    ),
  )
  if (introducedWorst > resolvedWorst) return 'regressed'
  if (resolvedWorst > introducedWorst) return 'improved'
  if (resolved.length !== introduced.length) {
    return resolved.length > introduced.length ? 'improved' : 'regressed'
  }
  return 'unchanged'
}

function keyOf(result: AuditResultLike): string {
  return result.report.skillName || path.basename(result.skillDir)
}

export function compareAudits(
  before: AuditResultLike[],
  after: AuditResultLike[],
): AuditComparison {
  const beforeByKey = new Map(before.map(r => [keyOf(r), r]))
  const afterByKey = new Map(after.map(r => [keyOf(r), r]))
  const skills: SkillComparison[] = []

  for (const [key, afterResult] of afterByKey) {
    const beforeResult = beforeByKey.get(key)
    if (!beforeResult) {
      skills.push({
        skillName: key,
        skillDir: afterResult.skillDir,
        status: 'added',
        before: null,
        after: snapshot(afterResult),
        scoreDelta: null,
        resolved: [],
        introduced: [...findingKeys(afterResult)].sort(),
      })
      continue
    }
    const beforeKeys = findingKeys(beforeResult)
    const afterKeys = findingKeys(afterResult)
    const resolved = [...beforeKeys].filter(k => !afterKeys.has(k)).sort()
    const introduced = [...afterKeys].filter(k => !beforeKeys.has(k)).sort()
    const scoreDelta =
      beforeResult.score.overall !== null && afterResult.score.overall !== null
        ? afterResult.score.overall - beforeResult.score.overall
        : null
    skills.push({
      skillName: key,
      skillDir: afterResult.skillDir,
      status: statusOf(beforeResult, afterResult, resolved, introduced),
      before: snapshot(beforeResult),
      after: snapshot(afterResult),
      scoreDelta,
      resolved,
      introduced,
    })
  }

  for (const [key, beforeResult] of beforeByKey) {
    if (afterByKey.has(key)) continue
    skills.push({
      skillName: key,
      skillDir: beforeResult.skillDir,
      status: 'removed',
      before: snapshot(beforeResult),
      after: null,
      scoreDelta: null,
      resolved: [...findingKeys(beforeResult)].sort(),
      introduced: [],
    })
  }

  skills.sort((a, b) => a.skillName.localeCompare(b.skillName))
  const summary: AuditComparison['summary'] = {
    improved: 0,
    regressed: 0,
    unchanged: 0,
    added: 0,
    removed: 0,
  }
  for (const skill of skills) summary[skill.status]++
  return { summary, skills }
}

/** Reads the `results` array out of a saved `audit --json` payload. */
export function readAuditPayload(file: string): AuditResultLike[] {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Cannot read audit payload ${file}: ${reason}`)
  }
  const results = (raw as { results?: unknown })?.results
  if (!Array.isArray(results)) {
    throw new Error(
      `${file} is not an audit payload: expected a top-level "results" array (from \`skill-auditor audit --json\`).`,
    )
  }
  return results as AuditResultLike[]
}

export function formatComparisonText(comparison: AuditComparison): string[] {
  const lines: string[] = []
  const { summary } = comparison
  lines.push(
    `Comparison: ${summary.improved} improved, ${summary.regressed} regressed, ${summary.unchanged} unchanged, ${summary.added} added, ${summary.removed} removed`,
  )
  for (const skill of comparison.skills) {
    const before = skill.before?.overall ?? 'N/A'
    const after = skill.after?.overall ?? 'N/A'
    const delta =
      skill.scoreDelta === null
        ? ''
        : ` (${skill.scoreDelta >= 0 ? '+' : ''}${skill.scoreDelta})`
    lines.push(`  [${skill.status}] ${skill.skillName}: ${before} -> ${after}${delta}`)
    for (const key of skill.resolved) lines.push(`      resolved:   ${key}`)
    for (const key of skill.introduced) lines.push(`      introduced: ${key}`)
  }
  return lines
}
