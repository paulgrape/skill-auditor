# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

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
