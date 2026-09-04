import * as fs from 'fs'
import * as path from 'path'
import { evidenceForCategory, packagesForCategory } from './gaps.js'
import { BASE_MUST_HAVE_CHECKLISTS } from './taxonomyData.js'
import type { ImportEvidence, RepoReality } from './types.js'

/**
 * Writes a SKILL.md for one uncovered category from the project's own import
 * evidence, so an agent does not have to invent the file. The result is a
 * starting point: real specifiers, real file paths, a working snippet when
 * evidence provides one — not a finished skill.
 */

const WEBSITE_DOMAINS = new Set(BASE_MUST_HAVE_CHECKLISTS.website ?? [])

export interface ScaffoldRequest {
  category: string
  repo: RepoReality
  /** Directory that will contain `<name>/SKILL.md`. Defaults to cwd. */
  outDir: string
  /** Override the skill directory name; defaults to the category. */
  name?: string
  /** Overwrite an existing SKILL.md */
  force?: boolean
  /** Return the contents without writing */
  dryRun?: boolean
}

export interface ScaffoldResult {
  skillDir: string
  skillPath: string
  name: string
  category: string
  written: boolean
  contents: string
}

function skillNameFor(category: string, override?: string): string {
  const raw = (override ?? category).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const name = raw.replace(/^-+|-+$/g, '').slice(0, 64)
  if (!name) throw new Error('Skill name is empty after sanitizing.')
  return name
}

function uniqueSpecifiers(evidence: ImportEvidence[]): string[] {
  return [...new Set(evidence.map(e => e.specifier))].slice(0, 6)
}

function uniqueFiles(evidence: ImportEvidence[]): string[] {
  return [...new Set(evidence.map(e => e.file))].slice(0, 5)
}

function snippetFrom(evidence: ImportEvidence[]): string | undefined {
  const withExample = evidence.find(e => e.example)
  if (!withExample?.example) return undefined
  const specifier = withExample.specifier
  const example = withExample.example
  // Evidence examples are one-line import/require statements. Wrap them so
  // the generated skill has a fenced usage the auditor can score.
  if (/^\s*(import|export|const|let|var|require)/.test(example)) {
    return `\`\`\`ts\n// from ${withExample.file}\n${example}\n\`\`\``
  }
  return `\`\`\`ts\n// from ${withExample.file}\nimport { /* bindings the file uses */ } from '${specifier}'\n\`\`\``
}

function descriptionFor(
  category: string,
  pkg: string | undefined,
  isDomain: boolean,
): string {
  if (isDomain) {
    return `${category} rules for this project. Use when working on ${category}, or when the user asks to audit or improve it.`
  }
  if (pkg) {
    return `${category} patterns for this project using ${pkg}. Use when working with ${category}, ${pkg}, or related code in this codebase.`
  }
  return `${category} coverage for this project. Use when adding ${category} to the stack, or when the user asks which library to pick.`
}

export function renderScaffold(
  category: string,
  repo: RepoReality,
  name: string,
): string {
  const isDomain = WEBSITE_DOMAINS.has(category)
  const evidence = evidenceForCategory(category, repo)
  const packages = packagesForCategory(category, repo)
  const primary = evidence[0]?.packageName ?? packages[0]
  const specifiers = uniqueSpecifiers(evidence)
  const files = uniqueFiles(evidence)
  const snippet = snippetFrom(evidence)
  const declared = primary ? repo.declaredDeps[primary] : undefined

  const lines: string[] = []
  lines.push('---')
  lines.push(`name: ${name}`)
  lines.push(`description: ${descriptionFor(category, primary, isDomain)}`)
  lines.push('metadata:')
  lines.push(`  categories: ${category}`)
  lines.push('---')
  lines.push('')
  lines.push(`# ${category}`)
  lines.push('')
  if (primary) {
    lines.push(
      `This project uses \`${primary}\` for ${category}. Keep new work on this concern aligned with the files below.`,
    )
  } else if (isDomain) {
    lines.push(
      `This skill covers the ${category} domain of the Website Specification. It is a checklist, not a package tutorial — fill the patterns from the repo's HTML, headers and routes, not from a generic example.`,
    )
  } else {
    lines.push(
      `The project has no ${category} library yet. This is a planning skill: do not invent imports. Either pick a library with the user, or delete this file if the concern does not apply.`,
    )
  }
  lines.push('')
  lines.push('## When to use')
  lines.push('')
  lines.push(`- The user asks to add or change ${category} behavior in this repo`)
  if (files.length > 0) {
    lines.push('- Editing any of the files listed under **Files to inspect**')
  }
  if (specifiers.length > 0) {
    lines.push(
      `- Adding imports from ${specifiers.map(s => `\`${s}\``).join(', ')}`,
    )
  }
  lines.push('')
  lines.push('## Project setup')
  lines.push('')
  if (primary) {
    lines.push(
      `- Package: \`${primary}\`${declared ? ` (\`${declared}\`)` : ''}`,
    )
  }
  if (specifiers.length > 0) {
    lines.push(
      `- Import specifiers in use: ${specifiers.map(s => `\`${s}\``).join(', ')}`,
    )
  }
  if (packages.length > 1) {
    lines.push(
      `- Other ${category} packages declared: ${packages
        .filter(p => p !== primary)
        .map(p => `\`${p}\``)
        .join(', ')}`,
    )
  }
  if (!primary && !isDomain) {
    lines.push(
      `- No ${category} package is declared. Do not add fake imports to raise the audit score.`,
    )
  }
  lines.push('')
  lines.push('## Files to inspect')
  lines.push('')
  if (files.length > 0) {
    for (const file of files) lines.push(`- \`${file}\``)
  } else {
    lines.push(
      '- No import evidence yet. Search the repo for the config and source files that will own this concern, then replace this list.',
    )
  }
  lines.push('')
  lines.push('## Patterns')
  lines.push('')
  if (snippet) {
    lines.push(
      'Canonical import from the repo. Expand it into a working example that uses the imported bindings, matching the surrounding file.',
    )
    lines.push('')
    lines.push(snippet)
  } else {
    lines.push(
      'No snippet was recoverable from the scan. Copy a real usage from the files above rather than inventing an API.',
    )
  }
  lines.push('')
  lines.push('## Anti-patterns')
  lines.push('')
  lines.push(
    '- Do not demonstrate APIs or import specifiers the project never uses',
  )
  lines.push(
    '- Do not pad this skill with other categories — one concern per skill',
  )
  lines.push(
    '- Do not leave unused import lines; every import must be used in the snippet',
  )
  lines.push('')
  return lines.join('\n')
}

export function scaffoldSkill(request: ScaffoldRequest): ScaffoldResult {
  const name = skillNameFor(request.category, request.name)
  const skillDir = path.resolve(request.outDir, name)
  const skillPath = path.join(skillDir, 'SKILL.md')
  const contents = renderScaffold(request.category, request.repo, name)

  if (request.dryRun) {
    return {
      skillDir,
      skillPath,
      name,
      category: request.category,
      written: false,
      contents,
    }
  }

  if (fs.existsSync(skillPath) && !request.force) {
    throw new Error(
      `${skillPath} already exists. Pass --force to overwrite, or choose a different --out.`,
    )
  }
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(skillPath, contents, 'utf-8')
  return {
    skillDir,
    skillPath,
    name,
    category: request.category,
    written: true,
    contents,
  }
}
