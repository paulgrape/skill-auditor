import * as path from 'path'
import type { AuditComparison } from './compare.js'
import { formatComparisonText } from './compare.js'
import type { AuditError, AuditResult } from './reports.js'
import type {
  AlignmentReport,
  DriftFindingKind,
  DriftSeverity,
  SkillScore,
  SkillSuggestion,
} from './types.js'

/**
 * Renderers for audit results. JSON is the contract; these are the views:
 * text for a terminal, markdown for a PR comment, SARIF for code-scanning
 * uploads (GitHub, Azure DevOps, VS Code SARIF viewer) where each finding
 * becomes an annotation on the SKILL.md line it points at.
 */

export const AUDIT_FORMATS = ['text', 'json', 'markdown', 'sarif'] as const
export type AuditFormat = (typeof AUDIT_FORMATS)[number]

export const SEVERITY_ORDER: Record<DriftSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
}

function pct(value: number | null | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`
}

function orderedFindings(report: AlignmentReport) {
  return [...report.findings].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
  )
}

function describeLocation(finding: AlignmentReport['findings'][number]): string {
  if (!finding.location) return ''
  const heading = finding.location.heading ? ` (${finding.location.heading})` : ''
  return `SKILL.md:${finding.location.line}${heading}`
}

// ---------------------------------------------------------------- text ----

function formatScoreBlock(score: SkillScore): string[] {
  const lines: string[] = []
  lines.push(`Kind:      ${score.kind}`)

  if (score.overall === null) {
    const why =
      score.kind === 'procedural'
        ? 'procedural skill — command-line workflow, not package-scored'
        : 'neutral skill — no technical references'
    lines.push(`Alignment: N/A (${why})`)
    lines.push(
      `Quality:   ${score.intrinsicQuality}/100 (${score.intrinsicGrade})`,
    )
  } else {
    lines.push(`Score:     ${score.overall}/100 (${score.grade})`)
    lines.push(`  alignment:   ${pct(score.breakdown.alignment)}`)
    lines.push(`  specificity: ${pct(score.breakdown.specificity)}`)
    lines.push(`  freshness:   ${pct(score.breakdown.freshness)}`)
    lines.push(`  focus:       ${pct(score.breakdown.focus)}`)
    lines.push(
      `Quality:   ${score.intrinsicQuality}/100 (${score.intrinsicGrade})`,
    )
  }

  return lines
}

export function formatReport(
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
    for (const f of orderedFindings(report)) {
      lines.push(`  [${f.severity.toUpperCase()}] ${f.kind}: ${f.message}`)
      lines.push(`      skill: ${f.skillReference}`)
      if (f.repoReality) lines.push(`      repo:  ${f.repoReality}`)
      const where = describeLocation(f)
      if (where) lines.push(`      at:    ${where}`)
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

export function formatAuditText(
  results: AuditResult[],
  errors: AuditError[],
  comparison?: AuditComparison,
): string {
  if (results.length === 0 && errors.length === 0) return 'No skills found.\n'
  const blocks = results.map(
    r => formatReport(r.report, r.score, r.suggestions).join('\n') + '\n',
  )
  if (comparison) blocks.push(formatComparisonText(comparison).join('\n') + '\n')
  return blocks.join('\n')
}

// ------------------------------------------------------------ markdown ----

function mdCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export function formatAuditMarkdown(
  results: AuditResult[],
  errors: AuditError[],
  comparison?: AuditComparison,
): string {
  const lines: string[] = []
  lines.push('## Skill audit')
  lines.push('')
  if (results.length === 0 && errors.length === 0) {
    lines.push('No skills found.')
    return lines.join('\n') + '\n'
  }

  lines.push('| Skill | Kind | Score | Quality | Critical | Warning | Info |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const r of results) {
    const counts = { critical: 0, warning: 0, info: 0 }
    for (const f of r.report.findings) counts[f.severity]++
    const score =
      r.score.overall === null ? 'N/A' : `${r.score.overall} (${r.score.grade})`
    lines.push(
      `| ${mdCell(r.report.skillName)} | ${r.score.kind} | ${score} | ${r.score.intrinsicQuality} (${r.score.intrinsicGrade}) | ${counts.critical} | ${counts.warning} | ${counts.info} |`,
    )
  }
  for (const e of errors) {
    lines.push(`| ${mdCell(e.skillDir)} | error | — | — | — | — | — |`)
  }

  for (const r of results) {
    if (r.report.findings.length === 0) continue
    lines.push('')
    lines.push(`### ${r.report.skillName}`)
    lines.push('')
    for (const f of orderedFindings(r.report)) {
      const where = describeLocation(f)
      lines.push(
        `- **${f.severity}** \`${f.kind}\`${where ? ` at ${where}` : ''}: ${f.message}`,
      )
    }
    if (r.suggestions.length > 0) {
      lines.push('')
      lines.push('Suggestions:')
      lines.push('')
      for (const s of r.suggestions) lines.push(`- ${s.suggestion}`)
    }
  }

  if (errors.length > 0) {
    lines.push('')
    lines.push('### Could not audit')
    lines.push('')
    for (const e of errors) lines.push(`- \`${e.skillDir}\`: ${e.error}`)
  }

  if (comparison) {
    lines.push('')
    lines.push('### Compared with baseline')
    lines.push('')
    const s = comparison.summary
    lines.push(
      `${s.improved} improved, ${s.regressed} regressed, ${s.unchanged} unchanged, ${s.added} added, ${s.removed} removed.`,
    )
    lines.push('')
    lines.push('| Skill | Status | Before | After | Resolved | Introduced |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const skill of comparison.skills) {
      lines.push(
        `| ${mdCell(skill.skillName)} | ${skill.status} | ${skill.before?.overall ?? 'N/A'} | ${skill.after?.overall ?? 'N/A'} | ${skill.resolved.length} | ${skill.introduced.length} |`,
      )
    }
  }

  return lines.join('\n') + '\n'
}

// --------------------------------------------------------------- sarif ----

const SARIF_LEVEL: Record<DriftSeverity, 'note' | 'warning' | 'error'> = {
  info: 'note',
  warning: 'warning',
  critical: 'error',
}

const RULE_DESCRIPTIONS: Record<DriftFindingKind, string> = {
  'category-conflict':
    'The skill teaches a library that competes with the one the project uses for the same concern.',
  'missing-dependency':
    'The skill teaches a library the project does not declare, in a concern the project has no library for.',
  'deprecated-api':
    'The skill teaches an API the project has moved away from, per a curated deprecation rule.',
  'unverified-api':
    'The skill demonstrates identifiers from a package the project never imports.',
  'unused-reference':
    'The skill references a package the project does not use and the taxonomy does not know.',
  'metric-stuffing':
    'The skill pads references to game the score; the score is capped until fixed.',
  unscorable:
    'The skill scored low without any drift finding because it is not grounded in the project.',
}

const README_URL = 'https://github.com/paulgrape/skill-auditor#readme'

function toUri(file: string): string {
  const relative = path.relative(process.cwd(), file)
  const chosen =
    relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      ? relative
      : file
  return chosen.replace(/\\/g, '/')
}

export function formatAuditSarif(
  results: AuditResult[],
  errors: AuditError[],
  version: string,
): string {
  const usedRules = new Set<DriftFindingKind>()
  const sarifResults: unknown[] = []

  for (const r of results) {
    const uri = toUri(path.join(r.skillDir, 'SKILL.md'))
    for (const f of r.report.findings) {
      usedRules.add(f.kind)
      const suggestion = r.suggestions.find(s => s.finding === f)?.suggestion
      sarifResults.push({
        ruleId: f.kind,
        level: SARIF_LEVEL[f.severity],
        message: { text: f.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri },
              ...(f.location ? { region: { startLine: f.location.line } } : {}),
            },
            ...(f.location?.heading
              ? { logicalLocations: [{ name: f.location.heading, kind: 'section' }] }
              : {}),
          },
        ],
        properties: {
          skillName: r.report.skillName,
          skillReference: f.skillReference,
          ...(f.repoReality ? { repoReality: f.repoReality } : {}),
          ...(suggestion ? { suggestion } : {}),
          score: r.score.overall,
          kind: r.score.kind,
        },
      })
    }
  }

  const invocation = {
    executionSuccessful: true,
    toolExecutionNotifications: errors.map(e => ({
      level: 'error',
      message: { text: e.error },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: toUri(path.join(e.skillDir, 'SKILL.md')) },
          },
        },
      ],
    })),
  }

  const sarif = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'skill-auditor',
            version,
            informationUri: README_URL,
            rules: [...usedRules].sort().map(kind => ({
              id: kind,
              name: kind
                .split('-')
                .map(part => part[0].toUpperCase() + part.slice(1))
                .join(''),
              shortDescription: { text: RULE_DESCRIPTIONS[kind] },
              helpUri: `${README_URL}`,
            })),
          },
        },
        invocations: [invocation],
        results: sarifResults,
      },
    ],
  }
  return JSON.stringify(sarif, null, 2) + '\n'
}
