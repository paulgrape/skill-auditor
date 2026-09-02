#!/usr/bin/env node
import { Command } from 'commander'
import { buildDocs } from './docs.js'
import {
  defaultSkillRoots,
  findSkillDirs,
  resolveSkillPath,
} from './discoverSkills.js'
import { envelope, setAwareReplacer } from './envelope.js'
import { requireChecklist } from './gaps.js'
import { runMcpServer } from './mcp.js'
import { buildRepoReality } from './repoReality.js'
import {
  auditReport,
  auditSkillsSafely,
  gapsReport,
  scanReport,
  type AuditError,
  type AuditResult,
} from './reports.js'
import { extractSkillIdentifiers } from './skillIdentifiers.js'
import { runSpecCompliance } from './specCompliance.js'
import { MUST_HAVE_CHECKLISTS } from './taxonomy.js'
import type {
  AlignmentReport,
  DriftSeverity,
  SkillScore,
  SkillSuggestion,
  SpecPriority,
} from './types.js'
import { readPackageVersion } from './version.js'

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, setAwareReplacer, 2) + '\n')
}

const SEVERITY_ORDER: Record<DriftSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
}

function formatScoreBlock(score: SkillScore): string[] {
  const lines: string[] = []
  lines.push(`Kind:      ${score.kind}`)

  if (score.overall === null) {
    lines.push('Alignment: N/A (neutral skill — no technical references)')
    lines.push(
      `Quality:   ${score.intrinsicQuality}/100 (${score.intrinsicGrade})`,
    )
  } else {
    lines.push(`Score:     ${score.overall}/100 (${score.grade})`)
    lines.push(
      `  alignment:   ${Math.round((score.breakdown.alignment ?? 0) * 100)}%`,
    )
    lines.push(
      `  specificity: ${Math.round((score.breakdown.specificity ?? 0) * 100)}%`,
    )
    lines.push(`  freshness:   ${Math.round(score.breakdown.freshness * 100)}%`)
    lines.push(
      `  focus:       ${Math.round((score.breakdown.focus ?? 0) * 100)}%`,
    )
    lines.push(
      `Quality:   ${score.intrinsicQuality}/100 (${score.intrinsicGrade})`,
    )
  }

  return lines
}

function formatReport(
  report: AlignmentReport,
  score: SkillScore,
  suggestions: SkillSuggestion[],
): string[] {
  const lines: string[] = []
  lines.push(`Skill:     ${report.skillName}`)
  lines.push(`Path:      ${report.skillPath}`)
  lines.push(...formatScoreBlock(score))
  lines.push('')

  if (report.findings.length === 0) {
    lines.push('No findings. Skill aligns with the project.')
  } else {
    lines.push(`Findings (${report.findings.length}):`)
    const ordered = [...report.findings].sort(
      (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
    )
    for (const f of ordered) {
      lines.push(`  [${f.severity.toUpperCase()}] ${f.kind}: ${f.message}`)
      lines.push(`      skill: ${f.skillReference}`)
      if (f.repoReality) lines.push(`      repo:  ${f.repoReality}`)
    }
  }

  if (suggestions.length > 0) {
    lines.push('')
    lines.push('Suggestions:')
    for (const s of suggestions) {
      lines.push(`  - ${s.suggestion}`)
    }
  }

  return lines
}

function printAuditResults(
  results: AuditResult[],
  errors: AuditError[],
  opts: { json?: boolean },
): void {
  if (opts.json) {
    printJson(auditReport(results, errors))
  } else if (results.length === 0 && errors.length === 0) {
    process.stdout.write('No skills found.\n')
  } else {
    for (const r of results) {
      process.stdout.write(
        formatReport(r.report, r.score, r.suggestions).join('\n') + '\n\n',
      )
    }
  }

  // Unreadable skills are reported on stderr in both modes: the JSON payload
  // already carries them, and a human reading text output must not mistake a
  // skipped skill for a passing one.
  for (const e of errors) {
    process.stderr.write(`Could not audit ${e.skillDir}: ${e.error}\n`)
  }
}

function auditFailed(results: AuditResult[], failOn: DriftSeverity): boolean {
  const threshold = SEVERITY_ORDER[failOn]
  return results.some(r =>
    r.report.findings.some(f => SEVERITY_ORDER[f.severity] >= threshold),
  )
}

/**
 * Shared tail of `audit` and `audit-all`: print, apply the CI gates, exit.
 * An unreadable skill fails the run — an audit that could not audit
 * something must not report green.
 */
function finishAudit(
  results: AuditResult[],
  errors: AuditError[],
  failOn: DriftSeverity,
  minScore: number | undefined,
  json: boolean,
): never {
  printAuditResults(results, errors, { json })

  const underMin = belowMinScore(results, minScore)
  if (minScore !== undefined) {
    reportMinScoreFailures(underMin, minScore, json)
  }
  const failed =
    auditFailed(results, failOn) || underMin.length > 0 || errors.length > 0
  process.exit(failed ? 1 : 0)
}

/** Parses `--fail-on`, exiting with code 2 on an unknown severity. */
function parseFailOn(raw: string): DriftSeverity {
  if (!(raw in SEVERITY_ORDER)) {
    process.stderr.write(
      `Invalid --fail-on "${raw}". Use info, warning, or critical.\n`,
    )
    process.exit(2)
  }
  return raw as DriftSeverity
}

/** Validates `--checklist`, exiting with code 2 on an unknown key. */
function parseChecklist(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  try {
    requireChecklist(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Invalid --checklist: ${message}\n`)
    process.exit(2)
  }
  return raw
}

/**
 * Parses `--min-score`, exiting with code 2 on anything unusable so a typo in
 * a CI config fails loudly instead of silently disabling the gate.
 */
function parseMinScore(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    process.stderr.write(
      `Invalid --min-score "${raw}". Expected a number between 0 and 100.\n`,
    )
    process.exit(2)
  }
  return value
}

/** Scored skills below the threshold. Neutral skills have no score to gate on. */
function belowMinScore(
  results: AuditResult[],
  minScore: number | undefined,
): AuditResult[] {
  if (minScore === undefined) return []
  return results.filter(
    r => r.score.overall !== null && r.score.overall < minScore,
  )
}

function reportMinScoreFailures(
  failures: AuditResult[],
  minScore: number,
  json: boolean,
): void {
  if (failures.length === 0 || json) return
  process.stderr.write(
    `${failures.length} skill(s) below the --min-score threshold of ${minScore}:\n`,
  )
  for (const r of failures) {
    process.stderr.write(
      `  ${r.report.skillName} (${r.score.overall}/100) — ${r.report.skillPath}\n`,
    )
  }
}

function resolveRoots(
  userRoots: string[],
  opts: { defaults?: boolean; project?: string },
): string[] {
  if (!opts.defaults) return userRoots
  const base = opts.project ?? '.'
  return [...userRoots, ...defaultSkillRoots(base)]
}

const program = new Command()

program
  .name('skill-auditor')
  .description(
    'Audit imported Agent Skills against the reality of this project.',
  )
  .version(readPackageVersion(), '-v, --version', 'print version and exit')
  .addHelpText(
    'after',
    '\nEvery --json payload carries a schemaVersion. Run `skill-auditor docs` for the full machine-readable contract.',
  )

program
  .command('scan')
  .argument('[path]', 'project root to scan', '.')
  .option('--json', 'emit machine-readable JSON (scan output is always JSON)')
  .description('Print the RepoReality (declared deps + used imports) as JSON')
  .action((path: string) => {
    printJson(scanReport(path))
  })

program
  .command('extract')
  .argument('<skillDir>', 'directory containing SKILL.md')
  .description('Print the SkillIdentifiers extracted from a skill as JSON')
  .action((skillDir: string) => {
    printJson(envelope(extractSkillIdentifiers(skillDir)))
  })

program
  .command('audit')
  .argument(
    '<path>',
    'skill directory or skills root (scans nested SKILL.md recursively)',
  )
  .option('-p, --project <path>', 'project root to audit against', '.')
  .option(
    '-f, --fail-on <severity>',
    'exit non-zero if a finding at/above this severity exists (info|warning|critical)',
    'critical',
  )
  .option(
    '-m, --min-score <n>',
    'exit non-zero if any scored skill is below this 0-100 threshold',
  )
  .option('--json', 'emit machine-readable JSON (score, findings, suggestions)')
  .description('Audit a skill or all skills under a root against the project')
  .action(
    (
      inputPath: string,
      opts: {
        project: string
        failOn: string
        minScore?: string
        json?: boolean
      },
    ) => {
      const failOn = parseFailOn(opts.failOn)
      const minScore = parseMinScore(opts.minScore)

      const repo = buildRepoReality(opts.project)
      const skillDirs = resolveSkillPath(inputPath)
      const { results, errors } = auditSkillsSafely(repo, skillDirs)
      finishAudit(results, errors, failOn, minScore, Boolean(opts.json))
    },
  )

program
  .command('list')
  .argument('[roots...]', 'skill roots to scan (default: .)', ['.'])
  .option(
    '-d, --defaults',
    'also scan well-known project-local skill roots (.cursor/.claude/.agents/.codex)',
  )
  .option('--json', 'emit machine-readable JSON')
  .description('List all skill directories (recursive SKILL.md discovery)')
  .action((roots: string[], opts: { defaults?: boolean; json?: boolean }) => {
    const skillDirs = findSkillDirs(resolveRoots(roots, opts))
    if (opts.json) {
      printJson(envelope({ skillDirs, count: skillDirs.length }))
    } else {
      if (skillDirs.length === 0) {
        process.stdout.write('No skills found.\n')
      } else {
        process.stdout.write(`Found ${skillDirs.length} skill(s):\n`)
        for (const dir of skillDirs) {
          process.stdout.write(`  ${dir}\n`)
        }
      }
    }
  })

program
  .command('audit-all')
  .argument('[roots...]', 'skill roots to scan (default: .)', ['.'])
  .option('-p, --project <path>', 'project root to audit against', '.')
  .option(
    '-d, --defaults',
    'also scan well-known project-local skill roots (.cursor/.claude/.agents/.codex)',
  )
  .option(
    '-f, --fail-on <severity>',
    'exit non-zero if a finding at/above this severity exists (info|warning|critical)',
    'critical',
  )
  .option(
    '-m, --min-score <n>',
    'exit non-zero if any scored skill is below this 0-100 threshold',
  )
  .option('--json', 'emit machine-readable JSON')
  .description('Audit every skill found under the given roots')
  .action(
    (
      roots: string[],
      opts: {
        project: string
        defaults?: boolean
        failOn: string
        minScore?: string
        json?: boolean
      },
    ) => {
      const failOn = parseFailOn(opts.failOn)
      const minScore = parseMinScore(opts.minScore)

      const repo = buildRepoReality(opts.project)
      const skillDirs = findSkillDirs(resolveRoots(roots, opts))
      const { results, errors } = auditSkillsSafely(repo, skillDirs)
      finishAudit(results, errors, failOn, minScore, Boolean(opts.json))
    },
  )

program
  .command('gaps')
  .argument('[roots...]', 'skill roots to scan recursively (default: .)', ['.'])
  .option('-p, --project <path>', 'project root to analyze', '.')
  .option(
    '-d, --defaults',
    'also scan well-known project-local skill roots (.cursor/.claude/.agents/.codex)',
  )
  .option(
    '-c, --checklist <key>',
    `must-have checklist key (${Object.keys(MUST_HAVE_CHECKLISTS).join('|')})`,
  )
  .option('--fail-on-gap', 'exit non-zero when any gap is found (CI-friendly)')
  .option('--json', 'emit machine-readable JSON')
  .description('Detect uncovered stack categories and checklist gaps')
  .action(
    (
      roots: string[],
      opts: {
        project: string
        defaults?: boolean
        checklist?: string
        failOnGap?: boolean
        json?: boolean
      },
    ) => {
      const checklist = parseChecklist(opts.checklist)
      const gapReport = gapsReport(
        resolveRoots(roots, opts),
        opts.project,
        checklist,
      )
      const skillDirs = gapReport.skillDirs

      if (opts.json) {
        printJson(gapReport)
      } else {
        const lines: string[] = []
        lines.push(`Skills scanned (${skillDirs.length}):`)
        for (const dir of skillDirs) lines.push(`  ${dir}`)
        lines.push('')
        lines.push(
          `Project categories: ${gapReport.projectCategories.join(', ') || '(none)'}`,
        )
        lines.push(
          `Covered by skills:    ${gapReport.coveredCategories.join(', ') || '(none)'}`,
        )
        lines.push('')

        if (gapReport.gaps.length === 0) {
          lines.push('No gaps found.')
        } else {
          lines.push(`Gaps (${gapReport.gaps.length}):`)
          for (const g of gapReport.gaps) {
            lines.push(`  [${g.kind}] ${g.category}: ${g.message}`)
            lines.push(`      -> ${g.recommendation}`)
            if (g.evidence && g.evidence.length > 0) {
              const files = [...new Set(g.evidence.map(e => e.file))]
              lines.push(`      files: ${files.join(', ')}`)
              const firstExample = g.evidence.find(e => e.example)?.example
              if (firstExample) lines.push(`      example: ${firstExample}`)
            }
          }
        }

        process.stdout.write(lines.join('\n') + '\n')
      }

      if (opts.failOnGap && gapReport.gaps.length > 0) {
        process.exit(1)
      }
    },
  )

const SPEC_PRIORITIES: SpecPriority[] = [
  'required',
  'recommended',
  'optional',
  'avoid',
]

const STATUS_MARK: Record<string, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
}

program
  .command('spec-check')
  .argument('[path]', 'project root to analyze (same as --project)')
  .option('-p, --project <path>', 'project root to analyze', '.')
  .option(
    '-P, --priority <level>',
    `only report items of this priority (${SPEC_PRIORITIES.join(', ')})`,
  )
  .option('--json', 'emit machine-readable JSON')
  .description(
    'Statically check the project against the Website Specification (specification.website)',
  )
  .action(
    (
      inputPath: string | undefined,
      opts: { project: string; priority?: string; json?: boolean },
    ) => {
      if (
        opts.priority &&
        !SPEC_PRIORITIES.includes(opts.priority as SpecPriority)
      ) {
        process.stderr.write(
          `Invalid --priority "${opts.priority}". Expected one of: ${SPEC_PRIORITIES.join(', ')}\n`,
        )
        process.exit(2)
      }

      const report = runSpecCompliance(
        inputPath ?? opts.project,
        opts.priority as SpecPriority | undefined,
      )

      if (opts.json) {
        printJson(envelope(report))
        process.exit(report.summary.fail > 0 ? 1 : 0)
      }

      const lines: string[] = []
      lines.push(
        `Website Specification check (${report.findings.length} items)`,
      )
      lines.push(
        `  pass: ${report.summary.pass}  fail: ${report.summary.fail}  skip: ${report.summary.skip}`,
      )
      lines.push('')

      let currentCategory = ''
      for (const f of report.findings) {
        if (f.category !== currentCategory) {
          currentCategory = f.category
          lines.push(`${currentCategory}:`)
        }
        lines.push(`  [${STATUS_MARK[f.status]}] ${f.id} — ${f.message}`)
        if (f.files.length > 0) {
          lines.push(`         ${f.files.join(', ')}`)
        }
      }

      process.stdout.write(lines.join('\n') + '\n')
      process.exit(report.summary.fail > 0 ? 1 : 0)
    },
  )

program
  .command('docs')
  .option('--json', 'emit machine-readable JSON (docs output is always JSON)')
  .description(
    'Print the machine-readable CLI contract: commands, flags, output shapes, exit codes',
  )
  .action(() => {
    printJson(buildDocs(program, readPackageVersion()))
  })

program
  .command('mcp')
  .description(
    'Run as an MCP server over stdio, exposing audit, gaps and scan as tools',
  )
  .action(() => {
    runMcpServer()
  })

try {
  program.parse(process.argv)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`Error: ${message}\n`)
  process.exit(1)
}
