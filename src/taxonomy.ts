/**
 * Groups packages that solve the same problem, so we can detect
 * "skill assumes Redux, project uses Zustand" — a real conflict with
 * zero string overlap, which substring matching can never catch.
 *
 * This table is intentionally small and hand-curated to start. It's meant
 * to grow via PRs, not to be exhaustive on day one.
 */
export const CATEGORY_TAXONOMY: Record<string, string[]> = {
  state: [
    'zustand',
    'redux',
    '@reduxjs/toolkit',
    'jotai',
    'recoil',
    'mobx',
    'valtio',
  ],
  routing: [
    'next',
    'react-router',
    'react-router-dom',
    '@tanstack/router',
    '@tanstack/react-router',
    'wouter',
  ],
  'data-fetching': [
    'swr',
    '@tanstack/react-query',
    '@tanstack/query',
    '@reduxjs/toolkit',
    'apollo-client',
    '@apollo/client',
    'urql',
  ],
  forms: ['react-hook-form', 'formik', 'final-form', '@tanstack/react-form'],
  validation: ['zod', 'yup', 'joi', 'superstruct', 'valibot'],
  styling: [
    'tailwindcss',
    'styled-components',
    '@emotion/react',
    '@emotion/styled',
    'sass',
    'vanilla-extract',
  ],
  'orm-db': [
    'drizzle-orm',
    'prisma',
    'typeorm',
    'sequelize',
    'kysely',
    'mikro-orm',
  ],
  'component-lib': [
    '@radix-ui/react-dialog',
    '@mui/material',
    'antd',
    '@chakra-ui/react',
    'shadcn',
  ],
  testing: [
    'vitest',
    'jest',
    '@testing-library/react',
    'cypress',
    'playwright',
  ],
}

/**
 * Reverse index: package name -> every category it belongs to, built once at
 * module load. Packages legitimately span concerns — `@reduxjs/toolkit` is
 * both state and data-fetching (RTK Query) — so this is a list, not a scalar.
 */
export const PACKAGE_TO_CATEGORIES: Record<string, string[]> = (() => {
  const index: Record<string, string[]> = {}
  for (const [category, pkgs] of Object.entries(CATEGORY_TAXONOMY)) {
    for (const pkg of pkgs) {
      index[pkg] = [...(index[pkg] ?? []), category]
    }
  }
  return index
})()

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

export interface DeprecatedApiRule {
  framework: string
  /** Matches if ANY of these show up in the skill's extracted apiCalls */
  deprecatedApiCalls?: string[]
  /** Matches if ANY of these show up in the skill's extracted importSpecifiers (exact or prefix) */
  deprecatedImportSpecifiers?: string[]
  /** human-readable description of what superseded it */
  message: string
  /** repo must actually use this import specifier for the rule to fire — otherwise
   *  we can't tell whether the project moved on, or never used this framework's
   *  routing/component model in the first place */
  onlyIfRepoUses: string
}

/**
 * Small, hand-maintained ruleset for high-churn framework API changes.
 * Not meant to be exhaustive — covers the handful of changes that generate
 * the most real-world skill staleness. Grows over time per-framework.
 */
/**
 * Required taxonomy categories for a project archetype.
 * Used by the gaps command to recommend missing skill coverage.
 */
export const MUST_HAVE_CHECKLISTS: Record<string, string[]> = {
  frontend: [
    'routing',
    'state',
    'data-fetching',
    'validation',
    'styling',
    'testing',
  ],
  // Website Specification domains (https://specification.website). These are
  // production-web-quality domains, not npm-package categories — coverage comes
  // from a skill declaring the domain in its `categories:` frontmatter.
  // `well-known` is folded into `agent-readiness` for v1.
  website: [
    'foundations',
    'seo',
    'accessibility',
    'security',
    'performance',
    'privacy',
    'resilience',
    'i18n',
    'agent-readiness',
  ],
}

/**
 * Weights for the four technical scoring dimensions (must sum to 1).
 *
 * Note: there is deliberately NO per-skill coverage dimension. Rewarding one
 * skill for touching many categories incentivizes package stuffing and
 * contradicts the "one category per skill" guidance. Portfolio coverage is
 * measured by the `gaps` command instead. `focus` rewards the opposite:
 * staying within 1-2 categories.
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

export const DEPRECATED_API_RULES: DeprecatedApiRule[] = [
  {
    framework: 'next',
    deprecatedApiCalls: [
      'getServerSideProps',
      'getStaticProps',
      'getInitialProps',
    ],
    message:
      'Skill teaches Pages Router data-fetching APIs; project uses App Router conventions.',
    onlyIfRepoUses: 'next/navigation',
  },
  {
    framework: 'next',
    deprecatedImportSpecifiers: ['next/router'],
    message:
      'Skill imports from next/router (Pages Router); project uses next/navigation (App Router).',
    onlyIfRepoUses: 'next/navigation',
  },
]
