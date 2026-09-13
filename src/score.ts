import * as fs from 'fs'
import * as path from 'path'
import { repoHasPackage } from './diff.js'
import { frontmatterString, parseFrontmatter } from './frontmatter.js'
import {
  categoriesForPackage,
  FRESHNESS_PENALTY,
  LOW_SCORE_THRESHOLD,
  MIXED_SKILL_THRESHOLD,
  SCORE_WEIGHTS,
  SPECIFICITY_SATURATION,
  STUFFING_SCORE_CAP,
  SUBSTANTIATION_WEIGHTS,
  UNSUBSTANTIATED_PROSE_MULTIPLIER,
  VERIFIED_REFERENCE_BONUS,
} from './taxonomy.js'
import type {
  AlignmentReport,
  DriftFinding,
  RepoReality,
  ScoreBreakdown,
  SkillIdentifiers,
  SkillKind,
  SkillScore,
} from './types.js'

function totalTechRefs(skill: SkillIdentifiers): number {
  return (
    skill.packages.size + skill.importSpecifiers.size + skill.apiCalls.size
  )
}

/**
 * A skill's kind decides whether alignment is scored at all.
 *
 * Procedural skills teach a command-line workflow: their fenced code is shell
 * and their technical references are inline mentions of tools or packages.
 * Grading them on package alignment produced F scores for skills that were
 * doing their job, so they get findings (a mentioned rival library is still
 * worth flagging) but no alignment score, like neutral skills.
 */
export function classifySkillKind(skill: SkillIdentifiers): SkillKind {
  const refs = totalTechRefs(skill)
  if (refs === 0) return 'neutral'
  const evidence = skill.codeEvidence
  if (evidence && evidence.codeFences === 0 && evidence.shellFences > 0) {
    return 'procedural'
  }
  if (refs <= MIXED_SKILL_THRESHOLD) return 'mixed'
  return 'technical'
}

function skillCategories(skill: SkillIdentifiers): Set<string> {
  const cats = new Set<string>()
  for (const pkg of skill.packages) {
    for (const cat of categoriesForPackage(pkg)) cats.add(cat)
  }
  return cats
}

/**
 * Focus: a skill should stay within 1-2 taxonomy categories. Spreading one
 * skill across many categories is either a paste of the dependency list or a
 * mega-skill — both are worse than focused, per-concern skills. Portfolio
 * coverage across categories is measured by the `gaps` command, NOT here.
 */
function computeFocus(skill: SkillIdentifiers): number {
  const cats = skillCategories(skill).size
  if (cats <= 2) return 1
  return 2 / cats
}

function computeFreshness(report: AlignmentReport): number {
  const deprecatedCount = report.findings.filter(
    f => f.kind === 'deprecated-api' && f.severity === 'critical',
  ).length
  return Math.max(0, 1 - deprecatedCount * FRESHNESS_PENALTY)
}

/**
 * Specificity = substantiated depth of the references that actually match the
 * repo. Each matched package contributes weight by substantiation tier
 * (demonstrated usage > idle import > bare mention), halved when its section
 * lacks explanatory prose, with a bonus when the demonstrated identifiers are
 * verified against real repo usage. Diminishing returns (sqrt): the sixth
 * reference is worth much less than the first, so padding doesn't pay.
 *
 * Only matched references count — stuffing wrong or unknown packages adds
 * nothing here (and hurts alignment instead).
 */
function computeSpecificity(
  skill: SkillIdentifiers,
  repo: RepoReality,
  report: AlignmentReport,
): number {
  const verified = new Set(report.verifiedPackages)
  let weightedSum = 0

  for (const ref of Object.values(skill.packageRefs)) {
    if (!repoHasPackage(ref.packageName, repo)) continue

    let weight: number = SUBSTANTIATION_WEIGHTS[ref.substantiation]
    if (!ref.substantiatedByProse) weight *= UNSUBSTANTIATED_PROSE_MULTIPLIER
    if (verified.has(ref.packageName)) weight += VERIFIED_REFERENCE_BONUS
    weightedSum += weight
  }

  return Math.min(1, Math.sqrt(weightedSum / SPECIFICITY_SATURATION))
}

function toGrade(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

/** Scores writing quality from SKILL.md structure — used for neutral/mixed skills. */
export function scoreIntrinsicQuality(skillDir: string): number {
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) return 0

  const raw = fs.readFileSync(skillMdPath, 'utf-8').replace(/\r\n/g, '\n')
  const { data: frontmatter } = parseFrontmatter(raw)
  let score = 0

  // Scoped to frontmatter: `name:`/`description:` lines in the body (commonly
  // inside example blocks) describe something else, not this skill.
  if (frontmatterString(frontmatter, 'name')) score += 20
  if (frontmatterString(frontmatter, 'description')) score += 20
  if (/^#{1,3}\s+.+/m.test(raw)) score += 15
  if (/```[\w-]*\n[\s\S]*?```/.test(raw)) score += 20
  if (raw.length >= 100 && raw.length <= 10000) score += 15
  if (/^[\s]*[-*]\s+.+/m.test(raw) || /^[\s]*\d+\.\s+.+/m.test(raw))
    score += 10

  return score
}

export function scoreSkill(
  report: AlignmentReport,
  skill: SkillIdentifiers,
  repo: RepoReality,
): SkillScore {
  const kind = classifySkillKind(skill)
  const intrinsicQuality = scoreIntrinsicQuality(skill.skillPath)
  const intrinsicGrade = toGrade(intrinsicQuality)
  const freshness = computeFreshness(report)

  if (kind === 'neutral' || kind === 'procedural') {
    return {
      kind,
      overall: null,
      grade: null,
      breakdown: {
        alignment: null,
        focus: null,
        freshness,
        specificity: null,
      },
      intrinsicQuality,
      intrinsicGrade,
    }
  }

  const alignment = report.alignmentScore
  const focus = computeFocus(skill)
  const specificity = computeSpecificity(skill, repo, report)

  const breakdown: ScoreBreakdown = {
    alignment,
    focus,
    freshness,
    specificity,
  }

  let overall = Math.round(
    SCORE_WEIGHTS.alignment * alignment * 100 +
      SCORE_WEIGHTS.specificity * specificity * 100 +
      SCORE_WEIGHTS.freshness * freshness * 100 +
      SCORE_WEIGHTS.focus * focus * 100,
  )

  // Metric-stuffing hard cap: a skill flagged for gaming patterns cannot
  // score above the cap no matter how the dimensions add up.
  const stuffed = report.findings.some(f => f.kind === 'metric-stuffing')
  if (stuffed) overall = Math.min(overall, STUFFING_SCORE_CAP)

  return {
    kind,
    overall,
    grade: toGrade(overall),
    breakdown,
    intrinsicQuality,
    intrinsicGrade,
  }
}

/**
 * A scored skill below the threshold must never come back with an empty
 * findings list: the findings and suggestions are the only interface an
 * agent is meant to act on. When the dimensions alone dragged the score down,
 * this names the dimension and what would move it.
 */
export function explainLowScore(
  report: AlignmentReport,
  score: SkillScore,
  skill: SkillIdentifiers,
): DriftFinding | null {
  if (score.overall === null) return null
  if (score.overall >= LOW_SCORE_THRESHOLD) return null
  if (report.findings.length > 0) return null

  const sample = (values: Iterable<string>, max = 5) => {
    const list = [...values].sort()
    return list.length > max
      ? `${list.slice(0, max).join(', ')}, …`
      : list.join(', ')
  }

  if (report.scorableReferenceCount === 0) {
    const refs = sample([...skill.importSpecifiers, ...skill.apiCalls])
    return {
      severity: 'info',
      kind: 'unscorable',
      message: `Score ${score.overall}/100 with nothing to align: none of the skill's references (${refs || 'none extracted'}) names a package the project declares or one the taxonomy knows, so alignment is unknown (${Math.round(
        (score.breakdown.alignment ?? 0) * 100,
      )}% prior) and specificity is 0%. Either demonstrate the project's real packages with working examples, or accept this as a package-agnostic skill.`,
      skillReference: refs || '(no package references)',
    }
  }

  const specificity = score.breakdown.specificity ?? 0
  const matched = Object.values(skill.packageRefs).map(
    ref => `${ref.packageName} (${ref.substantiation})`,
  )
  return {
    severity: 'info',
    kind: 'unscorable',
    message: `Score ${score.overall}/100 without a drift finding: alignment ${Math.round(
      (score.breakdown.alignment ?? 0) * 100,
    )}%, specificity ${Math.round(specificity * 100)}%, focus ${Math.round(
      (score.breakdown.focus ?? 0) * 100,
    )}%. The matched references (${sample(matched)}) are not demonstrated in working code that uses what it imports, so they earn little specificity.`,
    skillReference: sample(Object.keys(skill.packageRefs)),
  }
}
