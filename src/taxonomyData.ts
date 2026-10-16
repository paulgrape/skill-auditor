import type { Ecosystem } from './types.js'

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
    'pydantic',
    'marshmallow',
    'go-playground/validator',
    'github.com/go-playground/validator',
    'garde',
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
    'sqlalchemy',
    'sqlmodel',
    'tortoise-orm',
    'peewee',
    'gorm',
    'gorm.io/gorm',
    'ent',
    'entgo.io/ent',
    'sqlx',
    'github.com/jmoiron/sqlx',
    'diesel',
    'sea-orm',
    'sea_orm',
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
    'pytest',
    'hypothesis',
    'testify',
    'github.com/stretchr/testify',
    'gomock',
    'go.uber.org/mock',
    'github.com/golang/mock',
    'mockall',
    'proptest',
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
  'web-framework': [
    'fastapi',
    'flask',
    'django',
    'gin',
    'github.com/gin-gonic/gin',
    'echo',
    'github.com/labstack/echo',
    'chi',
    'github.com/go-chi/chi',
    'fiber',
    'github.com/gofiber/fiber',
    'axum',
    'actix-web',
    'actix_web',
    'rocket',
  ],
  'http-client': [
    'httpx',
    'requests',
    'aiohttp',
    'resty',
    'github.com/go-resty/resty',
    'reqwest',
  ],
  'task-queue': [
    'celery',
    'rq',
    'dramatiq',
    'arq',
    'asynq',
    'github.com/hibiken/asynq',
  ],
  serialization: [
    'serde',
    'serde_json',
    'msgspec',
    'orjson',
  ],
  logging: [
    'structlog',
    'loguru',
    'zap',
    'go.uber.org/zap',
    'zerolog',
    'github.com/rs/zerolog',
    'tracing',
    'tracing_subscriber',
  ],
  cli: [
    'typer',
    'click',
    'cobra',
    'github.com/spf13/cobra',
    'clap',
  ],
  config: [
    'pydantic-settings',
    'viper',
    'github.com/spf13/viper',
    'dynaconf',
    'figment',
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
  backend: [
    'web-framework',
    'orm-db',
    'validation',
    'testing',
    'logging',
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
  /**
   * Alternatively, the repo must belong to one of these ecosystems (used when
   * the successor API is in the language's standard library, e.g. Go `io`/`os`
   * or `errors`/`fmt`, Rust `std::sync::OnceLock`, Python 3.12+ stdlib/setuptools).
   */
  onlyIfRepoEcosystem?: Ecosystem | Ecosystem[]
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
  // Go deprecations
  {
    framework: 'go',
    deprecatedImportSpecifiers: ['io/ioutil'],
    deprecatedApiCalls: [
      'ioutil.ReadAll',
      'ioutil.ReadFile',
      'ioutil.WriteFile',
      'ioutil.TempDir',
      'ioutil.TempFile',
      'ioutil.NopCloser',
      'ioutil.Discard',
    ],
    message:
      'Skill uses io/ioutil (deprecated since Go 1.16); use io and os directly (io.ReadAll, os.ReadFile, os.WriteFile, os.MkdirTemp, os.CreateTemp).',
    onlyIfRepoUses: ['io', 'os'],
    onlyIfRepoEcosystem: 'go',
  },
  {
    framework: 'go',
    deprecatedImportSpecifiers: ['github.com/pkg/errors'],
    deprecatedApiCalls: [
      'errors.Wrap',
      'errors.Wrapf',
      'errors.WithStack',
      'errors.WithMessage',
      'errors.Cause',
    ],
    message:
      'Skill uses github.com/pkg/errors (archived); use standard library error wrapping (fmt.Errorf with %w, errors.Is, errors.As, errors.Join).',
    onlyIfRepoUses: ['errors', 'fmt'],
    onlyIfRepoEcosystem: 'go',
  },
  // Rust deprecations
  {
    framework: 'rust',
    deprecatedImportSpecifiers: ['failure'],
    message:
      'Skill uses the deprecated failure crate; project uses thiserror / anyhow for error handling.',
    onlyIfRepoUses: ['thiserror', 'anyhow'],
  },
  {
    framework: 'rust',
    deprecatedImportSpecifiers: ['structopt'],
    deprecatedApiCalls: ['StructOpt'],
    message:
      'Skill uses structopt; project uses clap (v3+ integrates derive macros via #[derive(Parser)]).',
    onlyIfRepoUses: 'clap',
  },
  {
    framework: 'rust',
    deprecatedImportSpecifiers: ['async-std', 'async_std'],
    message:
      'Skill uses async-std (discontinued); project uses tokio / smol as its async runtime.',
    onlyIfRepoUses: ['tokio', 'smol'],
  },
  {
    framework: 'rust',
    deprecatedImportSpecifiers: ['lazy_static'],
    deprecatedApiCalls: ['lazy_static'],
    message:
      'Skill uses lazy_static; prefer std::sync::LazyLock / std::sync::OnceLock (or once_cell).',
    onlyIfRepoUses: 'once_cell',
    onlyIfRepoEcosystem: 'cargo',
  },
  // Python deprecations
  {
    framework: 'pydantic',
    deprecatedImportSpecifiers: ['pydantic.v1'],
    message:
      'Skill imports from pydantic.v1; project uses Pydantic v2 (BaseModel, field_validator, model_dump, ConfigDict).',
    onlyIfRepoUses: 'pydantic',
  },
  {
    framework: 'pydantic',
    deprecatedApiCalls: [
      '.dict()',
      '@validator',
      'validator',
      '@root_validator',
      'root_validator',
      'class Config',
      'parse_obj',
      'parse_raw',
    ],
    message:
      'Skill uses Pydantic v1 APIs (.dict(), @validator, class Config); project uses Pydantic v2 (model_dump(), @field_validator, model_config = ConfigDict(...)).',
    onlyIfRepoUses: 'pydantic',
  },
  {
    framework: 'python',
    deprecatedImportSpecifiers: ['distutils'],
    message:
      'Skill imports distutils (removed in Python 3.12, PEP 632); use setuptools, packaging, or importlib.metadata.',
    onlyIfRepoUses: ['setuptools', 'packaging', 'hatchling'],
    onlyIfRepoEcosystem: 'python',
  },
  {
    framework: 'sqlalchemy',
    deprecatedApiCalls: ['Query', 'session.query'],
    message:
      'Skill uses legacy SQLAlchemy 1.x session.query() / Query API; project uses SQLAlchemy 2.0 style (select(), session.execute(), session.scalars()).',
    onlyIfRepoUses: 'sqlalchemy',
  },
  {
    framework: 'fastapi',
    deprecatedApiCalls: ['on_event'],
    message:
      'Skill uses FastAPI @app.on_event("startup" | "shutdown") (deprecated); use an asynccontextmanager lifespan handler on FastAPI(lifespan=...).',
    onlyIfRepoUses: 'fastapi',
  },
]
