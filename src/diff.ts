import {
  DEPRECATED_API_RULES,
  PACKAGE_TO_CATEGORY,
} from './taxonomy.js'
import type {
  AlignmentReport,
  DriftFinding,
  RepoReality,
  SkillIdentifiers,
} from './types.js'

/** True if repo declares OR actually imports this top-level package. */
function repoHasPackage(pkg: string, repo: RepoReality): boolean {
  return pkg in repo.declaredDeps || pkg in repo.usedImports
}

/**
 * Packages the repo declares/uses that belong to the given taxonomy category.
 * Used to detect "skill wants X, repo picked Y from the same category".
 */
function repoPackagesInCategory(category: string, repo: RepoReality): string[] {
  const seen = new Set<string>([
    ...Object.keys(repo.declaredDeps),
    ...Object.keys(repo.usedImports),
  ])
  return [...seen].filter(p => PACKAGE_TO_CATEGORY[p] === category)
}

/** True if any recorded import specifier equals or extends `specifier`. */
function repoUsesSpecifier(specifier: string, repo: RepoReality): boolean {
  for (const specifiers of Object.values(repo.usedImports)) {
    for (const s of specifiers) {
      if (s === specifier || s.startsWith(specifier + '/')) return true
    }
  }
  return false
}

/** exact match, or `spec` is a prefix path of `candidate` (next/router -> next/router/x) */
function specifierMatches(candidate: string, spec: string): boolean {
  return candidate === spec || candidate.startsWith(spec + '/')
}

export function buildAlignmentReport(
  skill: SkillIdentifiers,
  repo: RepoReality,
): AlignmentReport {
  const findings: DriftFinding[] = []
  let matchedReferenceCount = 0
  let scorableReferenceCount = 0

  for (const pkg of [...skill.packages].sort()) {
    if (repoHasPackage(pkg, repo)) {
      matchedReferenceCount++
      scorableReferenceCount++
      continue
    }

    const category = PACKAGE_TO_CATEGORY[pkg]
    if (category) {
      const rivals = repoPackagesInCategory(category, repo).filter(
        p => p !== pkg,
      )
      if (rivals.length > 0) {
        scorableReferenceCount++
        findings.push({
          severity: 'critical',
          kind: 'category-conflict',
          message: `Skill uses "${pkg}" (${category}); project uses "${rivals.join(
            '", "',
          )}" for the same concern.`,
          skillReference: pkg,
          repoReality: rivals.join(', '),
        })
      } else {
        scorableReferenceCount++
        findings.push({
          severity: 'warning',
          kind: 'missing-dependency',
          message: `Skill uses "${pkg}" (${category}); project has no ${category} library.`,
          skillReference: pkg,
        })
      }
      continue
    }

    // Unknown package, not in repo: low-confidence, excluded from denominator.
    findings.push({
      severity: 'info',
      kind: 'unused-reference',
      message: `Skill references "${pkg}", which the project does not use (no known category).`,
      skillReference: pkg,
    })
  }

  // Deprecated-API pass: gated on repo actually using the successor API.
  for (const rule of DEPRECATED_API_RULES) {
    if (!repoUsesSpecifier(rule.onlyIfRepoUses, repo)) continue

    for (const api of rule.deprecatedApiCalls ?? []) {
      if (skill.apiCalls.has(api)) {
        findings.push({
          severity: 'critical',
          kind: 'deprecated-api',
          message: `${rule.message} (${rule.framework}: "${api}")`,
          skillReference: api,
          repoReality: rule.onlyIfRepoUses,
        })
      }
    }

    for (const spec of rule.deprecatedImportSpecifiers ?? []) {
      const hit = [...skill.importSpecifiers].some(s =>
        specifierMatches(s, spec),
      )
      if (hit) {
        findings.push({
          severity: 'critical',
          kind: 'deprecated-api',
          message: `${rule.message} (${rule.framework}: "${spec}")`,
          skillReference: spec,
          repoReality: rule.onlyIfRepoUses,
        })
      }
    }
  }

  const alignmentScore =
    scorableReferenceCount === 0
      ? 1
      : matchedReferenceCount / scorableReferenceCount

  return {
    skillName: skill.skillName,
    skillPath: skill.skillPath,
    alignmentScore,
    scorableReferenceCount,
    matchedReferenceCount,
    findings,
  }
}
