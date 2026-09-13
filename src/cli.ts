#!/usr/bin/env node
import { Command } from 'commander'
import { compareAudits, formatComparisonText, readAuditPayload } from './compare.js'
import { prepareProject } from './config.js'
import {
  defaultSkillRoots,
  findSkillDirs,
  resolveSkillPath,
} from './discoverSkills.js'
import { buildDocs } from './docs.js'
import { envelope, setAwareReplacer } from './envelope.js'
import {
  AUDIT_FORMATS,
  formatAuditMarkdown,
  formatAuditSarif,
  formatAuditText,
  SEVERITY_ORDER,
  type AuditFormat,
} from './formats.js'
import { requireChecklist } from './gaps.js'
import { runMcpServer } from './mcp.js'
import { buildRepoReality } from './repoReality.js'
import {
  auditReport,
  auditSkillsSafely,
  gapsReport,
  scanReport,
  validateReport,
  type AuditError,
  type AuditResult,
} from './reports.js'
import { scaffoldSkill } from './scaffold.js'
import { extractSkillIdentifiers } from './skillIdentifiers.js'
import { runSpecCompliance } from './specCompliance.js'
import { MUST_HAVE_CHECKLISTS } from './taxonomy.js'
import type { DriftSeverity, SpecPriority } from './types.js'
import { validateSkills } from './validate.js'
import { readPackageVersion } from './version.js'

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, setAwareReplacer, 2) + '\n')
}

function failUsage(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

function failConfig(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`Invalid project config: ${message}\n`)
  process.exit(2)
}

function loadProject(projectRoot: string) {
  try {
    return prepareProject(projectRoot)
  } catch (err) {
    failConfig(err)
  }
}

function cacheOption(noCache: boolean | undefined): { cache?: boolean } {
  return noCache ? { cache: false } : {}
}

function parseFailOn(raw: string): DriftSeverity {
  if (!(raw in SEVERITY_ORDER)) {
    failUsage(`Invalid --fail-on "${raw}". Use info, warning, or critical.`)
  }
  return raw as DriftSeverity
}

function parseChecklist(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  try {
    requireChecklist(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failUsage(`Invalid --checklist: ${message}`)
  }
  return raw
}

function parseMinScore(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    failUsage(
      `Invalid --min-score "${raw}". Expected a number between 0 and 100.`,
    )
  }
  return value
}

function resolveFormat(opts: {
  format?: string
  json?: boolean
}): AuditFormat {
  if (opts.format) {
    if (!(AUDIT_FORMATS as readonly string[]).includes(opts.format)) {
      failUsage(
        `Invalid --format "${opts.format}". Expected one of: ${AUDIT_FORMATS.join(', ')}`,
      )
    }
    return opts.format as AuditFormat
  }
  return opts.json ? 'json' : 'text'
}

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

function auditFailed(results: AuditResult[], failOn: DriftSeverity): boolean {
  const threshold = SEVERITY_ORDER[failOn]
  return results.some(r =>
    r.report.findings.some(f => SEVERITY_ORDER[f.severity] >= threshold),
  )
}

function finishAudit(
  results: AuditResult[],
  errors: AuditError[],
  opts: {
    failOn: DriftSeverity
    minScore: number | undefined
    format: AuditFormat
    comparison?: ReturnType<typeof compareAudits>
    failOnRegression?: boolean
  },
): never {
  const extras = opts.comparison ? { comparison: opts.comparison } : {}
  if (opts.format === 'json') {
    printJson(auditReport(results, errors, extras))
  } else if (opts.format === 'markdown') {
    process.stdout.write(
      formatAuditMarkdown(results, errors, opts.comparison),
    )
  } else if (opts.format === 'sarif') {
    process.stdout.write(
      formatAuditSarif(results, errors, readPackageVersion()),
    )
  } else {
    process.stdout.write(formatAuditText(results, errors, opts.comparison))
  }

  for (const e of errors) {
    process.stderr.write(`Could not audit ${e.skillDir}: ${e.error}\n`)
  }

  const underMin = belowMinScore(results, opts.minScore)
  if (opts.minScore !== undefined) {
    reportMinScoreFailures(underMin, opts.minScore, opts.format === 'json')
  }
  const regression =
    Boolean(opts.failOnRegression) && (opts.comparison?.summary.regressed ?? 0) > 0
  const failed =
    auditFailed(results, opts.failOn) ||
    underMin.length > 0 ||
    errors.length > 0 ||
    regression
  process.exit(failed ? 1 : 0)
}

function resolveRoots(
  userRoots: string[],
  opts: { defaults?: boolean; project?: string },
): string[] {
  if (!opts.defaults) return userRoots
  const base = opts.project ?? '.'
  return [...userRoots, ...defaultSkillRoots(base)]
}

function addAuditFormatOptions(command: Command): Command {
  return command
    .option('--json', 'shorthand for --format json')
    .option(
      '--format <fmt>',
      `output format (${AUDIT_FORMATS.join('|')})`,
    )
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
  .option('--no-cache', 'rebuild RepoReality even when the fingerprint matches')
  .description('Print the RepoReality (declared deps + used imports) as JSON')
  .action((path: string, opts: { cache?: boolean }) => {
    loadProject(path)
    printJson(scanReport(path, cacheOption(opts.cache === false)))
  })

program
  .command('extract')
  .argument('<skillDir>', 'directory containing SKILL.md')
  .description('Print the SkillIdentifiers extracted from a skill as JSON')
  .action((skillDir: string) => {
    printJson(envelope(extractSkillIdentifiers(skillDir)))
  })

function auditAction(
  skillDirs: string[],
  opts: {
    project: string
    failOn: string
    minScore?: string
    json?: boolean
    format?: string
    baseline?: string
    failOnRegression?: boolean
    cache?: boolean
  },
): never {
  const failOn = parseFailOn(opts.failOn)
  const minScore = parseMinScore(opts.minScore)
  const format = resolveFormat(opts)
  loadProject(opts.project)
  const repo = buildRepoReality(opts.project, cacheOption(opts.cache === false))
  const { results, errors } = auditSkillsSafely(repo, skillDirs)
  let comparison
  if (opts.baseline) {
    try {
      comparison = compareAudits(readAuditPayload(opts.baseline), results)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      process.stderr.write(`${message}\n`)
      process.exit(1)
    }
  }
  finishAudit(results, errors, {
    failOn,
    minScore,
    format,
    comparison,
    failOnRegression: opts.failOnRegression,
  })
}

addAuditFormatOptions(
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
    .option('--baseline <file>', 'diff this run against a saved audit --json payload')
    .option(
      '--fail-on-regression',
      'exit non-zero when --baseline reports a regressed skill',
    )
    .option('--no-cache', 'rebuild RepoReality even when the fingerprint matches')
    .description('Audit a skill or all skills under a root against the project'),
).action((inputPath: string, opts) => {
  auditAction(resolveSkillPath(inputPath), opts)
})

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
    } else if (skillDirs.length === 0) {
      process.stdout.write('No skills found.\n')
    } else {
      process.stdout.write(`Found ${skillDirs.length} skill(s):\n`)
      for (const dir of skillDirs) process.stdout.write(`  ${dir}\n`)
    }
  })

addAuditFormatOptions(
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
    .option('--baseline <file>', 'diff this run against a saved audit --json payload')
    .option(
      '--fail-on-regression',
      'exit non-zero when --baseline reports a regressed skill',
    )
    .option('--no-cache', 'rebuild RepoReality even when the fingerprint matches')
    .description('Audit every skill found under the given roots'),
).action((roots: string[], opts) => {
  auditAction(findSkillDirs(resolveRoots(roots, opts)), opts)
})

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
  .option('--no-cache', 'rebuild RepoReality even when the fingerprint matches')
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
        cache?: boolean
      },
    ) => {
      loadProject(opts.project)
      const checklist = parseChecklist(opts.checklist)
      const gapReport = gapsReport(
        resolveRoots(roots, opts),
        opts.project,
        checklist,
        cacheOption(opts.cache === false),
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

      if (opts.failOnGap && gapReport.gaps.length > 0) process.exit(1)
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
        failUsage(
          `Invalid --priority "${opts.priority}". Expected one of: ${SPEC_PRIORITIES.join(', ')}`,
        )
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
      lines.push(`Website Specification check (${report.findings.length} items)`)
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
        if (f.files.length > 0) lines.push(`         ${f.files.join(', ')}`)
      }
      process.stdout.write(lines.join('\n') + '\n')
      process.exit(report.summary.fail > 0 ? 1 : 0)
    },
  )

program
  .command('validate')
  .argument(
    '[path]',
    'skill directory or skills root (scans nested SKILL.md recursively)',
    '.',
  )
  .option('--json', 'emit machine-readable JSON')
  .description(
    'Lint SKILL.md files against the Agent Skills specification (name, description, frontmatter, body length)',
  )
  .action((inputPath: string, opts: { json?: boolean }) => {
    const results = validateSkills(resolveSkillPath(inputPath))
    const payload = validateReport(results)
    if (opts.json) {
      printJson(payload)
    } else {
      const lines: string[] = []
      for (const r of results) {
        lines.push(`${r.valid ? 'VALID' : 'INVALID'}  ${r.skillName}  ${r.skillDir}`)
        for (const v of r.violations) {
          lines.push(`  [${v.severity}] ${v.rule}: ${v.message}`)
        }
      }
      if (results.length === 0) lines.push('No skills found.')
      process.stdout.write(lines.join('\n') + '\n')
    }
    process.exit(payload.valid ? 0 : 1)
  })

program
  .command('scaffold')
  .argument('<category>', 'taxonomy category or website-domain to generate a skill for')
  .option('-p, --project <path>', 'project root to take evidence from', '.')
  .option('-o, --out <dir>', 'directory to write the skill into', '.')
  .option('--name <name>', 'skill directory name (defaults to the category)')
  .option('--force', 'overwrite an existing SKILL.md')
  .option('--dry-run', 'print the generated SKILL.md without writing it')
  .option('--json', 'emit machine-readable JSON')
  .option('--no-cache', 'rebuild RepoReality even when the fingerprint matches')
  .description(
    'Generate a SKILL.md for one category from the project\'s real import evidence',
  )
  .action(
    (
      category: string,
      opts: {
        project: string
        out: string
        name?: string
        force?: boolean
        dryRun?: boolean
        json?: boolean
        cache?: boolean
      },
    ) => {
      loadProject(opts.project)
      const repo = buildRepoReality(
        opts.project,
        cacheOption(opts.cache === false),
      )
      const result = scaffoldSkill({
        category,
        repo,
        outDir: opts.out,
        name: opts.name,
        force: opts.force,
        dryRun: opts.dryRun,
      })
      if (opts.json) {
        printJson(envelope(result))
      } else if (opts.dryRun) {
        process.stdout.write(result.contents)
        if (!result.contents.endsWith('\n')) process.stdout.write('\n')
      } else {
        process.stdout.write(`Wrote ${result.skillPath}\n`)
      }
    },
  )

program
  .command('compare')
  .argument('<before>', 'saved audit --json payload (the baseline)')
  .argument('<after>', 'saved audit --json payload (the current run)')
  .option('--json', 'emit machine-readable JSON')
  .option('--fail-on-regression', 'exit non-zero when any skill regressed')
  .description('Diff two audit --json payloads by skill name')
  .action(
    (
      before: string,
      after: string,
      opts: { json?: boolean; failOnRegression?: boolean },
    ) => {
      const comparison = compareAudits(
        readAuditPayload(before),
        readAuditPayload(after),
      )
      if (opts.json) printJson(envelope(comparison))
      else process.stdout.write(formatComparisonText(comparison).join('\n') + '\n')
      if (opts.failOnRegression && comparison.summary.regressed > 0) {
        process.exit(1)
      }
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
  .option(
    '--confine',
    'reject tool and resource paths that resolve outside the working directory',
  )
  .description(
    'Run as an MCP server over stdio, exposing audit, gaps, scan, validate, extract, spec-check, docs and scaffold as tools',
  )
  .action((opts: { confine?: boolean }) => {
    runMcpServer({ confine: Boolean(opts.confine) })
  })

try {
  program.parse(process.argv)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`Error: ${message}\n`)
  process.exit(1)
}