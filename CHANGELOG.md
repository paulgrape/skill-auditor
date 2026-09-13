# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## 1.4.0

Agent-facing additions: spec lint, deterministic gap scaffolding, finding
locations, a procedural skill kind, cached scans, project taxonomy config,
and extra MCP surface. `schemaVersion` stays at 1; new JSON fields are
additive.

### Added

- **`validate`** — lints `SKILL.md` against the Agent Skills spec (name
  format and directory match, description, unknown frontmatter fields,
  `metadata` value types, body length). Errors fail the command; warnings
  and info do not.
- **`scaffold <category>`** — writes a SKILL.md from the project's import
  evidence. `--dry-run` prints without writing. Categories go under
  `metadata.categories`, which the spec allows.
- **`compare <before> <after>`** and **`audit --baseline <file>`** — score
  and finding deltas between two `audit --json` payloads. `--fail-on-regression`
  is a CI gate.
- **`--format markdown|sarif`** on `audit` / `audit-all` (and `--json` still
  works). SARIF annotations land on the SKILL.md line a finding points at.
- **Finding `location: { line, heading }`** so an agent can edit the section
  that produced the finding.
- **`procedural` skill kind** — shell-workflow skills (bash fences, inline
  mentions, no JS/Python examples) are no longer alignment-scored.
- **`unscorable` info finding** when a scored skill is below 70 with no
  other findings, so the agent always has something to act on.
- **RepoReality cache** keyed on a fingerprint of every file the scan would
  read. Stored under `node_modules/.cache/skill-auditor/` or the OS temp
  dir; `--no-cache` or `SKILL_AUDITOR_NO_CACHE=1` bypasses it. The MCP
  server keeps an in-process copy per project.
- **`.skill-auditor.json`** (or a `"skill-auditor"` key in package.json) to
  extend taxonomy categories, checklists and ignore globs. Scoring
  thresholds are not configurable. Applied config is reported on `scan`.
- **MCP** tools `validate`, `extract`, `spec-check`, `docs`, `scaffold`;
  resources for `templates/*` and the bundled skill; an `audit-and-fix`
  prompt. `skill-auditor mcp --confine` rejects paths outside cwd.
- Taxonomy coverage for Vue/Svelte/Astro/Remix packages and extra
  deprecated-API rules (React Router v5/v7, `react-query` →
  `@tanstack/react-query`, redux `createStore` vs Toolkit). Tables live in
  `taxonomyData.ts` and `docs` prints them.

### Changed

- Website-domain coverage is declared as `metadata.categories: accessibility`
  (a string). A top-level `categories:` list is still read, and `validate`
  warns to move it. Bundled `templates/website-*` have been migrated.
- `scan --json` includes a `config` object. `extract --json` includes
  `locations` and `codeEvidence`. `docs` includes `taxonomy` and `config`.

## 1.3.1

Correctness fixes for what the extractor reads out of a skill, plus the CLI
gates that were silently doing nothing. Scores can move for skills whose code
blocks are CSS, HTML or shell (they now classify as neutral), and for skills
that rename their imports with `as`.

Note: `audit`/`audit-all` JSON gains an always-present `errors` array; the
result entries themselves are unchanged. `schemaVersion` stays at 1.

### Fixed

- **Non-JS code blocks no longer produce phantom technical references.** The
  JS import and API-call regexes ran over every fenced block regardless of its
  language tag, so `@media (` in a CSS example or `$(` in a shell snippet
  became "API calls". A skill made of nothing but CSS, HTML and shell was then
  scored as a technical skill with a 50% alignment prior, landing at an F with
  no findings and nothing for an agent to act on. Extraction is now keyed on
  the fence language: JS/TS-family tags (and untagged fences) get the JS
  rules, `python` fences get the Python import rule, everything else is prose.
  All bundled `templates/website-*` skills now classify as `neutral`.
- **Aliased imports verify correctly.** A skill importing
  `{ useRouter as useNav }` recorded `useNav` as the demonstrated identifier,
  while the repo scan records exported names, so the reference could never be
  verified and drew an `unverified-api` finding. The exported name is now
  recorded for verification; usage inside the snippet is still judged by the
  local alias.
- **Python standard-library imports are not packages.** `import os` in a
  `python` fence no longer counts as a package reference, matching how
  `node:fs` is already excluded on the JS side.
- **Identifier matching is safe for any name.** The usage check built a
  regular expression from the imported identifier while escaping only `$`, so
  other metacharacters could throw or match the wrong thing. Identifiers are
  now fully escaped and matched on identifier boundaries, which also fixes
  `$store`-style names that `\b` could not delimit.
- **`gaps` with no roots scans the working directory**, like `list` and
  `audit-all` already did. Previously it scanned nothing and reported every
  category as a gap.
- **Unknown `--checklist` keys exit `2`** with the valid keys listed, instead
  of being silently ignored — the same policy `--min-score` and `--fail-on`
  follow, so a typo cannot turn a CI gate into a no-op. The library's
  `detectGaps` throws for the same input; `requireChecklist` is exported.
- **One unreadable skill no longer aborts the whole audit.** `audit` and
  `audit-all` now audit every skill they can and report the rest in a new
  `errors: [{ skillDir, error }]` array (always present, empty on a clean
  run), also written to stderr as `Could not audit <dir>: <reason>`. An
  unreadable skill fails the run with exit `1`. Library consumers get the same
  behaviour from the new `auditSkillsSafely`; `auditSkills` still throws.
- The `gaps` fallback recommendation pointed at `skills/` for template
  examples; they have lived under `templates/` since 1.0.0.
- Bundled `references/*.md` files are read with the same section-aware pass
  as `SKILL.md` instead of having code regexes run over raw markdown; other
  bundled files are analysed by extension.

### Internal

- The ignore list for file walks (`node_modules`, `dist`, `build`, `.next`,
  `.turbo`, `coverage`, `.git`) lives in one module; skill discovery
  previously skipped fewer directories than the repo scan.
- Tests added for `--fail-on` and `--fail-on-gap` exit codes, the
  `freshness` dimension, non-JS fences, aliased imports, checklist
  validation, and the unreadable-skill path.

## 1.3.0

An agent-facing release: the JSON output is versioned and uniform, the audit is
importable as a library, the CLI describes itself, and the whole analysis is
available over the Model Context Protocol.

Note: `audit`/`audit-all` no longer change shape with the number of skills —
update any script that reads `report`/`score` off the top level.

### Added

- **MCP server** — `skill-auditor mcp` runs as a stdio Model Context Protocol
  server exposing `audit`, `gaps` and `scan` as read-only tools, so any
  MCP-capable agent can use the auditor without installing the bundled skill.
  Tool results carry the same JSON payloads as the CLI, as text and as
  `structuredContent`. The server is dependency-free and dual-era: it answers
  both the stateless `2026-07-28` revision (per-request protocol metadata,
  `server/discover`) and the older `initialize` handshake that most clients
  still open with.
- **Programmatic API** — the package now has an `exports` entry point.
  `buildRepoReality`, `extractSkillIdentifiers`, `buildAlignmentReport`,
  `scoreSkill`, `buildSuggestions`, `detectGaps` and `runSpecCompliance` are
  importable individually, `auditSkills` runs the whole pipeline over a set of
  skill directories, and the `*Report` helpers return the CLI's JSON payloads.
  Every result type is exported too. Deep imports into `dist/` are no longer
  part of the supported surface.
- **`docs` command** — `skill-auditor docs` prints the CLI contract as JSON:
  every command, argument, flag, output shape and exit code. It is generated
  from the command definitions themselves and tested against the real payloads,
  so an agent can discover the surface instead of trusting a possibly stale
  SKILL.md.

### Changed

- **Every `--json` payload now carries a `schemaVersion`.** It is bumped when a
  field is removed or changes meaning; added fields do not bump it. Read it
  before parsing and treat unknown fields as additive.
- **`audit` and `audit-all` always emit `{ schemaVersion, count, results }`.**
  Auditing a single skill previously returned a bare
  `{ report, score, suggestions }` object while a skills root returned a
  `results` array, so every consumer had to branch on the result count. Results
  now always include `skillDir`, single skill or not.

## 1.2.0

Correctness pass on what counts as a package and which category it belongs to,
plus a CI gate. Scores can move for skills that import Node builtins or path
aliases, reference multi-category packages, or keep their `name:`/
`description:` outside the frontmatter.

### Added

- **`--min-score <n>` on `audit` and `audit-all`** — exits non-zero when any
  scored skill falls below the threshold, and lists the offending skills and
  their scores on stderr. Neutral skills are ignored (they have no alignment
  score to gate on). Combines with `--fail-on`: either condition fails the run.
  An out-of-range or non-numeric value exits `2`, so a typo in a CI config
  fails loudly rather than silently disabling the gate.
- **Monorepo support** — `declaredDeps` now merges the dependencies of every
  workspace package, resolved from the root `package.json` `workspaces` field
  (array or `{ packages: [...] }`) or from `pnpm-workspace.yaml`. Previously a
  monorepo whose root manifest held only tooling looked like a project with no
  stack at all. Root declarations still win on conflict. Side effect: with more
  declared dependencies, the dependency-list-mirroring stuffing heuristic is
  correctly harder to trigger in a monorepo.

### Changed

- **Node builtins and path aliases are no longer treated as npm packages.**
  `node:fs`, bare `fs`/`path`/`crypto`, `#internal` subpath imports, and `@/…`
  and `~/…` tsconfig aliases were counted as package references on both sides
  of the audit, producing phantom `unused-reference` findings and inflating
  reference counts. They are now excluded from `scan`'s `usedImports` and from
  a skill's `packages` and `importSpecifiers`.
- **Packages can belong to more than one taxonomy category.** The reverse index
  was a `package -> category` map, so a package listed under two categories
  silently kept only the last one — `@reduxjs/toolkit` lost its `state`
  membership to `data-fetching`. It is now `package -> categories[]`, which
  affects `focus` (a multi-category package fills more of the two-category
  budget), conflict detection (a rival in any of its categories is a conflict),
  and `gaps` coverage. A package still counts as one reference and produces at
  most one finding, now naming every relevant category, e.g.
  `Skill uses "@reduxjs/toolkit" (state/data-fetching); …`.
- **Frontmatter is parsed, not pattern-matched.** A small dependency-free YAML
  reader replaces the regexes used for `name:` and `categories:`, so block
  scalars, quoted values, comments and the inline list form all work. Intrinsic
  quality now credits `name:` and `description:` only when they are real
  frontmatter keys — previously any such line anywhere in the document scored,
  including inside example blocks that describe some other skill.

### Internal

- Tests moved from a single hand-rolled script to `node:test` under `test/`,
  adding unit coverage for the scoring math, alignment findings, the
  frontmatter parser, specifier filtering and workspace dependency merging. The
  JSON helper no longer swallows stderr, so a CLI crash reports its own error
  instead of surfacing as a JSON parse failure.

## 1.1.1

### Fixed

- The bundled `skill-auditor` skill instructed commands the CLI rejected:
  `scan <path> --json` failed with `unknown option '--json'` and
  `spec-check <path> --json` with `too many arguments`. The CLI now accepts
  `--json` on `scan` (its output was always JSON) and an optional positional
  project path on `spec-check` (equivalent to `--project`).
- Removed a dead full-tree file scan: `RepoReality.fileExtensions` was
  computed by globbing every file in the project but never consumed. Scans
  are faster on large repos; the field is gone from `scan --json` output.

### Added

- Anti-drift test: every `skill-auditor` command documented in the bundled
  skill's SKILL.md is now executed against the built CLI in `npm test`, so
  the skill and the CLI can no longer drift apart silently.

## 1.1.0

Anti-gaming scoring redesign. The metric is open by design, so it is now built
so that maximizing it requires genuinely good, repo-grounded content — keyword
stuffing and reference padding no longer pay.

Note: scores and grades change for identical inputs, and the JSON breakdown
renames `coverage` to `focus` — update any scripts that parse it.

### Changed

- **Removed the per-skill `coverage` dimension** — rewarding one skill for
  touching many stack categories incentivized package stuffing and
  contradicted the "one category per skill" guidance. Portfolio coverage
  remains the `gaps` command's job. Replaced by **`focus`** (10%): skills
  staying within 1–2 taxonomy categories score full marks; spreading wider
  costs points. JSON schema: `score.breakdown.coverage` is now
  `score.breakdown.focus`.
- **Reweighted dimensions**: alignment 45%, specificity 25%, freshness 20%,
  focus 10% (was 40/30/20/10 with coverage).
- **Specificity now measures substantiated depth, not raw counts.** Only
  references matched to the repo count; each is weighted by how real it is —
  demonstrated usage (imports whose bindings are used in the snippet) counts
  fully, idle import lines count near zero, bare inline mentions count a
  quarter; references in sections without explanatory prose are halved; sqrt
  diminishing returns replace the linear count, so padding doesn't pay.
- **Zero scorable references no longer means perfect alignment.** Technical or
  mixed skills with nothing scorable get a neutral 0.5 prior instead of 1.0 —
  vague skills can't outscore specific-but-imperfect ones.
- Suggestions rewritten to demand substance: rewrite sections around the
  repo's real usage with working examples, instead of "replace X with Y"
  string swaps.

### Added

- **Repo API verification**: `scan` now records the identifiers the project
  actually imports from each package (`usedIdentifiers`). Skill examples that
  demonstrate those identifiers earn a verified-reference bonus
  (`report.verifiedPackages`); examples demonstrating APIs the project never
  uses produce a new `unverified-api` finding.
- **Metric-stuffing detection**: a new `metric-stuffing` finding (warning)
  caps `score.overall` at 60. Triggers: most references are bare name-drops
  with no examples, 3+ import statements with unused bindings, 4+ packages
  from the same category, or a skill that mirrors the project's dependency
  list wholesale.
- Substantiation metadata in `extract` output (`packageRefs`,
  `importedIdentifiers`, `unusedImportCount`).
- New test fixtures: `aligned-skill` (repo-grounded, scores A) and
  `stuffed-skill` (name-drop padding, capped and flagged).

### Skill guidance

- The bundled `skill-auditor` skill now opens with ground rules: fix findings
  substantively, never add references just to move the number, don't
  reverse-engineer the auditor source — findings and suggestions are the only
  intended interface, and gaming patterns are detected and capped.

## 1.0.0

Initial release.

### Added

- `audit`, `audit-all`, `gaps`, `spec-check`, `list`, `scan`, and `extract` commands.
- Scoring for technical, mixed, and neutral skills (alignment, coverage, freshness, specificity).
- Website Specification static compliance checks (`spec-check`).
- `--fail-on-gap` flag on `gaps` for CI use.
- `-v, --version` flag on the CLI.
- Bundled `skill-auditor` agent skill (installable via `npx skills add paulgrape/skill-auditor`).
- Reference templates under `templates/` (`frontend-must-have`, `website-*`).

### Changed

- Renamed the flagship skill from `audit-and-fill-gaps` to `skill-auditor`; it now invokes the CLI via `npx -y skill-auditor@latest`, requiring no global install.
- Moved reference/template skills out of `skills/` into `templates/` so only the `skill-auditor` skill is exposed to the `skills` CLI.

### Fixed

- Clean CLI error messages instead of raw stack traces on invalid input.
- Malformed project `package.json` no longer crashes a scan.
