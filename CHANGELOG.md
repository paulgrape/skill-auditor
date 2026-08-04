# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

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
