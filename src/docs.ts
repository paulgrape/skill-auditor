import type { Command } from 'commander'
import { CONFIG_FILENAME } from './config.js'
import { envelope, SCHEMA_VERSION } from './envelope.js'
import {
  CATEGORY_TAXONOMY,
  MUST_HAVE_CHECKLISTS,
} from './taxonomy.js'
import { DEPRECATED_API_RULES } from './taxonomyData.js'

/**
 * What each command produces and when it exits non-zero. Commands, arguments
 * and flags are read off the live commander definition, so only the parts
 * commander cannot know are written down here.
 */
interface CommandOutput {
  /** True when the command emits JSON with or without `--json`. */
  alwaysJson: boolean
  /** Top-level keys of the JSON payload, besides `schemaVersion`. */
  fields: string[]
  description: string
  exitCodes: { code: number; when: string }[]
}

const OK = { code: 0, when: 'success' }
const USAGE_ERROR = { code: 2, when: 'an option value is invalid' }
const CRASH = { code: 1, when: 'the command failed (message on stderr)' }

const COMMAND_OUTPUT: Record<string, CommandOutput> = {
  scan: {
    alwaysJson: true,
    fields: [
      'declaredDeps',
      'usedImports',
      'usedIdentifiers',
      'importEvidence',
      'config',
    ],
    description:
      "The project's ground truth: declared dependencies, the import specifiers and identifiers its source really uses, file-level evidence for each package, and the `.skill-auditor.json` (or package.json) config that was applied.",
    exitCodes: [OK, CRASH],
  },
  extract: {
    alwaysJson: true,
    fields: [
      'skillName',
      'skillPath',
      'categories',
      'packages',
      'importSpecifiers',
      'apiCalls',
      'packageRefs',
      'importedIdentifiers',
      'unusedImportCount',
      'locations',
      'codeEvidence',
    ],
    description:
      'What a SKILL.md claims: the packages, import specifiers and APIs it references, and how substantiated each reference is.',
    exitCodes: [OK, CRASH],
  },
  audit: {
    alwaysJson: false,
    fields: ['count', 'results', 'errors'],
    description:
      '`results` is always an array of `{ skillDir, report, score, suggestions }`, one entry per audited skill, even when a single skill directory was passed. `errors` lists skill directories that could not be read as `{ skillDir, error }` and is empty on a clean run. `--baseline` adds a `comparison` object (same shape as the `compare` command).',
    exitCodes: [
      OK,
      {
        code: 1,
        when: 'a finding at or above --fail-on exists, a skill is below --min-score, a skill could not be audited, or --baseline comparison reported a regression',
      },
      USAGE_ERROR,
    ],
  },
  'audit-all': {
    alwaysJson: false,
    fields: ['count', 'results', 'errors'],
    description:
      'Same payload as `audit`, over every skill discovered under the given roots.',
    exitCodes: [
      OK,
      {
        code: 1,
        when: 'a finding at or above --fail-on exists, a skill is below --min-score, a skill could not be audited, or --baseline comparison reported a regression',
      },
      USAGE_ERROR,
    ],
  },
  list: {
    alwaysJson: false,
    fields: ['skillDirs', 'count'],
    description: 'Directories containing a SKILL.md under the given roots.',
    exitCodes: [OK, CRASH],
  },
  gaps: {
    alwaysJson: false,
    fields: ['skillDirs', 'projectCategories', 'coveredCategories', 'gaps'],
    description:
      'Stack categories the project uses versus the ones installed skills cover; each gap carries a recommendation and, where available, real import evidence.',
    exitCodes: [
      OK,
      { code: 1, when: '--fail-on-gap was passed and a gap was found' },
      USAGE_ERROR,
    ],
  },
  'spec-check': {
    alwaysJson: false,
    fields: ['summary', 'findings'],
    description:
      'Static Website Specification compliance; each finding is pass, fail, or skip (skip means it needs a live URL or runtime audit).',
    exitCodes: [
      OK,
      { code: 1, when: 'any specification item failed' },
      USAGE_ERROR,
    ],
  },
  docs: {
    alwaysJson: true,
    fields: ['tool', 'envelope', 'commands', 'taxonomy', 'config'],
    description:
      'This contract: every command, argument, flag, output shape and exit code, generated from the CLI definition itself, plus the live taxonomy tables a project can extend.',
    exitCodes: [OK],
  },
  validate: {
    alwaysJson: false,
    fields: ['count', 'valid', 'results'],
    description:
      'Agent Skills spec lint. `results` is `{ skillDir, skillName, valid, violations[] }`; `valid` is false when any skill has an error-severity violation.',
    exitCodes: [
      OK,
      { code: 1, when: 'a skill has an error-severity spec violation' },
      USAGE_ERROR,
    ],
  },
  scaffold: {
    alwaysJson: false,
    fields: ['skillDir', 'skillPath', 'name', 'category', 'written', 'contents'],
    description:
      'A SKILL.md generated from the project\'s import evidence for one category. `written` is false under --dry-run.',
    exitCodes: [OK, CRASH, USAGE_ERROR],
  },
  compare: {
    alwaysJson: false,
    fields: ['summary', 'skills'],
    description:
      'Score and finding deltas between two `audit --json` payloads. Skills are matched by name.',
    exitCodes: [
      OK,
      { code: 1, when: '--fail-on-regression was passed and a skill regressed' },
      CRASH,
    ],
  },
  mcp: {
    alwaysJson: false,
    fields: [],
    description:
      'Speaks the Model Context Protocol over stdio instead of printing a report: stdout carries JSON-RPC messages only, logs go to stderr.',
    exitCodes: [OK, CRASH],
  },
}

interface ArgumentContract {
  name: string
  required: boolean
  variadic: boolean
  description?: string
  default?: unknown
}

interface OptionContract {
  flags: string
  name: string
  takesValue: boolean
  description?: string
  default?: unknown
}

/** Commander's own types for these are internal, so narrow structurally. */
interface RegisteredArgument {
  name(): string
  description: string
  required: boolean
  variadic: boolean
  defaultValue?: unknown
}

function describeArguments(command: Command): ArgumentContract[] {
  const args = command.registeredArguments as unknown as RegisteredArgument[]
  return args.map(arg => ({
    name: arg.name(),
    required: arg.required,
    variadic: arg.variadic,
    ...(arg.description ? { description: arg.description } : {}),
    ...(arg.defaultValue === undefined ? {} : { default: arg.defaultValue }),
  }))
}

function describeOptions(command: Command): OptionContract[] {
  return command.options.map(option => ({
    flags: option.flags,
    name: option.attributeName(),
    takesValue: Boolean(option.required || option.optional),
    ...(option.description ? { description: option.description } : {}),
    ...(option.defaultValue === undefined
      ? {}
      : { default: option.defaultValue }),
  }))
}

/**
 * A machine-readable contract for the whole CLI, so an agent can discover the
 * surface instead of trusting a SKILL.md that may have drifted from it.
 */
export function buildDocs(program: Command, version: string) {
  const commands = program.commands
    .filter(command => command.name() !== 'help')
    .map(command => ({
      name: command.name(),
      description: command.description(),
      usage: `${command.name()} ${command.usage()}`.trim(),
      arguments: describeArguments(command),
      options: describeOptions(command),
      output: COMMAND_OUTPUT[command.name()],
    }))

  return envelope({
    tool: {
      name: program.name(),
      version,
      description: program.description(),
    },
    envelope: {
      field: 'schemaVersion',
      value: SCHEMA_VERSION,
      description:
        'Every JSON payload starts with this field. It is bumped when a field is removed or changes meaning; new fields may appear without a bump.',
    },
    commands,
    taxonomy: {
      categories: CATEGORY_TAXONOMY,
      checklists: MUST_HAVE_CHECKLISTS,
      deprecatedApiRules: DEPRECATED_API_RULES,
    },
    config: {
      file: CONFIG_FILENAME,
      fields: ['taxonomy', 'checklists', 'ignore'],
      description:
        'Optional project file, or a "skill-auditor" key in package.json. Extends categories, checklists and ignore globs; scoring thresholds are not configurable.',
    },
  })
}
