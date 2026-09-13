/**
 * The curated tables behind the audit, kept free of logic so `docs` can print
 * them verbatim and a project can extend them from `.skill-auditor.json`.
 * They are meant to grow via PRs, not to be exhaustive on day one.
 */

/**
 * Groups packages that solve the same problem, so we can detect "skill
 * assumes Redux, project uses Zustand" — a real conflict with zero string
 * overlap, which substring matching can never catch. A package may appear
 * under several categories.
 */
export const BASE_CATEGORY_TAXONOMY: Record<string, string[]> = {
  state: [
    'zustand',
    'redux',
    '@reduxjs/toolkit',
    'jotai',
    'recoil',
    'mobx',
    'valtio',
    'xstate',
    '@xstate/react',
    '@tanstack/store',
    'pinia',
    'vuex',
    'nanostores',
  ],
  routing: [
    'next',
    'react-router',
    'react-router-dom',
    '@tanstack/router',
    '@tanstack/react-router',
    'wouter',
    '@remix-run/react',
    '@remix-run/node',
    'nuxt',
    'vue-router',
    '@sveltejs/kit',
    'astro',
  ],
  'data-fetching': [
    'swr',
    '@tanstack/react-query',
    '@tanstack/query',
    '@tanstack/vue-query',
    '@tanstack/svelte-query',
    '@reduxjs/toolkit',
    'apollo-client',
    '@apollo/client',
    '@vue/apollo-composable',
    'urql',
    '@urql/core',
    'axios',
    'ky',
    'ofetch',
    '@trpc/client',
    '@trpc/react-query',
  ],
  forms: [
    'react-hook-form',
    'formik',
    'final-form',
    '@tanstack/react-form',
    '@tanstack/vue-form',
    'vee-validate',
    '@conform-to/react',
    'sveltekit-superforms',
  ],
  validation: [
    'zod',
    'yup',
    'joi',
    'superstruct',
    'valibot',
    'arktype',
    '@sinclair/typebox',
    'class-validator',
  ],
  styling: [
    'tailwindcss',
    'styled-components',
    '@emotion/react',
    '@emotion/styled',
    'sass',
    'vanilla-extract',
    '@vanilla-extract/css',
    'unocss',
    '@stitches/react',
    '@pandacss/dev',
    'styled-jsx',
  ],
  'orm-db': [
    'drizzle-orm',
    'prisma',
    '@prisma/client',
    'typeorm',
    'sequelize',
    'kysely',
    'mikro-orm',
    '@mikro-orm/core',
    'mongoose',
    'knex',
  ],
  'component-lib': [
    '@radix-ui/react-dialog',
    '@radix-ui/react-popover',
    '@radix-ui/react-dropdown-menu',
    '@radix-ui/react-tooltip',
    '@radix-ui/themes',
    '@headlessui/react',
    '@mui/material',
    '@mantine/core',
    'antd',
    '@chakra-ui/react',
    'shadcn',
    'vuetify',
    'primevue',
    'element-plus',
    'naive-ui',
    '@nuxt/ui',
    'bits-ui',
    '@skeletonlabs/skeleton',
  ],
  testing: [
    'vitest',
    'jest',
    'mocha',
    'ava',
    '@testing-library/react',
    '@testing-library/vue',
    '@testing-library/svelte',
    '@testing-library/user-event',
    'cypress',
    'playwright',
    '@playwright/test',
  ],
  i18n: [
    'i18next',
    'react-i18next',
    'next-i18next',
    'next-intl',
    'react-intl',
    '@formatjs/intl',
    '@lingui/react',
    'vue-i18n',
    '@nuxtjs/i18n',
    'paraglide-js',
  ],
}

/**
 * Required taxonomy categories for a project archetype. Used by the gaps
 * command to recommend missing skill coverage.
 */
export const BASE_MUST_HAVE_CHECKLISTS: Record<string, string[]> = {
  frontend: [
    'routing',
    'state',
    'data-fetching',
    'validation',
    'styling',
    'testing',
  ],
  // Website Specification domains (https://specification.website). These are
  // production-web-quality domains, not npm-package categories — coverage
  // comes from a skill declaring the domain in its `metadata.categories`.
  // `well-known` is folded into `agent-readiness` for v1. `i18n` is both a
  // domain and a package category, so either a declaration or an i18n
  // library reference covers it.
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

export interface DeprecatedApiRule {
  framework: string
  /** Matches if ANY of these show up in the skill's extracted apiCalls */
  deprecatedApiCalls?: string[]
  /** Matches if ANY of these show up in the skill's extracted importSpecifiers (exact or prefix) */
  deprecatedImportSpecifiers?: string[]
  /** human-readable description of what superseded it */
  message: string
  /**
   * The repo must actually import one of these specifiers for the rule to
   * fire — otherwise we can't tell whether the project moved on, or never
   * used this framework's model in the first place.
   */
  onlyIfRepoUses?: string | string[]
  /**
   * Alternatively (or additionally), the repo must import one of these
   * identifiers from the named package — for successor APIs that live in the
   * same package as the deprecated ones.
   */
  onlyIfRepoImports?: { package: string; identifier: string }[]
}

/**
 * Small, hand-maintained ruleset for high-churn framework API changes. Not
 * meant to be exhaustive — covers the handful of changes that generate the
 * most real-world skill staleness. Grows over time per-framework.
 */
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
  {
    framework: 'next',
    deprecatedImportSpecifiers: ['next/head'],
    message:
      'Skill imports next/head (Pages Router); in the App Router the project uses, document metadata comes from the `metadata` export or generateMetadata.',
    onlyIfRepoUses: 'next/navigation',
  },
  {
    framework: 'react-router',
    deprecatedImportSpecifiers: ['react-router-dom'],
    message:
      'Skill imports from react-router-dom; since React Router v7 everything is exported from react-router, which is what the project imports.',
    onlyIfRepoUses: 'react-router',
  },
  {
    framework: 'react-router',
    deprecatedApiCalls: ['useHistory', 'withRouter'],
    message:
      'Skill uses React Router v5 APIs (useHistory/withRouter); project is on v6+, where useNavigate and hooks replace them.',
    onlyIfRepoImports: [
      { package: 'react-router', identifier: 'useNavigate' },
      { package: 'react-router-dom', identifier: 'useNavigate' },
    ],
  },
  {
    framework: '@tanstack/react-query',
    deprecatedImportSpecifiers: ['react-query'],
    message:
      'Skill imports from react-query (v3); project uses @tanstack/react-query (v4+), where the package name and several options changed.',
    onlyIfRepoUses: '@tanstack/react-query',
  },
  {
    framework: 'redux',
    deprecatedApiCalls: ['createStore'],
    message:
      'Skill uses redux createStore; project uses Redux Toolkit, where configureStore and createSlice are the supported API.',
    onlyIfRepoUses: '@reduxjs/toolkit',
  },
]
