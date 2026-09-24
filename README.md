# skill-auditor

[![npm version](https://img.shields.io/npm/v/skill-auditor)](https://www.npmjs.com/package/skill-auditor)
[![CI](https://github.com/paulgrape/skill-auditor/actions/workflows/ci.yml/badge.svg)](https://github.com/paulgrape/skill-auditor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/skill-auditor)](https://github.com/paulgrape/skill-auditor/blob/main/LICENSE)

Audit Agent Skills (`SKILL.md`) against the reality of the project they are installed in. Score alignment, detect drift, find coverage gaps, and suggest fixes for an agentic improvement loop.

> **This is a quality tool, not a security scanner.** `skill-auditor` optimizes and upgrades your skills — it measures how well they match your repo's actual dependencies and patterns, then guides you to improve them. It does **not** check skills for prompt injection, malware, or credential leaks (tools like `skill-audit` do that). Use it to keep skills accurate and useful, not to vet them for safety.

## Why this matters — loop engineering

Skills are the memory an agent brings to your codebase. When they drift from reality, the agent confidently applies stale patterns. `skill-auditor` closes that loop:

- **Set a target, optimize toward it.** Every command emits a machine-readable `--json` score. An agent runs `audit`, reads `suggestions`, fixes each finding substantively, and re-runs to confirm the findings are gone — a measurable improvement loop, not a one-shot check.
- **Ground truth, not vibes.** Scores come from the repo's actual manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`), imported specifiers, and the identifiers the project really imports from each package, so "better" means "closer to how this project really works."
- **Gaming-resistant by design.** The metric is open, so it is built so that maxing it out requires genuinely good content: only references demonstrated in working code count fully, examples are cross-verified against the repo's real API usage, and stuffing patterns (name-drops without examples, unused import lines, pasted dependency lists, same-category padding) are detected as `metric-stuffing` findings that cap the score at 60.
- **Great for scheduled audits.** On fast-changing projects, skills rot quietly as dependencies and patterns shift. Run `skill-auditor` on a schedule (cron, CI, or a Cursor automation) with `gaps --fail-on-gap` so drift and missing coverage surface automatically instead of at the next incident.

## Scope

### Covered today

**Ground truth across four ecosystems.** A project's declared stack is read from every manifest under it and its imports are scanned per language; a polyglot repo with a `frontend/` package.json, a `backend/` pyproject and a Go service needs no configuration. Standard libraries, relative imports, path aliases (`@/…`, `~/…`, `#internal`) and the project's own modules are not dependencies, so they are excluded from both sides of the comparison. `scan` reports which `ecosystems` it found.

| Ecosystem | Declared by | Used by |
|-----------|-------------|---------|
| **npm** | `package.json` (`dependencies`, `devDependencies`, `peerDependencies`), merged across npm/yarn `workspaces` and `pnpm-workspace.yaml` packages | `import`/`export … from`, side-effect imports, `require()`, dynamic `import()` in `.ts .tsx .js .jsx .mjs .cjs .mts .cts` |
| **Python** | `pyproject.toml` (PEP 621 `dependencies`, optional groups, `dependency-groups`, Poetry and PDM tables), `requirements*.txt` | `import x`, `from x import y` in `.py` — names PEP 503-normalized |
| **Go** | `go.mod` direct `require` entries (indirect ones are not the stack) | `import` declarations in `.go`, reduced to the module (`github.com/owner/repo`, major-version suffix folded) |
| **Cargo** | `Cargo.toml` (`dependencies`, `dev-`, `build-`, target-specific and `workspace.dependencies`) | `use`, `extern crate` and bare `crate::path` usage in `.rs` — hyphens normalized to `_` |

**Frontend web apps (JS/TS)** remain the core of the *taxonomy*: categories, checklists, conflict detection and gap coverage know the React/Next.js ecosystem best. Python, Go and Rust packages are audited for alignment (declared, used, verified identifiers) without a category unless you add one in `.skill-auditor.json`.

| Area | What is checked |
|------|-----------------|
| **Languages** | JavaScript, TypeScript, Python, Go, Rust |
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

**Skill kinds:** a skill's kind is decided by its package references alone. Technical skills (more than three package references) and mixed skills (one to three) get full alignment scoring; **procedural** skills (package references, but the only fenced code is shell) and **neutral** skills (no package references) get intrinsic quality only — they are not alignment-scored. API-call-shaped identifiers (`readFileSync(`) never make a skill technical on their own; they are still extracted and verified against the repo's imports for `unverified-api` findings. Fenced blocks tagged `js`/`ts`/`jsx`/`tsx` (and untagged ones), `python`, `go` and `rust` are read with the same import scanners the project scan uses; CSS, HTML, shell and other fences are treated as prose. Bundled `scripts/` and `references/` files are read by extension the same way.

### Parsers

JS/TS source is read by a built-in import lexer that needs no dependencies: it masks comments, strings, template literals, regex literals and JSX text, then reads every import form from what is left. Projects that want the TypeScript compiler can opt into `ts-morph`, an optional peer dependency:

```bash
npm install -D ts-morph
skill-auditor scan . --parser ts-morph        # or SKILL_AUDITOR_PARSER=ts-morph
```

Both parsers produce the same ground truth on the test fixtures (see `test/lexer.test.mjs`), and `scan` reports the `parser` it used. The cache is keyed by parser too, so switching never serves stale results.

### Planned

- **Prose analysis** — score and improve the natural-language parts of skills (clarity, structure, actionability), not just code references
- **Backend taxonomy** — categories for Python/Go/Rust web frameworks, ORMs, queues and service patterns, so backend skills get focus and gap coverage too
- **System & DevOps** — infra, CI/CD, containers, observability, deployment targets
- **Data science** — notebooks, ML libraries, pipelines, and experiment tooling

The package taxonomy already includes Vue, Svelte, Astro and Remix alongside the React/Next.js core. A package can belong to several categories — `@reduxjs/toolkit` is both state and data-fetching — and counts toward each of them for focus, conflict detection, and gap coverage.

Contributions to the taxonomy ([`src/taxonomyData.ts`](src/taxonomyData.ts)) are welcome via PR.

## Install

Requires Node.js 20 or newer. Run the CLI directly with no install:

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

A scored skill below 70 never comes back with an empty findings list: if the dimensions alone dragged the score down, an `unscorable` info finding names what would move it. Every finding includes `location: { file, line, heading? }` pointing at the file and line to edit — `SKILL.md` or a bundled `scripts/`/`references/` file; skill-wide findings such as `category-conflict` point at `SKILL.md` line 1.

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

Checks `name` (format, length, matches the parent directory), `description` (required, ≤1024 characters, should say when to use the skill), unknown frontmatter fields, `metadata` value types, and body length. Error-severity violations exit `1`. Categories are read from `metadata.categories` only; a top-level `categories:` list is not part of the Agent Skills spec and is ignored, and `validate` warns to move it.

### `scaffold` — generate a gap skill from repo evidence

```bash
skill-auditor scaffold routing --project . --out .cursor/skills
skill-auditor scaffold routing --project . --dry-run --json
```

Writes `.cursor/skills/routing/SKILL.md` using the project's real import specifiers and file paths, with code fences tagged for the ecosystem each example comes from. `--dry-run` prints the file without writing it. Prefer this over inventing a SKILL.md by hand.

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

`scan` reports the `ecosystems` it found, the `parser` it used and the `.skill-auditor.json` (or `package.json#skill-auditor`) config that was applied: extra taxonomy entries, checklists and ignore globs. `node_modules`, `.venv`, `__pycache__`, `vendor`, `target` and other build/dependency directories are ignored by default. Every RepoReality-building command accepts `--no-cache` and `--parser <lexer|ts-morph>`. Scoring thresholds are not configurable.

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
  "schemaVersion": 2,
  "count": 1,
  "results": [{ "skillDir": "...", "report": {}, "score": {}, "suggestions": [] }],
  "errors": []
}
```

`count` is the number of skills scored. `errors` lists skill directories that could not be read as `{ "skillDir", "error" }`; it is empty on a clean run, and any entry makes the command exit `1`. Every finding carries `location: { file, line, heading? }`; `file` is relative to the skill directory.

`validate` returns `{ count, valid, results }`. `scaffold --json` returns the generated file (`written` is false under `--dry-run`). `compare` returns `{ summary, skills }`. `scan` includes `ecosystems`, `parser`, per-evidence `ecosystem` and the applied `config`. `extract` includes `locations` (each with `file`) and `codeEvidence`. Run `skill-auditor docs` for the live field list.

**Schema 2** (skill-auditor 2.0) changed from schema 1: `location` is required on every finding and every extracted reference, and gained `file`; `RepoReality` gained `ecosystems` and `parser`, and each `importEvidence` entry gained `ecosystem`; a skill's `kind` no longer counts API calls, so skills with only API-call-shaped identifiers are `neutral` rather than `mixed`; and `categories` are read from `metadata.categories` only. Consumers pinned to schema 1 should check `schemaVersion` and stay on skill-auditor 1.x.

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

`buildRepoReality(root, { cache?, parser? })`, `extractSkillIdentifiers`, `buildAlignmentReport`, `scoreSkill`, `buildSuggestions`, `detectGaps`, `runSpecCompliance`, `validateSkill` and `scaffoldSkill` are exported individually when you want a single stage, along with the TypeScript types for every result. The per-language import scanners (`scanJavaScriptImports`, `scanPythonImports`, `scanGoImports`, `scanRustImports`) and manifest readers (`readPyproject`, `readRequirements`, `readGoMod`, `readCargoToml`) are exported too. `auditSkills` throws on the first unreadable skill; `auditSkillsSafely` returns `{ results, errors }` instead, which is what the CLI and MCP server use.

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
