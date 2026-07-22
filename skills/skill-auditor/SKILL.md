---
name: skill-auditor
description: Audits a project's Agent Skills with skill-auditor, scores alignment, detects stack coverage gaps, and creates missing SKILL.md files matched to the repo's actual dependencies. Use when the user asks to audit skills, fill skill gaps, improve skill scores, bootstrap .cursor/skills for a project, or run skill-auditor.
disable-model-invocation: true
---

# Audit repo skills and fill gaps

Use the `skill-auditor` CLI to measure skill quality against repo reality, then create or fix skills until gaps shrink.

## Ground rules — improve skills, not scores

The score is a proxy. The deliverable is a skill that teaches this repo's real patterns. Hard rules:

- **Fix findings substantively.** Every fix must change what the skill *teaches* — a working example, a correct API, an accurate file path. Never add, rename, or shuffle references just to move a number.
- **Do not reverse-engineer the auditor.** Do not read the skill-auditor source, `dist/` output, or scoring weights to find shortcuts. The findings and `suggestions` in the JSON output are the intended and only interface.
- **The auditor detects gaming.** Bare package name-drops, import lines whose bindings are never used, pasted dependency lists, and same-category padding produce `metric-stuffing` findings that cap the score at 60. APIs the repo never uses produce `unverified-api` findings. The highest-scoring path is genuinely repo-grounded content.
- **When a finding is wrong, say so.** If a suggestion doesn't fit (e.g. the skill intentionally recommends a library the repo should adopt), tell the user instead of contorting the skill to silence the finding.

## Prerequisites

No install required. Throughout this skill, `skill-auditor <command>` means either:

- the global binary, if `skill-auditor` is on PATH (`npm install -g skill-auditor`), or
- `npx -y skill-auditor@latest <command>` otherwise (no install needed).

Verify (use whichever form applies):

```bash
skill-auditor list --json
# or, with no install:
npx -y skill-auditor@latest list --json
```

## Step 1 — Locate paths

| What | Typical path |
|------|--------------|
| Project root | `.` (cwd) |
| Project skills | `.cursor/skills` |
| Personal skills | `~/.cursor/skills` or `~/.agents/skills` |

Ask the user which skills root to audit if unclear. Default to `.cursor/skills` when it exists in the project.

Set variables for the rest of the workflow:

- `SKILLS_ROOT` — skills directory to audit/create in
- `PROJECT` — project root (usually `.`)

## Step 1b — Choose scope (default: technical only)

Default scope: **audit and fix only technical skills** — the package-backed stack (routing, state, data-fetching, validation, styling, testing, forms, orm-db) via `--checklist frontend`. Do this without asking.

Website Specification work (the `--checklist website` domains + `spec-check` static compliance) is **opt-in**. Before running any `spec-check` or fixing/creating `website-*` domain skills, ask the user:

> Also run the Website Specification check (SEO, accessibility, security headers, privacy, etc.) and fix those gaps? Default is no — technical skills only.

Set `WEBSITE_SCOPE=yes` only if the user confirms. Otherwise leave it off and skip every website-only step below. If the user's original request already named website/SEO/a11y/security auditing explicitly, treat that as confirmation and skip the question.

## Step 2 — Baseline audit

Always run the technical baseline; parse JSON output.

```bash
skill-auditor scan $PROJECT --json
skill-auditor audit $SKILLS_ROOT --project $PROJECT --json
skill-auditor gaps $SKILLS_ROOT --project $PROJECT --checklist frontend --json
```

Only when `WEBSITE_SCOPE=yes`, also run the website checklist and static compliance:

```bash
skill-auditor gaps $SKILLS_ROOT --project $PROJECT --checklist website --json
skill-auditor spec-check $PROJECT --json
skill-auditor spec-check $PROJECT --priority required --json
```

From `scan`: note `declaredDeps` and `usedImports` — ground truth for packages and import specifiers.

From `audit`:
- Single skill → `{ report, score, suggestions }`
- Skills root → `{ count, results: [{ report, score, suggestions }] }`
- Fix skills with low `score.overall` or critical findings using `suggestions`
- Skip `kind: neutral` skills for alignment fixes (quality-only)

From `gaps`:
- `gaps[]` lists uncovered categories (`kind`: `uncovered-category` or `checklist-gap`)
- `projectCategories` vs `coveredCategories` shows what's missing
- Each gap may include `evidence[]` with project-specific `packageName`, `specifier`, `file`, and `example` — use this first when creating skills

Checklist key by scope:
- Default (technical) → `--checklist frontend` for React/Next; omit `--checklist` if stack is unknown and rely on `uncovered-category` gaps.
- `WEBSITE_SCOPE=yes` only → also use `--checklist website`.

The `website` checklist covers Website Specification domains (`foundations`, `seo`, `accessibility`, `security`, `performance`, `privacy`, `resilience`, `i18n`, `agent-readiness`). These are not npm-package categories — a skill covers a domain by declaring it in a `categories:` frontmatter list:

```yaml
---
name: my-a11y-skill
categories:
  - accessibility
---
```

The bundled `templates/website-*` skills already do this. When `WEBSITE_SCOPE=yes`, the static compliance scan (`spec-check`, run in Step 2) reports what the repo itself implements (doctype, robots.txt, security headers, custom 404, llms.txt). Each item is `pass` / `fail` / `skip`; `skip` means it needs a live URL or runtime audit (HTTPS, Core Web Vitals, contrast). Skip this entirely in default scope.

## Step 3 — Fix existing stale skills

For each result where `score.overall < 70` or critical findings exist:

1. Read `suggestions` — each maps a finding to a concrete fix
2. Edit the skill's `SKILL.md`: rewrite the affected sections around the repo's actual stack. Rewriting means a working example plus the prose explaining when and why — not a package-name swap
3. Use packages/imports from `scan` output, not generic examples. Demonstrate APIs the repo actually imports (`unverified-api` findings list what the repo really uses)
4. Re-run `skill-auditor audit <skillDir> --project $PROJECT --json` and confirm each finding you addressed is gone. Stop when findings are resolved — do not keep tweaking to squeeze out points

Do not inject fake imports into neutral/behavioral skills just to raise alignment. Do not pad skills with extra references: unused imports, name-drops without examples, and dependency-list dumps are detected as `metric-stuffing` and cap the score at 60.

## Step 4 — Create gap skills

For each entry in `gaps.gaps`:

1. Read `category` (e.g. `state`, `routing`, `testing`)
2. Read `evidence[]` when present — these are canonical repo examples with file paths
3. Fall back to `scan` output (`declaredDeps` + `usedImports`) only when `evidence` is empty
4. Pick import specifiers the repo actually uses (prefer `evidence[].specifier`, then `usedImports`)
5. Create one skill dir per gap category:

```
$SKILLS_ROOT/<category>/
└── SKILL.md
```

### Gap skill template (maximally filled)

Every generated gap skill must be complete and best-practice-carrying, not a stub. Fill every section from real repo evidence.

```markdown
---
name: <project>-<category>
description: <Category> patterns for this project using <actual-package>. Use when working with <category>, routing, navigation, or related tasks in this codebase.
categories:
  - <category>   # only for website-domain gaps (accessibility, seo, etc.)
---

# <Category>

This project uses `<actual-package>` for <category>.

## When to use

- User asks to add/change <category> behavior in this repo
- Editing files listed in **Files to inspect**
- Adding imports from `<actual-specifier>`

## Project setup

- Package: `<actual-package>` (`declaredDeps["<actual-package>"]` from scan)
- Import specifiers in use: `<specifier-1>`, `<specifier-2>` (from `evidence[]` or `usedImports`)
- Config files: list any related config paths found in the repo (e.g. `tailwind.config.ts`, `vitest.config.ts`)

## Files to inspect

Canonical examples from `gaps[].evidence[].file`:

- `<path/from/evidence-1>`
- `<path/from/evidence-2>`

## Patterns

Adapt from `evidence[].example`. Use 2–3 blocks when evidence provides enough material.

```tsx
// from <evidence-file>
import { ... } from '<actual-specifier>'
...
```

## Best practices

Pick bullets for the gap's `category` from the map below. Keep only items relevant to the actual package.

## Anti-patterns

- Do not use APIs/imports absent from `usedImports`
- Do not copy generic examples from other projects
- Include deprecated-API warnings when audit flagged them (e.g. `next/router` when repo uses `next/navigation`)

## Conventions

- Note directory layout from evidence file paths (e.g. stores under `src/stores/`, routes under `app/`)
- Match naming patterns seen in those files
```

Rules for new gap skills:
- `name`: lowercase, hyphens, max 64 chars
- `description`: third person, WHAT + WHEN, include trigger terms
- Every code block uses an import specifier from `usedImports` (no invented APIs), and every import's bindings must be used in the snippet — idle import lines count as metric stuffing
- Keep under 500 lines; one category per skill (skills spanning 3+ categories lose focus score)
- Use forward-slash paths only
- If a section has no repo evidence, write a short planning note instead of fabricating code

If scan shows no package for a checklist gap (e.g. project lacks `testing` deps), either skip that gap and tell the user, or create a minimal planning skill without fake imports.

### Category best-practices map

Select bullets matching the gap's `category` and actual package:

**routing**
- Prefer App Router (`next/navigation`) when repo imports it; avoid Pages Router APIs
- Use `<Link>` for internal navigation; reserve `useRouter().push()` for imperative redirects
- Keep route segments aligned with `app/` directory layout

**state**
- Zustand: use selectors (`useStore(s => s.field)`) to limit re-renders; avoid subscribing to whole store
- Redux/RTK: colocate slices; use typed hooks; avoid mutating state outside reducers
- Keep store modules in a consistent directory (follow evidence file paths)

**data-fetching**
- React Query: stable `queryKey` arrays; handle `isLoading` / `isError`; prefer server prefetch in App Router when applicable
- SWR: consistent cache keys; revalidate on focus only when appropriate
- Do not fetch in every child — lift to layout/page or shared hook

**validation**
- Define schemas once; infer types with `z.infer<typeof Schema>`
- Validate at boundaries (forms, API handlers, env parsing)
- Reuse schemas between client and server when the repo already does

**styling**
- Tailwind: prefer utility classes; extract repeated patterns to components, not `@apply` sprawl
- CSS-in-JS: keep styles colocated; avoid dynamic class injection without memoization
- Follow existing token/theme files if present

**testing**
- Prefer `@testing-library/react` queries by role/label over test IDs
- One behavior per test; mock at network/module boundary, not internal implementation
- Mirror source file layout in test directories when the repo already does

**forms**
- React Hook Form: register inputs via `control`/`register`; validate with repo's schema lib
- Keep default values typed; avoid uncontrolled→controlled flicker

**orm-db**
- Use the repo's query layer (Drizzle/Prisma/Kysely) consistently — do not mix ORMs
- Keep migrations and schema definitions in existing project locations

## Step 5 — Verify loop

```bash
skill-auditor gaps $SKILLS_ROOT --project $PROJECT --checklist frontend --json
skill-auditor audit $SKILLS_ROOT --project $PROJECT --json
```

When `WEBSITE_SCOPE=yes`, also re-check website coverage and compliance:

```bash
skill-auditor gaps $SKILLS_ROOT --project $PROJECT --checklist website --json
skill-auditor spec-check $PROJECT --json
```

Repeat Step 3–5 until:
- `gaps.gaps` is empty (or only intentional skips remain)
- No skill has critical findings
- Technical skills score ≥ 70 where applicable
- (website scope only) no unresolved `fail` items in `spec-check` required priority

Report final summary to user:

```
Scope: technical only | technical + website
Skills audited: N
Created: [list new skill dirs]
Fixed: [list updated skills + score delta]
Remaining gaps: [list or "none"]
```

## Category → package hints

When scan lists multiple packages in one category, prefer the one with entries in `usedImports`:

| Category | Common packages |
|----------|-----------------|
| routing | `next`, `react-router-dom`, `@tanstack/react-router` |
| state | `zustand`, `redux`, `@reduxjs/toolkit`, `jotai` |
| data-fetching | `@tanstack/react-query`, `swr`, `@apollo/client` |
| validation | `zod`, `yup`, `valibot` |
| styling | `tailwindcss`, `styled-components`, `@emotion/react` |
| testing | `vitest`, `jest`, `@testing-library/react`, `playwright` |
| forms | `react-hook-form`, `formik` |
| orm-db | `drizzle-orm`, `prisma`, `kysely` |

Always prefer repo scan over this table.

## Anti-patterns

- Do not copy generic stack from another project
- Do not use Pages Router APIs (`getServerSideProps`, `next/router`) when scan shows `next/navigation`
- Do not create one mega-skill covering all gaps — one category per skill
- Do not modify `~/.cursor/skills-cursor/` (Cursor built-in skills)
- Do not optimize the score directly: no name-dropping packages without examples, no unused import lines, no pasting the dependency list, no adding references the skill doesn't explain. These are detected and cap the score
- Do not read the skill-auditor source or dist to find scoring shortcuts — work only from findings and suggestions
