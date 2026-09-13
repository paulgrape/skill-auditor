# skill-auditor

[![npm version](https://img.shields.io/npm/v/skill-auditor)](https://www.npmjs.com/package/skill-auditor)
[![CI](https://github.com/paulgrape/skill-auditor/actions/workflows/ci.yml/badge.svg)](https://github.com/paulgrape/skill-auditor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/skill-auditor)](https://github.com/paulgrape/skill-auditor/blob/main/LICENSE)

Audit Agent Skills (`SKILL.md`) against the reality of the project they are installed in. Score alignment, detect drift, find coverage gaps, and suggest fixes for an agentic improvement loop.

> **This is a quality tool, not a security scanner.** `skill-auditor` optimizes and upgrades your skills — it measures how well they match your repo's actual dependencies and patterns, then guides you to improve them. It does **not** check skills for prompt injection, malware, or credential leaks (tools like `skill-audit` do that). Use it to keep skills accurate and useful, not to vet them for safety.

## Why this matters — loop engineering

Skills are the memory an agent brings to your codebase. When they drift from reality, the agent confidently applies stale patterns. `skill-auditor` closes that loop:

- **Set a target, optimize toward it.** Every command emits a machine-readable `--json` score. An agent runs `audit`, reads `suggestions`, fixes each finding substantively, and re-runs to confirm the findings are gone — a measurable improvement loop, not a one-shot check.
- **Ground truth, not vibes.** Scores come from the repo's actual `package.json` deps, imported specifiers, and the identifiers the project really imports from each package, so "better" means "closer to how this project really works."
- **Gaming-resistant by design.** The metric is open, so it is built so that maxing it out requires genuinely good content: only references demonstrated in working code count fully, examples are cross-verified against the repo's real API usage, and stuffing patterns (name-drops without examples, unused import lines, pasted dependency lists, same-category padding) are detected as `metric-stuffing` findings that cap the score at 60.
- **Great for scheduled audits.** On fast-changing projects, skills rot quietly as dependencies and patterns shift. Run `skill-auditor` on a schedule (cron, CI, or a Cursor automation) with `gaps --fail-on-gap` so drift and missing coverage surface automatically instead of at the next incident.

## Scope

### Covered today

**Frontend web apps (JS/TS)** — the core audit loop targets React/Next.js-style projects. Ground truth comes from `package.json` dependencies and import usage scanned across `*.{ts,tsx,js,jsx}` source files. In a monorepo, the dependencies of every workspace package are merged in too, resolved from the root `workspaces` field or `pnpm-workspace.yaml`. Node builtins (`node:fs`, `fs`) and path aliases (`@/…`, `~/…`, `#internal`) are not dependencies, so they are excluded from both sides of the comparison.

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

**Skill kinds:** technical skills (package/API references) get full alignment scoring; mixed skills (a few technical refs) are scored the same way; **procedural** skills (shell workflow, no JS/Python examples) and **neutral** skills (tone/style, no tech refs) get intrinsic quality only — they are not alignment-scored. Only JS/TS-family code blocks (and untagged ones) can produce package or API references — CSS, HTML, shell and other fences are treated as prose. `python` fences contribute their non-stdlib imports as package references.

### Planned

- **Prose analysis** — score and improve the natural-language parts of skills (clarity, structure, actionability), not just code references
- **Backend** — Node/Python/Go APIs, auth, ORMs, queues, and service patterns
- **System & DevOps** — infra, CI/CD, containers, observability, deployment targets
- **Data science** — notebooks, ML libraries, pipelines, and experiment tooling

The package taxonomy already includes Vue, Svelte, Astro and Remix alongside the React/Next.js core. A package can belong to several categories — `@reduxjs/toolkit` is both state and data-fetching — and counts toward each of them for focus, conflict detection, and gap coverage.

Contributions to the taxonomy ([`src/taxonomyData.ts`](src/taxonomyData.ts)) are welcome via PR.

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
skill-auditor audit .cursor/skills --project . --min-score 70
```

Use `--min-score <n>` to fail the command when any scored skill falls below a
0–100 threshold (neutral skills are ignored), and `--fail-on <severity>` to fail
on findings. Both are CI gates and can be combined.

**Scoring dimensions (technical skills):**

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| alignment | 45% | Package/API references that match the project (unknown when nothing is scorable — vague skills don't get a free 100%) |
| specificity | 25% | Substantiated depth: matched references weighted by how real they are — demonstrated usage counts fully, an idle import line counts near zero, a bare inline mention counts a quarter; references verified against the repo's actual imports earn a bonus; diminishing returns, so padding doesn't pay |
| freshness | 20% | Penalty for deprecated APIs the project has moved past |
| focus | 10% | Whether the skill stays within 1–2 stack categories — one concern per skill; portfolio-wide coverage is `gaps`'s job, not any single skill's |

There is deliberately no per-skill coverage dimension: rewarding one skill for touching many categories incentivizes package stuffing. Skills flagged with `metric-stuffing` findings are capped at 60 regardless of the dimensions.

**Neutral skills** (no tech references, e.g. tone/style skills) and **procedural skills** (command-line workflows whose fenced code is shell): repo alignment is `N/A`. Only an intrinsic quality score (0–100) is reported. Findings such as a mentioned rival library are still emitted.

A scored skill below 70 never comes back with an empty findings list: if the dimensions alone dragged the score down, an `unscorable` info finding names what would move it. Findings include `location: { line, heading }` pointing at the SKILL.md section to edit.

Use `--format markdown` for a PR comment, `--format sarif` for GitHub code scanning, and `--baseline previous.json` (with `--fail-on-regression`) to gate an improvement loop. `--json` remains a shorthand for `--format json`.

### `gaps` — find missing skill coverage

```bash
skill-auditor gaps .cursor/skills --project . --checklist frontend
skill-auditor gaps ~/.agents/skills --project . --json
skill-auditor gaps .cursor/skills --project . --checklist frontend --fail-on-gap
```

Pass a skills root — scans recursively for every `SKILL.md` in nested dirs (defaults to the current directory). Use `--fail-on-gap` to exit non-zero when any gap is found (CI-friendly). An unknown `--checklist` key exits `2`.

Two must-have checklists ship today:

- `--checklist frontend` — stack categories derived from npm packages (routing, state, data-fetching, validation, styling, testing).
- `--checklist website` — Website Specification domains (foundations, seo, accessibility, security, performance, privacy, resilience, i18n, agent-readiness). A skill covers a domain by declaring it in `metadata.categories`:

```yaml
---
name: my-a11y-skill
description: Accessibility patterns for this project. Use when auditing or building accessible UI.
metadata:
  categories: accessibility
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

### `validate` — lint SKILL.md against the Agent Skills spec

```bash
skill-auditor validate .cursor/skills --json
```

Checks `name` (format, length, matches the parent directory), `description` (required, ≤1024 characters, should say when to use the skill), unknown frontmatter fields, `metadata` value types, and body length. Error-severity violations exit `1`. A top-level `categories:` list is still read for coverage, but `validate` warns to move it under `metadata.categories`.

### `scaffold` — generate a gap skill from repo evidence

```bash
skill-auditor scaffold routing --project . --out .cursor/skills
skill-auditor scaffold routing --project . --dry-run --json
```

Writes `.cursor/skills/routing/SKILL.md` using the project's real import specifiers and file paths. `--dry-run` prints the file without writing it. Prefer this over inventing a SKILL.md by hand.

### `compare` — score deltas between two audits

```bash
skill-auditor audit .cursor/skills --project . --json > after.json
skill-auditor compare before.json after.json --fail-on-regression
```

Or pass `--baseline before.json` on `audit` itself.

### `scan` / `extract` — debug helpers

```bash
skill-auditor scan .
skill-auditor extract ./my-skill
```

`scan` also reports the `.skill-auditor.json` (or `package.json#skill-auditor`) config that was applied: extra taxonomy entries, checklists and ignore globs. Scoring thresholds are not configurable.

Extend the taxonomy for a project:

```json
{
  "taxonomy": { "routing": ["acme-router"] },
  "checklists": { "acme": ["routing"] },
  "ignore": ["**/generated/**"]
}
```

### `docs` — the machine-readable CLI contract

```bash
skill-auditor docs
```

Prints every command, argument, flag, output shape and exit code as JSON, generated from the CLI definition itself. An agent can discover the surface here instead of trusting a `SKILL.md` that may have drifted from the installed version.

### `mcp` — serve the audit over the Model Context Protocol

```bash
skill-auditor mcp
skill-auditor mcp --confine
```

Runs as a stdio MCP server exposing `audit`, `gaps`, `scan`, `validate`, `extract`, `spec-check`, `docs` and `scaffold` as tools, plus template resources and an `audit-and-fix` prompt — see [Use from an MCP client](#use-from-an-mcp-client). `--confine` rejects paths that resolve outside the working directory.

## JSON contract

Every `--json` payload starts with a `schemaVersion`. It is bumped when a field is removed or changes meaning; new fields may appear without a bump, so read it before parsing and treat unknown fields as additive.

`audit` and `audit-all` always return an array:

```json
{
  "schemaVersion": 1,
  "count": 1,
  "results": [{ "skillDir": "...", "report": {}, "score": {}, "suggestions": [] }],
  "errors": []
}
```

`count` is the number of skills scored. `errors` lists skill directories that could not be read as `{ "skillDir", "error" }`; it is empty on a clean run, and any entry makes the command exit `1`. Findings on each result include `location: { line, heading }` when the extractor knows which SKILL.md section produced them.

`validate` returns `{ count, valid, results }`. `scaffold --json` returns the generated file (`written` is false under `--dry-run`). `compare` returns `{ summary, skills }`. `scan` includes the applied `config`. `extract` includes `locations` and `codeEvidence`. Run `skill-auditor docs` for the live field list.

## Agent loop

Run audit with `--json`, read `suggestions`, fix each finding substantively (rewrite the affected section with a real, repo-grounded example — not a package-name swap), and re-run to confirm the findings are gone:

```bash
skill-auditor audit ./my-skill --project . --json
```

Fixes that only chase the number don't work: name-drops, unused imports, and dependency-list dumps trigger `metric-stuffing` findings that cap the score, and invented APIs surface as `unverified-api` findings pointing at what the repo actually imports.

## Use from an MCP client

`skill-auditor mcp` serves the same analysis over the Model Context Protocol, so any MCP-capable agent can audit skills without installing the bundled skill. Register it as a stdio server:

```json
{
  "mcpServers": {
    "skill-auditor": {
      "command": "npx",
      "args": ["-y", "skill-auditor@latest", "mcp"]
    }
  }
}
```

It exposes read-only tools — `audit`, `gaps`, `scan`, `validate`, `extract`, `spec-check`, `docs` — plus `scaffold` (writes a file unless `dryRun` is true, which is the default). Tool results are the same JSON payloads as the CLI, as both text and `structuredContent`. Templates and the bundled skill are MCP resources (`skill-auditor://templates/…`, `skill-auditor://bundled/skill-auditor`); the `audit-and-fix` prompt walks the improvement loop. Paths resolve relative to the directory the server was started in; `skill-auditor mcp --confine` rejects paths outside that directory. The server speaks the current stateless revision (`2026-07-28`) and the older `initialize` handshake.

## Use as a library

The analysis is also importable, for building your own gate or report:

```ts
import {
  auditSkills,
  buildRepoReality,
  detectGaps,
  findSkillDirs,
} from 'skill-auditor'

const repo = buildRepoReality('.')
const results = auditSkills(repo, findSkillDirs(['.cursor/skills']))

for (const { report, score } of results) {
  console.log(report.skillName, score.overall, report.findings.length)
}
```

`buildRepoReality`, `extractSkillIdentifiers`, `buildAlignmentReport`, `scoreSkill`, `buildSuggestions`, `detectGaps`, `runSpecCompliance`, `validateSkill` and `scaffoldSkill` are exported individually when you want a single stage, along with the TypeScript types for every result. `auditSkills` throws on the first unreadable skill; `auditSkillsSafely` returns `{ results, errors }` instead, which is what the CLI and MCP server use.

## Starter templates

Bundled under `templates/` (reference skills, not auto-installed by `npx skills add`):

- `templates/frontend-must-have/` — checklist skill for modern React/Next.js stacks
- `templates/website-*/` — one reference skill per Website Specification domain (foundations, seo, accessibility, security, performance, privacy, resilience, i18n, agent-readiness), each declaring `metadata.categories` so it counts toward `--checklist website` coverage

Point any command at them, e.g. `skill-auditor audit ./templates/frontend-must-have --project .`.

The `website-*` skills and the `spec-check` item list are curated from the [Website Specification](https://specification.website), licensed CC BY 4.0.

## Test

```bash
npm test
```
