import * as fs from 'fs'
import * as path from 'path'
import { repoHasPackage } from './diff.js'
import { frontmatterString, parseFrontmatter } from './frontmatter.js'
import {
  categoriesForPackage,
  FRESHNESS_PENALTY,
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

export function classifySkillKind(skill: SkillIdentifiers): SkillKind {
  const refs = totalTechRefs(skill)
  if (refs === 0) return 'neutral'
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

  if (kind === 'neutral') {
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
