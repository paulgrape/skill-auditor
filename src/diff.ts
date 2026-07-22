import {
  DEPRECATED_API_RULES,
  PACKAGE_TO_CATEGORY,
  STUFFING_THRESHOLDS,
  UNKNOWN_ALIGNMENT_PRIOR,
} from './taxonomy.js'
import type {
  AlignmentReport,
  DriftFinding,
  RepoReality,
  SkillIdentifiers,
} from './types.js'

/** True if repo declares OR actually imports this top-level package. */
export function repoHasPackage(pkg: string, repo: RepoReality): boolean {
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

/**
 * Anti-gaming pass: detects skills optimized for the metric rather than for
 * usefulness. Any finding here caps the overall score (see score.ts), so the
 * cheap paths to a high score are closed off.
 */
function detectMetricStuffing(
  skill: SkillIdentifiers,
  repo: RepoReality,
): DriftFinding[] {
  const findings: DriftFinding[] = []
  const refs = Object.values(skill.packageRefs)

  // 1. Mention-heavy: lots of packages, most of them never demonstrated.
  if (refs.length >= STUFFING_THRESHOLDS.mentionHeavyMinPackages) {
    const mentionOnly = refs.filter(r => r.substantiation === 'mention')
    if (
      mentionOnly.length / refs.length > STUFFING_THRESHOLDS.mentionHeavyRatio
    ) {
      findings.push({
        severity: 'warning',
        kind: 'metric-stuffing',
        message: `${mentionOnly.length} of ${refs.length} referenced packages are bare name-drops with no code example or explanation. Add real, repo-grounded examples or remove the padding.`,
        skillReference: mentionOnly
          .map(r => r.packageName)
          .sort()
          .join(', '),
      })
    }
  }

  // 2. Unused imports: import statements whose bindings never get used are
  //    the cheapest way to fake alignment.
  if (skill.unusedImportCount >= STUFFING_THRESHOLDS.unusedImports) {
    findings.push({
      severity: 'warning',
      kind: 'metric-stuffing',
      message: `${skill.unusedImportCount} import statements in the skill's code blocks have bindings that are never used. Imports must appear inside working examples, not as standalone lines.`,
      skillReference: 'unused imports',
    })
  }

  // 3. Category padding: piling several same-category packages into one skill.
  const byCategory = new Map<string, string[]>()
  for (const pkg of skill.packages) {
    const cat = PACKAGE_TO_CATEGORY[pkg]
    if (!cat) continue
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), pkg])
  }
  for (const [category, pkgs] of byCategory) {
    if (pkgs.length >= STUFFING_THRESHOLDS.categoryPadding) {
      findings.push({
        severity: 'warning',
        kind: 'metric-stuffing',
        message: `Skill references ${pkgs.length} different ${category} packages. Cover the one the project actually uses; comparisons of alternatives belong in prose, not as scored references.`,
        skillReference: pkgs.sort().join(', '),
      })
    }
  }

  // 4. Dep-list mirroring: the skill's package list is basically a copy of
  //    package.json — a scan-output paste, not a skill.
  const declared = Object.keys(repo.declaredDeps)
  if (declared.length >= STUFFING_THRESHOLDS.mirroringMinDeclaredDeps) {
    const mirrored = declared.filter(d => skill.packages.has(d))
    if (mirrored.length / declared.length >= STUFFING_THRESHOLDS.mirroringRatio) {
      findings.push({
        severity: 'warning',
        kind: 'metric-stuffing',
        message: `Skill references ${mirrored.length} of the project's ${declared.length} declared dependencies — this looks like a pasted dependency list. Focus the skill on one concern with real examples.`,
        skillReference: 'dependency-list mirror',
      })
    }
  }

  return findings
}

/**
 * Cross-verifies the identifiers a skill imports from a matched package
 * against the identifiers the repo actually imports from it. Returns the
 * verified package names, and emits info findings for identifiers the skill
 * demonstrates that appear nowhere in the project.
 */
function verifyIdentifiers(
  skill: SkillIdentifiers,
  repo: RepoReality,
  findings: DriftFinding[],
): Set<string> {
  const verified = new Set<string>()

  for (const [pkg, skillIds] of Object.entries(skill.importedIdentifiers)) {
    if (!repoHasPackage(pkg, repo)) continue
    const repoIds = repo.usedIdentifiers[pkg]
    if (!repoIds || repoIds.size === 0) continue // repo usage unknown, can't judge

    const matched = [...skillIds].filter(id => repoIds.has(id))
    const unmatched = [...skillIds].filter(id => !repoIds.has(id))

    if (matched.length > 0) verified.add(pkg)
    if (unmatched.length > 0) {
      findings.push({
        severity: 'info',
        kind: 'unverified-api',
        message: `Skill demonstrates ${unmatched
          .sort()
          .map(id => `"${id}"`)
          .join(', ')} from "${pkg}", but the project never imports ${
          unmatched.length === 1 ? 'it' : 'them'
        }. Prefer the APIs the repo actually uses (project imports: ${[...repoIds]
          .sort()
          .join(', ')}).`,
        skillReference: `${pkg}: ${unmatched.sort().join(', ')}`,
        repoReality: [...repoIds].sort().join(', '),
      })
    }
  }

  return verified
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

  const verifiedPackages = verifyIdentifiers(skill, repo, findings)
  findings.push(...detectMetricStuffing(skill, repo))

  // Zero scorable references means alignment is UNKNOWN, not perfect. A vague
  // skill must not outscore a specific-but-imperfect one.
  const alignmentScore =
    scorableReferenceCount === 0
      ? UNKNOWN_ALIGNMENT_PRIOR
      : matchedReferenceCount / scorableReferenceCount

  return {
    skillName: skill.skillName,
    skillPath: skill.skillPath,
    alignmentScore,
    scorableReferenceCount,
    matchedReferenceCount,
    verifiedPackages: [...verifiedPackages].sort(),
    findings,
  }
}
