/** A concrete import usage found in project source. */
export interface ImportEvidence {
  packageName: string
  specifier: string
  /** Project-relative path with forward slashes */
  file: string
  /** Import line or nearby usage snippet */
  example?: string
}

/**
 * Shape of "ground truth" extracted from the actual project.
 */
export interface RepoReality {
  /** Package name -> declared version range from package.json */
  declaredDeps: Record<string, string>
  /** Package name -> set of specific import specifiers actually used in source
   *  e.g. "next" -> Set{"next/navigation", "next/router"} */
  usedImports: Record<string, Set<string>>
  /** Package name -> concrete import usages with file paths and examples */
  importEvidence: Record<string, ImportEvidence[]>
  /** Distinct file extensions found, as a weak signal of project type (tsx, vue, svelte...) */
  fileExtensions: Set<string>
}

/**
 * Shape of identifiers pulled out of a SKILL.md (and its bundled scripts).
 */
export interface SkillIdentifiers {
  skillName: string
  skillPath: string
  /** Taxonomy categories declared in the skill's frontmatter `categories:` list */
  categories: Set<string>
  /** Package/module names referenced in code blocks or inline code */
  packages: Set<string>
  /** Full import specifiers referenced, e.g. "next/router" */
  importSpecifiers: Set<string>
  /** Bare identifiers that look like API/function calls, e.g. "getServerSideProps" */
  apiCalls: Set<string>
}

export type DriftSeverity = 'info' | 'warning' | 'critical'

export interface DriftFinding {
  severity: DriftSeverity
  kind:
    | 'missing-dependency'
    | 'category-conflict'
    | 'deprecated-api'
    | 'unused-reference'
  message: string
  skillReference: string
  repoReality?: string
}

export interface AlignmentReport {
  skillName: string
  skillPath: string
  /** |skill_references ∩ repo_reality| / |skill_references| , restricted to identifiers
   *  the skill scoring engine could actually classify (see taxonomy) */
  alignmentScore: number
  scorableReferenceCount: number
  matchedReferenceCount: number
  findings: DriftFinding[]
}

export type SkillKind = 'technical' | 'mixed' | 'neutral'

export interface ScoreBreakdown {
  alignment: number | null
  coverage: number | null
  freshness: number
  specificity: number | null
}

export interface SkillScore {
  kind: SkillKind
  /** Weighted 0-100 for technical/mixed skills; null for neutral */
  overall: number | null
  grade: string | null
  breakdown: ScoreBreakdown
  /** Writing-quality score for neutral/mixed skills (0-100) */
  intrinsicQuality: number
  intrinsicGrade: string
}

export interface SkillSuggestion {
  finding: DriftFinding
  suggestion: string
}

export interface GapFinding {
  kind: 'uncovered-category' | 'checklist-gap'
  category: string
  message: string
  /** Suggested skill template or category to cover */
  recommendation: string
  /** Project-specific import evidence for this gap, when available */
  evidence?: ImportEvidence[]
}

export interface GapReport {
  projectCategories: string[]
  coveredCategories: string[]
  gaps: GapFinding[]
}

export type SpecPriority = 'required' | 'recommended' | 'optional' | 'avoid'

/** A single item from the Website Specification (https://specification.website). */
export interface WebsiteSpecItem {
  /** Dotted id, e.g. 'foundations.doctype' */
  id: string
  category: string
  priority: SpecPriority
  title: string
  sourceUrl: string
}

export type ComplianceStatus = 'pass' | 'fail' | 'skip'

export interface ComplianceFinding {
  id: string
  category: string
  priority: SpecPriority
  status: ComplianceStatus
  title: string
  message: string
  /** Project-relative files that informed the finding (evidence or where a fix belongs) */
  files: string[]
  sourceUrl: string
}

export interface ComplianceReport {
  summary: { pass: number; fail: number; skip: number }
  findings: ComplianceFinding[]
}
