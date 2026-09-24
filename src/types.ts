/**
 * Package ecosystems the ground truth is read from. `npm` covers every
 * package.json-managed project (npm, pnpm, yarn, bun); `cargo` is Rust.
 */
export type Ecosystem = 'npm' | 'python' | 'go' | 'cargo'

/** A concrete import usage found in project source. */
export interface ImportEvidence {
  packageName: string
  specifier: string
  /** Project-relative path with forward slashes */
  file: string
  /** Which ecosystem's source the usage was found in */
  ecosystem: Ecosystem
  /** Import line or nearby usage snippet */
  example?: string
}

/**
 * Shape of "ground truth" extracted from the actual project.
 */
export interface RepoReality {
  /** Ecosystems with a manifest or source files in the project, sorted */
  ecosystems: Ecosystem[]
  /** Package name -> declared version range, merged across every manifest
   *  (package.json + workspaces, pyproject.toml, requirements*.txt, go.mod,
   *  Cargo.toml). Root declarations win on conflict. */
  declaredDeps: Record<string, string>
  /** Package name -> set of specific import specifiers actually used in source
   *  e.g. "next" -> Set{"next/navigation", "next/router"} */
  usedImports: Record<string, Set<string>>
  /** Package name -> identifiers actually imported from it in project source
   *  e.g. "next" -> Set{"useRouter"}. Used to verify skill examples against
   *  how the repo really uses each library. */
  usedIdentifiers: Record<string, Set<string>>
  /** Package name -> concrete import usages with file paths and examples */
  importEvidence: Record<string, ImportEvidence[]>
}

/**
 * How strongly a package reference is backed by real content in the skill.
 * - 'usage':   fenced code imports the package AND uses the imported bindings
 * - 'fenced':  fenced code imports the package but bindings go unused (or have none)
 * - 'mention': the package only appears as an inline-code mention, no example
 */
export type ReferenceSubstantiation = 'usage' | 'fenced' | 'mention'

/**
 * Where in the skill something was found, so an agent can edit the exact
 * place. Every finding carries one; a finding about the skill as a whole
 * points at line 1 of SKILL.md.
 */
export interface SourceLocation {
  /** Skill-relative path with forward slashes: `SKILL.md`, or a bundled `references/…` / `scripts/…` file */
  file: string
  /** 1-based line: the import statement, the line holding the inline span, or the fence opener */
  line: number
  /** Text of the nearest markdown heading above, without `#` markers */
  heading?: string
}

/** Per-package substantiation record for a skill reference. */
export interface PackageReference {
  packageName: string
  /** Best substantiation tier observed across the skill */
  substantiation: ReferenceSubstantiation
  /** True when at least one section referencing this package carries enough explanatory prose */
  substantiatedByProse: boolean
  /** First place the package is referenced */
  location: SourceLocation
}

/** First occurrence of each extracted reference. */
export interface SkillLocations {
  packages: Record<string, SourceLocation>
  importSpecifiers: Record<string, SourceLocation>
  apiCalls: Record<string, SourceLocation>
  /** Import statements whose bindings are never used below them, one entry each */
  unusedImports: SourceLocation[]
}

/** What kinds of code the skill's fenced blocks contained. */
export interface CodeEvidence {
  /** JS/TS, Python, Go or Rust fences that yielded at least one reference */
  codeFences: number
  /** Shell-family fences (bash, sh, shell, zsh, powershell, console) */
  shellFences: number
}

/**
 * Shape of identifiers pulled out of a SKILL.md (and its bundled scripts).
 */
export interface SkillIdentifiers {
  skillName: string
  skillPath: string
  /** Taxonomy categories declared in the skill's frontmatter `metadata.categories` */
  categories: Set<string>
  /** Package/module names referenced in code blocks or inline code */
  packages: Set<string>
  /** Full import specifiers referenced, e.g. "next/router" */
  importSpecifiers: Set<string>
  /** Bare identifiers that look like API/function calls in JS/TS code, e.g. "getServerSideProps".
   *  Feed the deprecated-API rules only; they do not decide the skill's kind. */
  apiCalls: Set<string>
  /** Package name -> substantiation record (how real the reference is) */
  packageRefs: Record<string, PackageReference>
  /** Package name -> identifiers the skill imports from it, e.g. "next" -> {"useRouter"} */
  importedIdentifiers: Record<string, Set<string>>
  /** Import statements across all snippets whose bindings are never used below them */
  unusedImportCount: number
  /** Where each reference was first seen (SKILL.md or a bundled file) */
  locations: SkillLocations
  /** Which kinds of fenced code the skill contains */
  codeEvidence: CodeEvidence
}

export type DriftSeverity = 'info' | 'warning' | 'critical'

export type DriftFindingKind =
  | 'missing-dependency'
  | 'category-conflict'
  | 'deprecated-api'
  | 'unused-reference'
  | 'unverified-api'
  | 'metric-stuffing'
  | 'unscorable'

export interface DriftFinding {
  severity: DriftSeverity
  kind: DriftFindingKind
  message: string
  skillReference: string
  repoReality?: string
  /** Where the finding points: the reference that caused it, or `SKILL.md:1` for a skill-wide finding */
  location: SourceLocation
}

export interface AlignmentReport {
  skillName: string
  skillPath: string
  /** |skill_references ∩ repo_reality| / |skill_references| , restricted to identifiers
   *  the skill scoring engine could actually classify (see taxonomy).
   *  Falls back to a neutral prior (not 1) when there is nothing scorable. */
  alignmentScore: number
  scorableReferenceCount: number
  matchedReferenceCount: number
  /** Matched packages whose demonstrated identifiers also appear in repo source */
  verifiedPackages: string[]
  findings: DriftFinding[]
}

/**
 * - technical: package-backed, fully alignment-scored
 * - mixed: a few package references, alignment-scored
 * - procedural: a command-line workflow (shell fences, inline mentions, no
 *   JS/Python/Go/Rust examples) — findings are reported, alignment is not scored
 * - neutral: no package references at all; intrinsic quality only
 *
 * Kind is decided by package and import-specifier references, which only
 * language-aware code can produce. API-call-shaped identifiers never
 * decide it.
 */
export type SkillKind = 'technical' | 'mixed' | 'procedural' | 'neutral'

export interface ScoreBreakdown {
  alignment: number | null
  /** How focused the skill is on 1-2 taxonomy categories (portfolio coverage lives in `gaps`) */
  focus: number | null
  freshness: number
  /** Substantiated depth: matched references weighted by how real their content is */
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

export type ValidationSeverity = 'error' | 'warning' | 'info'

/** One Agent Skills spec rule a SKILL.md breaks or bends. */
export interface ValidationViolation {
  severity: ValidationSeverity
  /** Stable rule id, e.g. 'name-matches-directory' */
  rule: string
  message: string
  /** Frontmatter field the rule concerns, when it concerns one */
  field?: string
}

export interface SkillValidation {
  skillDir: string
  skillName: string
  /** False when any violation is an error */
  valid: boolean
  violations: ValidationViolation[]
}
