import { createInterface } from 'node:readline'
import * as fs from 'fs'
import * as path from 'path'
import { prepareProject } from './config.js'
import { defaultSkillRoots, resolveSkillPath } from './discoverSkills.js'
import { envelope, toPlainJson } from './envelope.js'
import { buildRepoReality } from './repoReality.js'
import {
  auditReport,
  auditSkillsSafely,
  gapsReport,
  scanReport,
  validateReport,
} from './reports.js'
import { scaffoldSkill } from './scaffold.js'
import { extractSkillIdentifiers } from './skillIdentifiers.js'
import { runSpecCompliance } from './specCompliance.js'
import { CATEGORY_TAXONOMY, MUST_HAVE_CHECKLISTS } from './taxonomy.js'
import { DEPRECATED_API_RULES } from './taxonomyData.js'
import type { SpecPriority } from './types.js'
import { validateSkills } from './validate.js'
import { packageRoot, readPackageVersion } from './version.js'

/**
 * A dependency-free Model Context Protocol server over stdio.
 *
 * It is dual-era: revision 2026-07-28 dropped the `initialize` handshake in
 * favour of per-request metadata, but most clients in the field still open
 * with `initialize`, so both are answered.
 */
const MODERN_PROTOCOL_VERSION = '2026-07-28'
const LEGACY_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]
const SUPPORTED_PROTOCOL_VERSIONS = [
  MODERN_PROTOCOL_VERSION,
  ...LEGACY_PROTOCOL_VERSIONS,
]

const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion'
const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities'
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo'

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const UNSUPPORTED_PROTOCOL_VERSION = -32022

const SERVER_INSTRUCTIONS = [
  'skill-auditor measures Agent Skills (SKILL.md files) against the project they are installed in.',
  'Call scan to learn what the project actually depends on, audit to score skills and get findings with suggestions, gaps to find uncovered categories, validate to lint SKILL.md against the Agent Skills spec, and scaffold to generate a missing skill from repo evidence.',
  'Read resources for the bundled templates and skill-auditor skill; use the audit-and-fix prompt for the full loop.',
  'Every tool returns the same versioned JSON payload as the CLI: read schemaVersion before parsing the rest.',
  'Paths are resolved relative to the working directory the server was started in.',
].join(' ')

const CAPABILITIES = { tools: {}, resources: {}, prompts: {} }

/** When true, tool/resource paths that resolve outside cwd are rejected. */
let confineToCwd = false

function resolveUserPath(input: string): string {
  const resolved = path.resolve(input)
  if (!confineToCwd) return resolved
  const cwd = process.cwd()
  const relative = path.relative(cwd, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `Path "${input}" resolves outside the working directory (${cwd}). Restart the server without --confine to allow it.`,
    )
  }
  return resolved
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: string | number | null
  result?: Record<string, unknown>
  error?: { code: number; message: string; data?: unknown }
}

interface McpTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  readOnly?: boolean
  run(args: Record<string, unknown>): unknown
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`"${key}" is required and must be a non-empty string.`)
  }
  return value
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`"${key}" must be a string.`)
  return value
}

function optionalStringArray(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`"${key}" must be an array of strings.`)
  }
  return value as string[]
}

function optionalBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new Error(`"${key}" must be a boolean.`)
  return value
}

const PROJECT_PROPERTY = {
  type: 'string',
  description:
    'Project root to analyze. Defaults to the working directory the server runs in.',
  default: '.',
}

const SCHEMA_VERSION_PROPERTY = {
  type: 'integer',
  description: 'Version of the JSON contract this payload follows.',
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'audit',
    title: 'Audit skills against the project',
    description:
      'Score one skill directory, or every skill under a skills root, against the project it is installed in. Returns per-skill findings, a score breakdown and concrete suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Skill directory containing SKILL.md, or a skills root to scan recursively.',
        },
        project: PROJECT_PROPERTY,
      },
      required: ['path'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        schemaVersion: SCHEMA_VERSION_PROPERTY,
        count: {
          type: 'integer',
          description: 'Number of skills that were scored.',
        },
        results: {
          type: 'array',
          description:
            'One entry per audited skill: { skillDir, report, score, suggestions }.',
        },
        errors: {
          type: 'array',
          description:
            'Skill directories that could not be read or parsed: { skillDir, error }. Empty on a clean run.',
        },
      },
      required: ['schemaVersion', 'count', 'results', 'errors'],
    },
    run(args) {
      const project = resolveUserPath(optionalString(args, 'project') ?? '.')
      prepareProject(project)
      const repo = buildRepoReality(project)
      const skillDirs = resolveSkillPath(
        resolveUserPath(requireString(args, 'path')),
      )
      const { results, errors } = auditSkillsSafely(repo, skillDirs)
      return auditReport(results, errors)
    },
  },
  {
    name: 'gaps',
    title: 'Find uncovered stack categories',
    description:
      "Compare the project's stack against the skills installed for it and report categories no skill covers, with import evidence to build the missing skill from.",
    inputSchema: {
      type: 'object',
      properties: {
        roots: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Skill roots to scan recursively. When omitted, the well-known project-local roots (.cursor/skills, .claude/skills, .agents/skills, .codex/skills) are used.',
        },
        project: PROJECT_PROPERTY,
        checklist: {
          type: 'string',
          description:
            'Must-have checklist to measure coverage against (frontend, website, or a key from the project config).',
        },
        defaults: {
          type: 'boolean',
          description:
            'Also scan the well-known project-local skill roots alongside the roots given.',
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        schemaVersion: SCHEMA_VERSION_PROPERTY,
        skillDirs: { type: 'array', items: { type: 'string' } },
        projectCategories: { type: 'array', items: { type: 'string' } },
        coveredCategories: { type: 'array', items: { type: 'string' } },
        gaps: { type: 'array' },
      },
      required: [
        'schemaVersion',
        'skillDirs',
        'projectCategories',
        'coveredCategories',
        'gaps',
      ],
    },
    run(args) {
      const project = resolveUserPath(optionalString(args, 'project') ?? '.')
      prepareProject(project)
      const roots = (optionalStringArray(args, 'roots') ?? []).map(resolveUserPath)
      const withDefaults =
        optionalBoolean(args, 'defaults') ?? roots.length === 0
      const resolvedRoots = withDefaults
        ? [...roots, ...defaultSkillRoots(project)]
        : roots
      return gapsReport(
        resolvedRoots,
        project,
        optionalString(args, 'checklist'),
      )
    },
  },
  {
    name: 'scan',
    title: 'Scan project reality',
    description:
      "Report what the project really uses: declared dependencies, the import specifiers and identifiers its source imports, and file-level evidence per package. This is the ground truth every skill is scored against — read it before writing or fixing a skill.",
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT_PROPERTY },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        schemaVersion: SCHEMA_VERSION_PROPERTY,
        declaredDeps: { type: 'object' },
        usedImports: { type: 'object' },
        usedIdentifiers: { type: 'object' },
        importEvidence: { type: 'object' },
        config: { type: 'object' },
      },
      required: [
        'schemaVersion',
        'declaredDeps',
        'usedImports',
        'usedIdentifiers',
        'importEvidence',
        'config',
      ],
    },
    run(args) {
      const project = resolveUserPath(optionalString(args, 'project') ?? '.')
      return scanReport(project)
    },
  },
  {
    name: 'validate',
    title: 'Validate skills against the Agent Skills spec',
    description:
      'Lint one skill directory or every skill under a root against the Agent Skills specification: name format and directory match, description length, unknown frontmatter fields, metadata value types, body length.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Skill directory containing SKILL.md, or a skills root to scan recursively.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        schemaVersion: SCHEMA_VERSION_PROPERTY,
        count: { type: 'integer' },
        valid: { type: 'boolean' },
        results: { type: 'array' },
      },
      required: ['schemaVersion', 'count', 'valid', 'results'],
    },
    run(args) {
      const skillDirs = resolveSkillPath(
        resolveUserPath(requireString(args, 'path')),
      )
      return validateReport(validateSkills(skillDirs))
    },
  },
  {
    name: 'extract',
    title: 'Extract skill identifiers',
    description:
      'Parse a SKILL.md and report the packages, import specifiers, APIs and categories it claims, with locations.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Skill directory containing SKILL.md.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    run(args) {
      return envelope(
        extractSkillIdentifiers(resolveUserPath(requireString(args, 'path'))),
      )
    },
  },
  {
    name: 'spec-check',
    title: 'Static Website Specification check',
    description:
      'Statically scan the project against a curated subset of specification.website. Each item is pass, fail, or skip.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_PROPERTY,
        priority: {
          type: 'string',
          enum: ['required', 'recommended', 'optional', 'avoid'],
          description: 'Only report items of this priority.',
        },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    run(args) {
      const project = resolveUserPath(optionalString(args, 'project') ?? '.')
      return envelope(
        runSpecCompliance(
          project,
          optionalString(args, 'priority') as SpecPriority | undefined,
        ),
      )
    },
  },
  {
    name: 'docs',
    title: 'Describe the auditor surface',
    description:
      'Return the live taxonomy tables, deprecated-API rules, and project-config shape. Use this instead of guessing category names or frontmatter fields.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    run() {
      return envelope({
        taxonomy: {
          categories: CATEGORY_TAXONOMY,
          checklists: MUST_HAVE_CHECKLISTS,
          deprecatedApiRules: DEPRECATED_API_RULES,
        },
        config: {
          file: '.skill-auditor.json',
          fields: ['taxonomy', 'checklists', 'ignore'],
        },
        tools: MCP_TOOLS.map(t => t.name),
      })
    },
  },
  {
    name: 'scaffold',
    title: 'Generate a skill from repo evidence',
    description:
      "Write a SKILL.md for one taxonomy category using the project's real import evidence. Defaults to dryRun so you can inspect the contents before writing.",
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Taxonomy category or website-domain to cover.',
        },
        project: PROJECT_PROPERTY,
        out: {
          type: 'string',
          description: 'Directory to write the skill into. Defaults to cwd.',
          default: '.',
        },
        name: {
          type: 'string',
          description: 'Skill directory name. Defaults to the category.',
        },
        force: {
          type: 'boolean',
          description: 'Overwrite an existing SKILL.md.',
        },
        dryRun: {
          type: 'boolean',
          description:
            'Return the generated contents without writing. Defaults to true.',
          default: true,
        },
      },
      required: ['category'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    readOnly: false,
    run(args) {
      const project = resolveUserPath(optionalString(args, 'project') ?? '.')
      prepareProject(project)
      const repo = buildRepoReality(project)
      const dryRun = optionalBoolean(args, 'dryRun') ?? true
      return envelope(
        scaffoldSkill({
          category: requireString(args, 'category'),
          repo,
          outDir: resolveUserPath(optionalString(args, 'out') ?? '.'),
          name: optionalString(args, 'name'),
          force: optionalBoolean(args, 'force'),
          dryRun,
        }),
      )
    },
  },
]

function listResources(): {
  uri: string
  name: string
  description: string
  mimeType: string
}[] {
  const root = packageRoot()
  const resources: {
    uri: string
    name: string
    description: string
    mimeType: string
  }[] = [
    {
      uri: 'skill-auditor://bundled/skill-auditor',
      name: 'skill-auditor',
      description:
        'The installable agent skill that drives the audit-and-fix loop via the CLI.',
      mimeType: 'text/markdown',
    },
  ]
  const templatesDir = path.join(root, 'templates')
  if (fs.existsSync(templatesDir)) {
    for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!fs.existsSync(path.join(templatesDir, entry.name, 'SKILL.md'))) continue
      resources.push({
        uri: `skill-auditor://templates/${entry.name}`,
        name: entry.name,
        description: `Reference skill template: ${entry.name}`,
        mimeType: 'text/markdown',
      })
    }
  }
  return resources.sort((a, b) => a.uri.localeCompare(b.uri))
}

function readResource(uri: string): {
  uri: string
  mimeType: string
  text: string
} {
  const root = packageRoot()
  let file: string | undefined
  const template = uri.match(/^skill-auditor:\/\/templates\/([a-z0-9-]+)$/)
  if (template) {
    file = path.join(root, 'templates', template[1], 'SKILL.md')
  } else if (uri === 'skill-auditor://bundled/skill-auditor') {
    file = path.join(root, 'skills', 'skill-auditor', 'SKILL.md')
  }
  if (!file || !fs.existsSync(file)) {
    throw new Error(`Unknown resource: ${uri}`)
  }
  return { uri, mimeType: 'text/markdown', text: fs.readFileSync(file, 'utf-8') }
}

function listPrompts() {
  return [
    {
      name: 'audit-and-fix',
      title: 'Audit skills and fill gaps',
      description:
        'Walk the skill-auditor improvement loop: scan the project, audit installed skills, validate them, fill coverage gaps with scaffold, then re-audit.',
      arguments: [
        {
          name: 'skillsRoot',
          description: 'Skills directory to audit and write into (e.g. .cursor/skills).',
          required: true,
        },
        {
          name: 'project',
          description: 'Project root. Defaults to the server working directory.',
          required: false,
        },
      ],
    },
  ]
}

function getPrompt(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name !== 'audit-and-fix') {
    throw new Error(`Unknown prompt: ${name}`)
  }
  const skillsRoot = typeof args.skillsRoot === 'string' ? args.skillsRoot : '.cursor/skills'
  const project = typeof args.project === 'string' ? args.project : '.'
  const text = [
    `Audit and improve the Agent Skills under ${skillsRoot} for the project at ${project}.`,
    '',
    'Use the skill-auditor tools in this order:',
    '1. scan (project) — learn declaredDeps, usedImports, usedIdentifiers, importEvidence.',
    '2. validate (path = skills root) — fix error-severity spec violations first (name, description, frontmatter).',
    '3. audit (path = skills root, project) — read findings[].location and suggestions; rewrite those sections with repo-grounded examples. Do not pad references to raise the score.',
    '4. gaps (roots = [skills root], project, checklist = frontend) — for each gap, call scaffold with that category, out = skills root, dryRun = true; inspect, then call again with dryRun = false.',
    '5. audit again and stop when critical findings are gone and technical skills score at least 70, or when a suggestion does not fit the repo — tell the user instead of contorting the skill.',
    '',
    'Skip website-domain work unless the user asked for it. Prefer findings and suggestions over guessing. Every JSON payload starts with schemaVersion.',
  ].join('\n')
  return {
    description: 'Audit installed skills, validate them, and fill coverage gaps.',
    messages: [{ role: 'user', content: { type: 'text', text } }],
  }
}

function serverInfo() {
  return { name: 'skill-auditor', version: readPackageVersion() }
}

function result(
  id: string | number,
  payload: Record<string, unknown>,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      resultType: 'complete',
      ...payload,
      _meta: { [SERVER_INFO_KEY]: serverInfo() },
    },
  }
}

function failure(
  id: string | number | undefined,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    ...(id === undefined ? {} : { id }),
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Rejects requests declaring a protocol version this server does not speak.
 * A modern request must also carry its capabilities, since there is no
 * handshake left to learn them from.
 */
function protocolViolation(
  id: string | number,
  params: Record<string, unknown>,
): JsonRpcResponse | null {
  const meta = asRecord(params._meta)
  const requested = meta[PROTOCOL_VERSION_KEY]
  if (requested === undefined) return null

  if (
    typeof requested !== 'string' ||
    !SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
  ) {
    return failure(id, UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
      supported: SUPPORTED_PROTOCOL_VERSIONS,
      requested,
    })
  }

  if (requested === MODERN_PROTOCOL_VERSION && !(CLIENT_CAPABILITIES_KEY in meta)) {
    return failure(
      id,
      INVALID_PARAMS,
      `Missing required _meta field "${CLIENT_CAPABILITIES_KEY}".`,
    )
  }

  return null
}

/** Legacy clients negotiate once; echo their version when we speak it. */
function negotiateLegacyVersion(params: Record<string, unknown>): string {
  const requested = params.protocolVersion
  return typeof requested === 'string' &&
    SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LEGACY_PROTOCOL_VERSIONS[0]
}

function callTool(
  id: string | number,
  params: Record<string, unknown>,
): JsonRpcResponse {
  const name = params.name
  const tool = MCP_TOOLS.find(candidate => candidate.name === name)
  if (!tool) {
    return failure(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`)
  }

  try {
    const payload = toPlainJson(tool.run(asRecord(params.arguments)))
    return result(id, {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      isError: false,
    })
  } catch (err) {
    // A failed audit is a tool-execution error, not a protocol error: report it
    // in-band so the model can correct the arguments and retry.
    const message = err instanceof Error ? err.message : String(err)
    return result(id, {
      content: [{ type: 'text', text: `${tool.name} failed: ${message}` }],
      isError: true,
    })
  }
}

/**
 * Handles one decoded JSON-RPC message. Returns the response to write back, or
 * null for notifications, which take no reply.
 */
export function handleMessage(message: unknown): JsonRpcResponse | null {
  const request = asRecord(message)
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return failure(undefined, INVALID_REQUEST, 'Invalid JSON-RPC request')
  }

  const id = request.id
  const method = request.method
  const params = asRecord(request.params)

  if (typeof id !== 'string' && typeof id !== 'number') {
    return null // notification: nothing to reply to, and none require action
  }

  const violation = protocolViolation(id, params)
  if (violation) return violation

  switch (method) {
    case 'server/discover':
      return result(id, {
        ttlMs: 0,
        supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
        capabilities: CAPABILITIES,
        instructions: SERVER_INSTRUCTIONS,
      })

    case 'initialize':
      return result(id, {
        protocolVersion: negotiateLegacyVersion(params),
        capabilities: CAPABILITIES,
        serverInfo: serverInfo(),
        instructions: SERVER_INSTRUCTIONS,
      })

    case 'tools/list':
      return result(id, { ttlMs: 0, tools: MCP_TOOLS.map(toolDescriptor) })

    case 'tools/call':
      return callTool(id, params)

    case 'resources/list':
      return result(id, { resources: listResources() })

    case 'resources/read':
      try {
        return result(id, { contents: [readResource(String(params.uri ?? ''))] })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return failure(id, INVALID_PARAMS, message)
      }

    case 'prompts/list':
      return result(id, { prompts: listPrompts() })

    case 'prompts/get':
      try {
        return result(id, getPrompt(String(params.name ?? ''), asRecord(params.arguments)))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return failure(id, INVALID_PARAMS, message)
      }

    case 'ping':
      return result(id, {})

    default:
      return failure(id, METHOD_NOT_FOUND, `Unknown method: ${method}`)
  }
}

function toolDescriptor(tool: McpTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: tool.readOnly !== false,
      destructiveHint: false,
      idempotentHint: tool.readOnly !== false,
      openWorldHint: false,
    },
  }
}

/**
 * Serves MCP over stdio: newline-delimited JSON-RPC in, the same out. Nothing
 * but protocol messages may reach stdout, so diagnostics go to stderr.
 */
export function runMcpServer(options: { confine?: boolean } = {}): void {
  confineToCwd = Boolean(options.confine)
  const send = (response: JsonRpcResponse) => {
    process.stdout.write(JSON.stringify(response) + '\n')
  }

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })

  lines.on('line', line => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return

    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      // No id can be recovered from an unparseable line, and the current schema
      // allows omitting it.
      send(failure(undefined, PARSE_ERROR, 'Parse error'))
      return
    }

    const response = handleMessage(message)
    if (response) send(response)
  })

  // Closed stdin is the portable shutdown signal for a stdio server. Ending
  // here means the process exits once the event loop drains, rather than
  // process.exit() dropping stdout writes still queued on the pipe.
  lines.on('close', () => {
    process.exitCode = 0
  })
}
