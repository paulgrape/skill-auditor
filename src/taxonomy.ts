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

/** Reverse index: package name -> category, built once at module load. */
export const PACKAGE_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_TAXONOMY).flatMap(([category, pkgs]) =>
    pkgs.map(p => [p, category]),
  ),
)

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

/** Weights for the four technical scoring dimensions (must sum to 1). */
export const SCORE_WEIGHTS = {
  alignment: 0.4,
  coverage: 0.3,
  freshness: 0.2,
  specificity: 0.1,
} as const

/** Reference count at which specificity score saturates at 1. */
export const SPECIFICITY_SATURATION = 5

/** Penalty per deprecated-api critical finding applied to freshness. */
export const FRESHNESS_PENALTY = 0.5

/** Total tech references below which a skill is classified mixed (not technical). */
export const MIXED_SKILL_THRESHOLD = 3

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
