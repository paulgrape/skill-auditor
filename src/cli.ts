#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { buildAlignmentReport } from './diff.js'
import {
  defaultSkillRoots,
  findSkillDirs,
  resolveSkillPath,
} from './discoverSkills.js'
import { detectGaps } from './gaps.js'
import { buildRepoReality } from './repoReality.js'
import { scoreSkill } from './score.js'
import { extractSkillIdentifiers } from './skillIdentifiers.js'
import { runSpecCompliance } from './specCompliance.js'
import { buildSuggestions } from './suggestions.js'
import type {
  AlignmentReport,
  DriftSeverity,
  SkillScore,
  SpecPriority,
} from './types.js'

/** JSON.stringify replacer that turns Sets into sorted arrays. */
function setAwareReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return [...value].sort()
  return value
}

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
      `  coverage:    ${Math.round((score.breakdown.coverage ?? 0) * 100)}%`,
    )
    lines.push(`  freshness:   ${Math.round(score.breakdown.freshness * 100)}%`)
    lines.push(
      `  specificity: ${Math.round((score.breakdown.specificity ?? 0) * 100)}%`,
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
  suggestions: ReturnType<typeof buildSuggestions>,
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

interface AuditResult {
  skillDir: string
  report: AlignmentReport
  score: SkillScore
  suggestions: ReturnType<typeof buildSuggestions>
}

function runAudits(
  repo: ReturnType<typeof buildRepoReality>,
  skillDirs: string[],
): AuditResult[] {
  return skillDirs.map(skillDir => {
    const skill = extractSkillIdentifiers(skillDir)
    const report = buildAlignmentReport(skill, repo)
    const score = scoreSkill(report, skill, repo)
    const suggestions = buildSuggestions(report.findings)
    return { skillDir, report, score, suggestions }
  })
}

function printAuditResults(
  results: AuditResult[],
  opts: { json?: boolean },
): void {
  if (opts.json) {
    if (results.length === 1) {
      const r = results[0]
      printJson({
        report: r.report,
        score: r.score,
        suggestions: r.suggestions,
      })
    } else {
      printJson({ count: results.length, results })
    }
    return
  }

  if (results.length === 0) {
    process.stdout.write('No skills found.\n')
    return
  }

  for (const r of results) {
    process.stdout.write(
      formatReport(r.report, r.score, r.suggestions).join('\n') + '\n\n',
    )
  }
}

function auditFailed(results: AuditResult[], failOn: DriftSeverity): boolean {
  const threshold = SEVERITY_ORDER[failOn]
  return results.some(r =>
    r.report.findings.some(f => SEVERITY_ORDER[f.severity] >= threshold),
  )
}

function resolveRoots(
  userRoots: string[],
  opts: { defaults?: boolean; project?: string },
): string[] {
  if (!opts.defaults) return userRoots
  const base = opts.project ?? '.'
  return [...userRoots, ...defaultSkillRoots(base)]
}

function readPackageVersion(): string {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const program = new Command()

program
  .name('skill-auditor')
  .description(
    'Audit imported Agent Skills against the reality of this project.',
  )
  .version(readPackageVersion(), '-v, --version', 'print version and exit')

program
  .command('scan')
  .argument('[path]', 'project root to scan', '.')
  .description('Print the RepoReality (declared deps + used imports) as JSON')
  .action((path: string) => {
    printJson(buildRepoReality(path))
  })

program
  .command('extract')
  .argument('<skillDir>', 'directory containing SKILL.md')
  .description('Print the SkillIdentifiers extracted from a skill as JSON')
  .action((skillDir: string) => {
    printJson(extractSkillIdentifiers(skillDir))
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
  .option('--json', 'emit machine-readable JSON (score, findings, suggestions)')
  .description('Audit a skill or all skills under a root against the project')
  .action(
    (
      inputPath: string,
      opts: { project: string; failOn: string; json?: boolean },
    ) => {
      const failOn = opts.failOn as DriftSeverity
      if (!(failOn in SEVERITY_ORDER)) {
        process.stderr.write(
          `Invalid --fail-on "${opts.failOn}". Use info, warning, or critical.\n`,
        )
        process.exit(2)
      }

      const repo = buildRepoReality(opts.project)
      const skillDirs = resolveSkillPath(inputPath)
      const results = runAudits(repo, skillDirs)
      printAuditResults(results, opts)
      process.exit(auditFailed(results, failOn) ? 1 : 0)
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
      printJson({ skillDirs, count: skillDirs.length })
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
  .option('--json', 'emit machine-readable JSON')
  .description('Audit every skill found under the given roots')
  .action(
    (
      roots: string[],
      opts: {
        project: string
        defaults?: boolean
        failOn: string
        json?: boolean
      },
    ) => {
      const failOn = opts.failOn as DriftSeverity
      if (!(failOn in SEVERITY_ORDER)) {
        process.stderr.write(
          `Invalid --fail-on "${opts.failOn}". Use info, warning, or critical.\n`,
        )
        process.exit(2)
      }

      const repo = buildRepoReality(opts.project)
      const skillDirs = findSkillDirs(resolveRoots(roots, opts))
      const results = runAudits(repo, skillDirs)
      printAuditResults(results, opts)
      process.exit(auditFailed(results, failOn) ? 1 : 0)
    },
  )

program
  .command('gaps')
  .argument('[roots...]', 'skill roots to scan recursively', [])
  .option('-p, --project <path>', 'project root to analyze', '.')
  .option(
    '-d, --defaults',
    'also scan well-known project-local skill roots (.cursor/.claude/.agents/.codex)',
  )
  .option('-c, --checklist <key>', 'must-have checklist key (e.g. frontend)')
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
      const repo = buildRepoReality(opts.project)
      const resolvedRoots = resolveRoots(roots, opts)
      const skillDirs = findSkillDirs(resolvedRoots)
      const gapReport = detectGaps(repo, resolvedRoots, opts.checklist)

      if (opts.json) {
        printJson({ skillDirs, ...gapReport })
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
    (opts: { project: string; priority?: string; json?: boolean }) => {
      if (opts.priority && !SPEC_PRIORITIES.includes(opts.priority as SpecPriority)) {
        process.stderr.write(
          `Invalid --priority "${opts.priority}". Expected one of: ${SPEC_PRIORITIES.join(', ')}\n`,
        )
        process.exit(2)
      }

      const report = runSpecCompliance(
        opts.project,
        opts.priority as SpecPriority | undefined,
      )

      if (opts.json) {
        printJson(report)
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

try {
  program.parse(process.argv)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`Error: ${message}\n`)
  process.exit(1)
}
