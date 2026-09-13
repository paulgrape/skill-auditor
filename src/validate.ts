import * as fs from 'fs'
import * as path from 'path'
import {
  frontmatterList,
  frontmatterMap,
  parseFrontmatter,
  type YamlValue,
} from './frontmatter.js'
import type {
  SkillValidation,
  ValidationSeverity,
  ValidationViolation,
} from './types.js'

/**
 * Lints a skill against the Agent Skills specification
 * (https://agentskills.io/specification). This is deterministic structure
 * checking — the audit measures whether a skill is *right* for a repo; this
 * measures whether it is a *valid skill* at all, which every spec-compliant
 * client and validator will enforce before loading it.
 */

const SPEC_FIELDS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
])

/**
 * Fields some clients read but the spec does not define. They are reported
 * as info rather than warning: legitimate, but not portable.
 */
const CLIENT_EXTENSION_FIELDS = new Set([
  'disable-model-invocation',
  'user-invocable',
  'model',
  'effort',
  'when_to_use',
  'context',
  'agent',
  'argument-hint',
  'hooks',
  'paths',
  'version',
  'author',
])

const NAME_MAX = 64
const DESCRIPTION_MAX = 1024
const COMPATIBILITY_MAX = 500
const BODY_MAX_LINES = 500

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function violation(
  severity: ValidationSeverity,
  rule: string,
  message: string,
  field?: string,
): ValidationViolation {
  return field ? { severity, rule, message, field } : { severity, rule, message }
}

function describeValue(value: YamlValue | undefined): string {
  if (value === undefined) return 'missing'
  if (Array.isArray(value)) return 'a list'
  if (typeof value === 'object') return 'a mapping'
  return 'a string'
}

function checkName(
  data: Record<string, YamlValue>,
  skillDir: string,
  out: ValidationViolation[],
): void {
  const value = data.name
  if (typeof value !== 'string' || value === '') {
    out.push(
      violation(
        'error',
        'name-required',
        `\`name\` is required and must be a non-empty string (found ${describeValue(value)}).`,
        'name',
      ),
    )
    return
  }
  if (value.length > NAME_MAX) {
    out.push(
      violation(
        'error',
        'name-length',
        `\`name\` is ${value.length} characters; the maximum is ${NAME_MAX}.`,
        'name',
      ),
    )
  }
  if (!NAME_RE.test(value)) {
    out.push(
      violation(
        'error',
        'name-format',
        `\`name\` "${value}" must use only lowercase letters, digits and single hyphens, with no leading or trailing hyphen.`,
        'name',
      ),
    )
  }
  const dirName = path.basename(path.resolve(skillDir))
  if (value !== dirName) {
    out.push(
      violation(
        'error',
        'name-matches-directory',
        `\`name\` "${value}" must match the skill directory name "${dirName}".`,
        'name',
      ),
    )
  }
}

function checkDescription(
  data: Record<string, YamlValue>,
  out: ValidationViolation[],
): void {
  const value = data.description
  if (typeof value !== 'string' || value.trim() === '') {
    out.push(
      violation(
        'error',
        'description-required',
        `\`description\` is required and must be a non-empty string (found ${describeValue(value)}).`,
        'description',
      ),
    )
    return
  }
  if (value.length > DESCRIPTION_MAX) {
    out.push(
      violation(
        'error',
        'description-length',
        `\`description\` is ${value.length} characters; the maximum is ${DESCRIPTION_MAX}.`,
        'description',
      ),
    )
  }
  if (!/\bwhen\b/i.test(value)) {
    out.push(
      violation(
        'info',
        'description-trigger',
        '`description` should say when to use the skill as well as what it does — it carries the whole burden of triggering. Add a "Use when ..." clause with the terms a request would contain.',
        'description',
      ),
    )
  }
}

function checkOptionalFields(
  data: Record<string, YamlValue>,
  out: ValidationViolation[],
): void {
  const compatibility = data.compatibility
  if (compatibility !== undefined) {
    if (typeof compatibility !== 'string') {
      out.push(
        violation(
          'error',
          'compatibility-type',
          `\`compatibility\` must be a string (found ${describeValue(compatibility)}).`,
          'compatibility',
        ),
      )
    } else if (compatibility.length > COMPATIBILITY_MAX) {
      out.push(
        violation(
          'error',
          'compatibility-length',
          `\`compatibility\` is ${compatibility.length} characters; the maximum is ${COMPATIBILITY_MAX}.`,
          'compatibility',
        ),
      )
    }
  }

  for (const field of ['license', 'allowed-tools'] as const) {
    const value = data[field]
    if (value !== undefined && typeof value !== 'string') {
      out.push(
        violation(
          'error',
          `${field}-type`,
          `\`${field}\` must be a string (found ${describeValue(value)}).`,
          field,
        ),
      )
    }
  }

  const metadata = data.metadata
  if (metadata !== undefined && frontmatterMap(data, 'metadata') === undefined) {
    out.push(
      violation(
        'error',
        'metadata-type',
        `\`metadata\` must be a mapping of string keys to string values (found ${describeValue(metadata)}).`,
        'metadata',
      ),
    )
  }
}

function checkUnknownFields(
  data: Record<string, YamlValue>,
  out: ValidationViolation[],
): void {
  for (const field of Object.keys(data)) {
    if (SPEC_FIELDS.has(field)) continue

    if (field === 'categories') {
      const list = frontmatterList(data, 'categories')
      out.push(
        violation(
          'warning',
          'categories-not-in-metadata',
          `Top-level \`categories\` is not an Agent Skills field and spec validators reject unexpected fields. Move it to \`metadata:\` as \`categories: "${list.join(', ')}"\`; skill-auditor reads both.`,
          'categories',
        ),
      )
      continue
    }

    if (CLIENT_EXTENSION_FIELDS.has(field)) {
      out.push(
        violation(
          'info',
          'client-extension-field',
          `\`${field}\` is a client-specific extension, not part of the Agent Skills spec; other clients may ignore or reject it.`,
          field,
        ),
      )
      continue
    }

    out.push(
      violation(
        'warning',
        'unknown-field',
        `\`${field}\` is not an Agent Skills frontmatter field. Move custom data under \`metadata:\`.`,
        field,
      ),
    )
  }
}

function checkBody(body: string, out: ValidationViolation[]): void {
  if (body.trim() === '') {
    out.push(
      violation(
        'error',
        'body-required',
        'SKILL.md has no instructions after the frontmatter.',
      ),
    )
    return
  }
  const lines = body.split('\n').length
  if (lines > BODY_MAX_LINES) {
    out.push(
      violation(
        'warning',
        'body-length',
        `SKILL.md body is ${lines} lines; keep it under ${BODY_MAX_LINES} and move detail into references/ files the agent loads on demand.`,
      ),
    )
  }
}

/** Validates one skill directory. Never throws: a missing file is a violation. */
export function validateSkill(skillDir: string): SkillValidation {
  const violations: ValidationViolation[] = []
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  const fallbackName = path.basename(path.resolve(skillDir))

  let raw: string
  try {
    raw = fs.readFileSync(skillMdPath, 'utf-8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    violations.push(
      violation('error', 'skill-md-missing', `Cannot read ${skillMdPath}: ${reason}`),
    )
    return { skillDir, skillName: fallbackName, valid: false, violations }
  }

  const { data, body, hasFrontmatter } = parseFrontmatter(raw)
  if (!hasFrontmatter) {
    violations.push(
      violation(
        'error',
        'frontmatter-required',
        'SKILL.md must start with a YAML frontmatter block delimited by `---` lines.',
      ),
    )
  }

  checkName(data, skillDir, violations)
  checkDescription(data, violations)
  checkOptionalFields(data, violations)
  checkUnknownFields(data, violations)
  checkBody(body, violations)

  const skillName = typeof data.name === 'string' && data.name ? data.name : fallbackName
  return {
    skillDir,
    skillName,
    valid: !violations.some(v => v.severity === 'error'),
    violations,
  }
}

export function validateSkills(skillDirs: string[]): SkillValidation[] {
  return skillDirs.map(validateSkill)
}
