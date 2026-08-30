import type { Command } from 'commander'
import { envelope, SCHEMA_VERSION } from './envelope.js'

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
    ],
    description:
      "The project's ground truth: declared dependencies, the import specifiers and identifiers its source really uses, and file-level evidence for each package.",
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
    ],
    description:
      'What a SKILL.md claims: the packages, import specifiers and APIs it references, and how substantiated each reference is.',
    exitCodes: [OK, CRASH],
  },
  audit: {
    alwaysJson: false,
    fields: ['count', 'results'],
    description:
      '`results` is always an array of `{ skillDir, report, score, suggestions }`, one entry per audited skill, even when a single skill directory was passed.',
    exitCodes: [
      OK,
      {
        code: 1,
        when: 'a finding at or above --fail-on exists, or a skill is below --min-score',
      },
      USAGE_ERROR,
    ],
  },
  'audit-all': {
    alwaysJson: false,
    fields: ['count', 'results'],
    description:
      'Same payload as `audit`, over every skill discovered under the given roots.',
    exitCodes: [
      OK,
      {
        code: 1,
        when: 'a finding at or above --fail-on exists, or a skill is below --min-score',
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
    fields: ['tool', 'envelope', 'commands'],
    description:
      'This contract: every command, argument, flag, output shape and exit code, generated from the CLI definition itself.',
    exitCodes: [OK],
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
  })
}
