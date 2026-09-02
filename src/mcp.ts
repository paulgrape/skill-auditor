import { createInterface } from 'node:readline'
import { defaultSkillRoots, resolveSkillPath } from './discoverSkills.js'
import { toPlainJson } from './envelope.js'
import { buildRepoReality } from './repoReality.js'
import {
  auditReport,
  auditSkillsSafely,
  gapsReport,
  scanReport,
} from './reports.js'
import { MUST_HAVE_CHECKLISTS } from './taxonomy.js'
import { readPackageVersion } from './version.js'

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
  'Call scan to learn what the project actually depends on, audit to score skills and get findings with suggestions, and gaps to find stack categories no installed skill covers.',
  'Every tool returns the same versioned JSON payload as the CLI: read schemaVersion before parsing the rest.',
  'Paths are resolved relative to the working directory the server was started in.',
].join(' ')

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
      const project = optionalString(args, 'project') ?? '.'
      const repo = buildRepoReality(project)
      const skillDirs = resolveSkillPath(requireString(args, 'path'))
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
          enum: Object.keys(MUST_HAVE_CHECKLISTS),
          description:
            'Must-have checklist to measure coverage against, on top of the categories the project actually uses.',
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
      const project = optionalString(args, 'project') ?? '.'
      const roots = optionalStringArray(args, 'roots') ?? []
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
      },
      required: [
        'schemaVersion',
        'declaredDeps',
        'usedImports',
        'usedIdentifiers',
        'importEvidence',
      ],
    },
    run(args) {
      return scanReport(optionalString(args, 'project') ?? '.')
    },
  },
]

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
        capabilities: { tools: {} },
        instructions: SERVER_INSTRUCTIONS,
      })

    case 'initialize':
      return result(id, {
        protocolVersion: negotiateLegacyVersion(params),
        capabilities: { tools: {} },
        serverInfo: serverInfo(),
        instructions: SERVER_INSTRUCTIONS,
      })

    case 'tools/list':
      return result(id, { ttlMs: 0, tools: MCP_TOOLS.map(toolDescriptor) })

    case 'tools/call':
      return callTool(id, params)

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
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }
}

/**
 * Serves MCP over stdio: newline-delimited JSON-RPC in, the same out. Nothing
 * but protocol messages may reach stdout, so diagnostics go to stderr.
 */
export function runMcpServer(): void {
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
