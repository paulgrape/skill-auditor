# skill-auditor

[![npm version](https://img.shields.io/npm/v/skill-auditor)](https://www.npmjs.com/package/skill-auditor)
[![CI](https://github.com/paulgrape/skill-auditor/actions/workflows/ci.yml/badge.svg)](https://github.com/paulgrape/skill-auditor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/skill-auditor)](https://github.com/paulgrape/skill-auditor/blob/main/LICENSE)

Audit Agent Skills (`SKILL.md`) against the reality of the project they are installed in. Score alignment, detect drift, find coverage gaps, and suggest fixes for an agentic improvement loop.

> **This is a quality tool, not a security scanner.** `skill-auditor` optimizes and upgrades your skills — it measures how well they match your repo's actual dependencies and patterns, then guides you to improve them. It does **not** check skills for prompt injection, malware, or credential leaks (tools like `skill-audit` do that). Use it to keep skills accurate and useful, not to vet them for safety.

## Why this matters — loop engineering

Skills are the memory an agent brings to your codebase. When they drift from reality, the agent confidently applies stale patterns. `skill-auditor` closes that loop:

- **Set a target, optimize toward it.** Every command emits a machine-readable `--json` score. An agent runs `audit`, reads `suggestions`, edits the skill, and re-runs until `score.overall` stops rising — a measurable optimization loop, not a one-shot check. This is the core of a loop-engineering workflow: a concrete objective the agent can hill-climb.
- **Ground truth, not vibes.** Scores come from the repo's actual `package.json` deps and imported specifiers, so "better" means "closer to how this project really works."
- **Great for scheduled audits.** On fast-changing projects, skills rot quietly as dependencies and patterns shift. Run `skill-auditor` on a schedule (cron, CI, or a Cursor automation) with `gaps --fail-on-gap` so drift and missing coverage surface automatically instead of at the next incident.

## Scope

### Covered today

**Frontend web apps (JS/TS)** — the core audit loop targets React/Next.js-style projects. Ground truth comes from `package.json` dependencies and import usage scanned across `*.{ts,tsx,js,jsx}` source files.

| Area | What is checked |
|------|-----------------|
| **Languages** | JavaScript, TypeScript (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) |
| **Frameworks** | React ecosystem; **Next.js** (including Pages Router → App Router drift detection) |
| **Routing** | `next`, `react-router`, `@tanstack/react-router`, `wouter`, … |
| **State** | `zustand`, `redux`, `jotai`, `recoil`, `mobx`, `valtio`, … |
| **Data fetching** | `swr`, `@tanstack/react-query`, Apollo, `urql`, … |
| **Forms & validation** | `react-hook-form`, `formik`, `zod`, `yup`, `valibot`, … |
| **Styling** | `tailwindcss`, `styled-components`, Emotion, Sass, `vanilla-extract`, … |
| **Testing** | `vitest`, `jest`, Testing Library, Cypress, Playwright |
| **ORM / DB** | `drizzle-orm`, `prisma`, `typeorm`, `kysely`, … (detected when present) |
| **Component libs** | Radix, MUI, Ant Design, Chakra, shadcn, … |

**Checklists:**

- `--checklist frontend` — must-have stack categories: routing, state, data-fetching, validation, styling, testing
- `--checklist website` — [Website Specification](https://specification.website) domains (foundations, SEO, accessibility, security, performance, privacy, resilience, i18n, agent-readiness)
- `spec-check` — static compliance scan for HTML head, public assets, header config, routes (opt-in)

**Skill kinds:** technical skills (package/API references) get full alignment scoring; neutral skills (tone/style, no tech refs) get intrinsic quality scoring only.

### Planned

- **More frontend frameworks** — Vue, Svelte, Astro, Remix, and broader taxonomy coverage
- **Prose analysis** — score and improve the natural-language parts of skills (clarity, structure, actionability), not just code references
- **Backend** — Node/Python/Go APIs, auth, ORMs, queues, and service patterns
- **System & DevOps** — infra, CI/CD, containers, observability, deployment targets
- **Data science** — notebooks, ML libraries, pipelines, and experiment tooling

Contributions to the taxonomy ([`src/taxonomy.ts`](src/taxonomy.ts)) are welcome via PR.

## Install

Run the CLI directly with no install:

```bash
npx skill-auditor audit <path-to-skill> --project .
```

Or install it globally:

```bash
npm install -g skill-auditor
skill-auditor audit <path-to-skill> --project .
```

## Use as an agent skill

Install the `skill-auditor` skill into your project (or globally) with the [`skills`](https://github.com/vercel-labs/skills) CLI. The agent then knows how to audit and fill skill gaps for you:

```bash
npx skills add paulgrape/skill-auditor
```

This installs a single skill named `skill-auditor`. It calls the CLI via `npx -y skill-auditor@latest`, so no separate `npm install` is required.

## Local development

```bash
npm install
npm run build
npm link            # exposes the skill-auditor binary
npm test
```

## Commands

### `audit` — score a skill against a project

```bash
skill-auditor audit ./my-skill --project .
skill-auditor audit ./my-skill --project . --json
```

**Scoring dimensions (technical skills):**

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| alignment | 40% | Package/API references that match the project |
| coverage | 30% | How many of the project's stack categories the skill covers |
| freshness | 20% | Penalty for deprecated APIs the project has moved past |
| specificity | 10% | Whether the skill has enough concrete references (anti-vague) |

**Neutral skills** (no tech references, e.g. tone/style skills): repo alignment is `N/A`. Only an intrinsic quality score (0–100) is reported based on structure, frontmatter, examples, and clarity.

### `gaps` — find missing skill coverage

```bash
skill-auditor gaps .cursor/skills --project . --checklist frontend
skill-auditor gaps ~/.agents/skills --project . --json
skill-auditor gaps .cursor/skills --project . --checklist frontend --fail-on-gap
```

Pass a skills root — scans recursively for every `SKILL.md` in nested dirs. Use `--fail-on-gap` to exit non-zero when any gap is found (CI-friendly).

Two must-have checklists ship today:

- `--checklist frontend` — stack categories derived from npm packages (routing, state, data-fetching, validation, styling, testing).
- `--checklist website` — Website Specification domains (foundations, seo, accessibility, security, performance, privacy, resilience, i18n, agent-readiness). A skill covers a domain by declaring it in a `categories:` frontmatter list:

```yaml
---
name: my-a11y-skill
categories:
  - accessibility
---
```

### `spec-check` — static Website Specification compliance

```bash
skill-auditor spec-check --project .
skill-auditor spec-check --project . --json
skill-auditor spec-check --project . --priority required
```

Statically scans the project (document head, public assets, header config, routes) against a curated subset of the [Website Specification](https://specification.website). Each item reports `pass`, `fail`, or `skip` — items that need a live URL or runtime audit (HTTPS, HSTS, Core Web Vitals, colour contrast, cookie-consent UX) are always `skip`. Exit code is `1` when any item fails.

> **Not run by default.** `spec-check` (and the `--checklist website` domains) is opt-in. The default audit loop covers technical, package-backed skills only; run `spec-check` explicitly when you want Website Specification compliance.

### `list` / `audit-all` — discover and batch-audit

```bash
skill-auditor list .cursor/skills
skill-auditor audit-all .cursor/skills --project . --json
```

Reports taxonomy categories the project uses but no installed skill covers, plus gaps against must-have checklists.

### `scan` / `extract` — debug helpers

```bash
skill-auditor scan .
skill-auditor extract ./my-skill
```

## Agent loop

Run audit with `--json`, read `suggestions`, edit the skill, re-run until `score.overall` stops rising:

```bash
skill-auditor audit ./my-skill --project . --json
```

## Starter templates

Bundled under `templates/` (reference skills, not auto-installed by `npx skills add`):

- `templates/frontend-must-have/` — checklist skill for modern React/Next.js stacks
- `templates/website-*/` — one reference skill per Website Specification domain (foundations, seo, accessibility, security, performance, privacy, resilience, i18n, agent-readiness), each declaring its `categories:` so it counts toward `--checklist website` coverage

Point any command at them, e.g. `skill-auditor audit ./templates/frontend-must-have --project .`.

The `website-*` skills and the `spec-check` item list are curated from the [Website Specification](https://specification.website), licensed CC BY 4.0.

## Test

```bash
npm test
```
