import {
  categoriesForPackage,
  MUST_HAVE_CHECKLISTS,
  packageInCategory,
} from './taxonomy.js'
import { findSkillDirs } from './discoverSkills.js'
import { extractSkillIdentifiers } from './skillIdentifiers.js'
import type { GapFinding, GapReport, ImportEvidence, RepoReality } from './types.js'

/** Max evidence entries attached to a single gap finding. */
const MAX_EVIDENCE_PER_GAP = 10

function repoCategories(repo: RepoReality): string[] {
  const cats = new Set<string>()
  const pkgs = new Set([
    ...Object.keys(repo.declaredDeps),
    ...Object.keys(repo.usedImports),
  ])
  for (const pkg of pkgs) {
    for (const cat of categoriesForPackage(pkg)) cats.add(cat)
  }
  return [...cats].sort()
}

/** Packages the project declares or imports that belong to the category. */
export function packagesForCategory(category: string, repo: RepoReality): string[] {
  const pkgs = new Set<string>()
  for (const pkg of Object.keys(repo.usedImports)) {
    if (packageInCategory(pkg, category)) pkgs.add(pkg)
  }
  for (const pkg of Object.keys(repo.declaredDeps)) {
    if (packageInCategory(pkg, category)) pkgs.add(pkg)
  }
  return [...pkgs].sort()
}

export function evidenceForCategory(
  category: string,
  repo: RepoReality,
): ImportEvidence[] {
  const evidence: ImportEvidence[] = []
  for (const pkg of packagesForCategory(category, repo)) {
    evidence.push(...(repo.importEvidence[pkg] ?? []))
  }
  return evidence.slice(0, MAX_EVIDENCE_PER_GAP)
}

function buildRecommendation(
  category: string,
  evidence: ImportEvidence[],
  repo: RepoReality,
  fallback: string,
): string {
  if (evidence.length === 0) return fallback

  const primaryPkg =
    evidence[0]?.packageName ?? packagesForCategory(category, repo)[0]
  const files = [...new Set(evidence.map(e => e.file))].slice(0, 3)
  const fileList = files.join(', ')
  if (primaryPkg && fileList) {
    return `Create a ${category} skill for ${primaryPkg} using examples from ${fileList}.`
  }
  if (primaryPkg) {
    return `Create a ${category} skill for ${primaryPkg} using your project's import patterns.`
  }
  return fallback
}

function categoriesFromSkillDirs(skillDirs: string[]): Set<string> {
  const cats = new Set<string>()
  for (const dir of skillDirs) {
    try {
      const skill = extractSkillIdentifiers(dir)
      for (const pkg of skill.packages) {
        for (const cat of categoriesForPackage(pkg)) cats.add(cat)
      }
      for (const cat of skill.categories) cats.add(cat)
    } catch {
      // skip unreadable skill dirs
    }
  }
  return cats
}

function makeGap(
  kind: GapFinding['kind'],
  category: string,
  message: string,
  fallbackRecommendation: string,
  repo: RepoReality,
): GapFinding {
  const evidence = evidenceForCategory(category, repo)
  const gap: GapFinding = {
    kind,
    category,
    message,
    recommendation: buildRecommendation(
      category,
      evidence,
      repo,
      fallbackRecommendation,
    ),
  }
  if (evidence.length > 0) gap.evidence = evidence
  return gap
}

export function detectGaps(
  repo: RepoReality,
  skillRoots: string[],
  checklistKey?: string,
): GapReport {
  const installedSkillDirs = findSkillDirs(skillRoots)
  const projectCategories = repoCategories(repo)
  const coveredCategories = [...categoriesFromSkillDirs(installedSkillDirs)].sort()
  const covered = new Set(coveredCategories)
  const gaps: GapFinding[] = []

  for (const category of projectCategories) {
    if (!covered.has(category)) {
      gaps.push(
        makeGap(
          'uncovered-category',
          category,
          `Project uses ${category} libraries but no installed skill covers this category.`,
          `Add or create a skill that references your project's ${category} stack.`,
          repo,
        ),
      )
    }
  }

  if (checklistKey) {
    for (const category of requireChecklist(checklistKey)) {
      if (!covered.has(category)) {
        gaps.push(
          makeGap(
            'checklist-gap',
            category,
            `Must-have checklist "${checklistKey}" requires ${category} coverage; no skill provides it.`,
            `Create or install a ${category} skill (the templates/ directory of the skill-auditor package has reference examples).`,
            repo,
          ),
        )
      }
    }
  }

  return { projectCategories, coveredCategories, gaps }
}

/**
 * Resolves a checklist key or throws. A misspelt key used to be ignored
 * silently, which turned a CI gate into a no-op; failing loudly is the same
 * policy `--min-score` and `--fail-on` already follow.
 */
export function requireChecklist(key: string): string[] {
  const required = MUST_HAVE_CHECKLISTS[key]
  if (!required) {
    throw new Error(
      `Unknown checklist "${key}". Expected one of: ${Object.keys(MUST_HAVE_CHECKLISTS).join(', ')}`,
    )
  }
  return required
}
