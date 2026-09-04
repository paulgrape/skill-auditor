import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const cliPath = path.join(repoRoot, 'dist/cli.js')

/**
 * Runs the built CLI. Commands are expected to succeed unless `allowFail` is
 * set — and even then stderr is preserved on the result, because a swallowed
 * stderr turns a crash into a confusing JSON parse error downstream.
 */
export function run(args, { allowFail = false, cwd = repoRoot } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], {
      encoding: 'utf-8',
      cwd: path.resolve(repoRoot, cwd),
    })
    return { stdout, stderr: '', status: 0 }
  } catch (err) {
    const stdout = err.stdout?.toString() ?? ''
    const stderr = err.stderr?.toString() ?? ''
    if (allowFail) return { stdout, stderr, status: err.status ?? 1 }
    throw new Error(
      `skill-auditor ${args.join(' ')} failed with status ${err.status}\n${stderr || stdout}`,
    )
  }
}

/** Runs a command that is expected to exit non-zero, returning its result. */
export function runExpectingFailure(args, options = {}) {
  return run(args, { ...options, allowFail: true })
}

/**
 * Runs a command and parses its JSON stdout. Reports stderr on a parse
 * failure so CLI errors surface as themselves rather than as syntax errors.
 */
export function parseJson(args, options = {}) {
  const { stdout, stderr } = run(args, { allowFail: true, ...options })
  try {
    return JSON.parse(stdout)
  } catch (err) {
    throw new Error(
      `skill-auditor ${args.join(' ')} did not emit JSON: ${err.message}\n` +
        `stderr: ${stderr || '(empty)'}\nstdout: ${stdout.slice(0, 500) || '(empty)'}`,
    )
  }
}

/**
 * Drives the MCP server over a real stdio pipe: writes each message as a
 * line, closes stdin and returns every JSON-RPC message it wrote back.
 * Strings are written verbatim, so a test can send malformed input.
 */
export function runMcp(messages, { cwd = repoRoot } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, 'mcp'], {
      cwd: path.resolve(repoRoot, cwd),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', status => {
      try {
        const responses = stdout
          .split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => JSON.parse(line))
        resolve({ responses, stderr, status })
      } catch (err) {
        reject(
          new Error(
            `MCP server did not emit newline-delimited JSON: ${err.message}\n` +
              `stdout: ${stdout.slice(0, 500)}\nstderr: ${stderr || '(empty)'}`,
          ),
        )
      }
    })
    for (const message of messages) {
      const line =
        typeof message === 'string' ? message : JSON.stringify(message)
      child.stdin.write(line + '\n')
    }
    child.stdin.end()
  })
}

export const FAKE_PROJECT = './fixtures/fake-project'

/** Builds a SkillIdentifiers-shaped object for unit tests of the scoring core. */
export function makeSkill({
  packages = [],
  importSpecifiers = [],
  apiCalls = [],
  substantiation = 'usage',
  substantiatedByProse = true,
  importedIdentifiers = {},
  unusedImportCount = 0,
  codeEvidence = { codeFences: 0, shellFences: 0 },
} = {}) {
  return {
    skillName: 'test-skill',
    // No SKILL.md here, so intrinsic quality is 0 and never masks the math.
    skillPath: path.join(repoRoot, 'fixtures/does-not-exist'),
    categories: new Set(),
    packages: new Set(packages),
    importSpecifiers: new Set(importSpecifiers),
    apiCalls: new Set(apiCalls),
    packageRefs: Object.fromEntries(
      packages.map(p => [
        p,
        { packageName: p, substantiation, substantiatedByProse },
      ]),
    ),
    importedIdentifiers: Object.fromEntries(
      Object.entries(importedIdentifiers).map(([k, v]) => [k, new Set(v)]),
    ),
    unusedImportCount,
    locations: { packages: {}, importSpecifiers: {}, apiCalls: {} },
    codeEvidence,
  }
}

/** Builds a RepoReality-shaped object for unit tests of the scoring core. */
export function makeRepo({
  declaredDeps = {},
  usedImports = {},
  usedIdentifiers = {},
} = {}) {
  return {
    declaredDeps,
    usedImports: Object.fromEntries(
      Object.entries(usedImports).map(([k, v]) => [k, new Set(v)]),
    ),
    usedIdentifiers: Object.fromEntries(
      Object.entries(usedIdentifiers).map(([k, v]) => [k, new Set(v)]),
    ),
    importEvidence: {},
  }
}
