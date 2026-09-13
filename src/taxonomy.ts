import {
  BASE_CATEGORY_TAXONOMY,
  BASE_MUST_HAVE_CHECKLISTS,
  DEPRECATED_API_RULES,
  type DeprecatedApiRule,
} from './taxonomyData.js'

export { DEPRECATED_API_RULES, type DeprecatedApiRule }

/**
 * The live taxonomy tables. They start as copies of the curated data and can
 * be extended in place by a project's `.skill-auditor.json` (see
 * configureTaxonomy). Mutated in place, never reassigned, so every module
 * holding a reference sees the same tables.
 */
export const CATEGORY_TAXONOMY: Record<string, string[]> = {}
export const MUST_HAVE_CHECKLISTS: Record<string, string[]> = {}

/**
 * Reverse index: package name -> every category it belongs to. Packages
 * legitimately span concerns — `@reduxjs/toolkit` is both state and
 * data-fetching (RTK Query) — so this is a list, not a scalar.
 */
export const PACKAGE_TO_CATEGORIES: Record<string, string[]> = {}

function clear(table: Record<string, unknown>): void {
  for (const key of Object.keys(table)) delete table[key]
}

function rebuildReverseIndex(): void {
  clear(PACKAGE_TO_CATEGORIES)
  for (const [category, pkgs] of Object.entries(CATEGORY_TAXONOMY)) {
    for (const pkg of pkgs) {
      const existing = PACKAGE_TO_CATEGORIES[pkg] ?? []
      if (!existing.includes(category)) existing.push(category)
      PACKAGE_TO_CATEGORIES[pkg] = existing
    }
  }
}

export interface TaxonomyExtension {
  /** Extra category -> packages entries; merged into existing categories */
  taxonomy?: Record<string, string[]>
  /** Extra checklist key -> required categories */
  checklists?: Record<string, string[]>
}

/**
 * Resets the tables to the curated data and layers a project's extensions on
 * top. Calling it with no argument restores the defaults; the CLI calls it
 * once per run, the MCP server once per tool call.
 */
export function configureTaxonomy(extension: TaxonomyExtension = {}): void {
  clear(CATEGORY_TAXONOMY)
  for (const [category, pkgs] of Object.entries(BASE_CATEGORY_TAXONOMY)) {
    CATEGORY_TAXONOMY[category] = [...pkgs]
  }
  for (const [category, pkgs] of Object.entries(extension.taxonomy ?? {})) {
    const existing = CATEGORY_TAXONOMY[category] ?? []
    for (const pkg of pkgs) if (!existing.includes(pkg)) existing.push(pkg)
    CATEGORY_TAXONOMY[category] = existing
  }

  clear(MUST_HAVE_CHECKLISTS)
  for (const [key, categories] of Object.entries(BASE_MUST_HAVE_CHECKLISTS)) {
    MUST_HAVE_CHECKLISTS[key] = [...categories]
  }
  for (const [key, categories] of Object.entries(extension.checklists ?? {})) {
    MUST_HAVE_CHECKLISTS[key] = [...categories]
  }

  rebuildReverseIndex()
}

configureTaxonomy()

/** Taxonomy categories a package belongs to; empty when unknown. */
export function categoriesForPackage(pkg: string): string[] {
  return PACKAGE_TO_CATEGORIES[pkg] ?? []
}

/** True when the taxonomy classifies this package at all. */
export function isKnownPackage(pkg: string): boolean {
  return pkg in PACKAGE_TO_CATEGORIES
}

/** True when the package belongs to the given taxonomy category. */
export function packageInCategory(pkg: string, category: string): boolean {
  return categoriesForPackage(pkg).includes(category)
}

/**
 * Weights for the four technical scoring dimensions (must sum to 1).
 *
 * Note: there is deliberately NO per-skill coverage dimension. Rewarding one
 * skill for touching many categories incentivizes package stuffing and
 * contradicts the "one category per skill" guidance. Portfolio coverage is
 * measured by the `gaps` command instead. `focus` rewards the opposite:
 * staying within 1-2 categories.
 *
 * None of the scoring constants below are configurable from a project. The
 * metric is open by design, and keeping its thresholds fixed is what makes a
 * score comparable across repos and resistant to being tuned away.
 */
export const SCORE_WEIGHTS = {
  alignment: 0.45,
  specificity: 0.25,
  freshness: 0.2,
  focus: 0.1,
} as const

/** Weighted substantiation mass at which specificity saturates at 1 (sqrt curve). */
export const SPECIFICITY_SATURATION = 5

/** Penalty per deprecated-api critical finding applied to freshness. */
export const FRESHNESS_PENALTY = 0.5

/** Total tech references below which a skill is classified mixed (not technical). */
export const MIXED_SKILL_THRESHOLD = 3

/**
 * Substantiation weights: how much a matched reference contributes to
 * specificity depending on how real its backing content is. A bare inline
 * mention is worth a quarter of a demonstrated usage; an import statement
 * whose bindings are never used is worth almost nothing (it's the cheapest
 * stuffing move).
 */
export const SUBSTANTIATION_WEIGHTS = {
  usage: 1.0,
  fenced: 0.4,
  mention: 0.25,
} as const

/** Multiplier applied when a reference's section lacks explanatory prose. */
export const UNSUBSTANTIATED_PROSE_MULTIPLIER = 0.5

/** Minimum prose words in a section for its references to count as explained. */
export const PROSE_MIN_WORDS = 20

/** Extra specificity weight for references verified against real repo usage. */
export const VERIFIED_REFERENCE_BONUS = 0.5

/** Alignment prior when a skill has zero scorable references (unknown, not perfect). */
export const UNKNOWN_ALIGNMENT_PRIOR = 0.5

/** Overall score is capped at this value when metric-stuffing is detected. */
export const STUFFING_SCORE_CAP = 60

/**
 * Below this overall score a scored skill must carry at least one finding,
 * so an agent always has something concrete to act on.
 */
export const LOW_SCORE_THRESHOLD = 70

/** Stuffing detector thresholds. */
export const STUFFING_THRESHOLDS = {
  /** Flag when the skill references at least this many packages... */
  mentionHeavyMinPackages: 5,
  /** ...and more than this fraction of them are inline mentions with no example. */
  mentionHeavyRatio: 0.6,
  /** Flag when this many import statements have bindings that are never used. */
  unusedImports: 3,
  /** Flag when a single taxonomy category has at least this many referenced packages. */
  categoryPadding: 4,
  /** Dep-list mirroring: project must declare at least this many deps... */
  mirroringMinDeclaredDeps: 8,
  /** ...and the skill must reference at least this fraction of them. */
  mirroringRatio: 0.8,
} as const
