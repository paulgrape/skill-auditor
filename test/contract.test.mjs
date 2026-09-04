import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FAKE_PROJECT, parseJson, run } from './helpers.mjs'

/**
 * One invocation per command that emits JSON, so the documented contract can
 * be checked against what the CLI actually prints.
 */
const JSON_INVOCATIONS = {
  scan: ['scan', FAKE_PROJECT],
  extract: ['extract', './fixtures/aligned-skill'],
  audit: ['audit', './fixtures/aligned-skill', '-p', FAKE_PROJECT, '--json'],
  'audit-all': [
    'audit-all',
    './fixtures/nested-skills',
    '-p',
    FAKE_PROJECT,
    '--json',
  ],
  list: ['list', './fixtures/nested-skills', '--json'],
  gaps: ['gaps', './fixtures/nested-skills', '-p', FAKE_PROJECT, '--json'],
  'spec-check': ['spec-check', './fixtures/website-project', '--json'],
  docs: ['docs'],
  validate: ['validate', './fixtures/aligned-skill', '--json'],
  scaffold: [
    'scaffold',
    'routing',
    '-p',
    FAKE_PROJECT,
    '--dry-run',
    '--json',
  ],
}

const docs = parseJson(['docs'])

/** Command names as commander prints them in `--help`, one per indented line. */
function helpCommandNames() {
  const { stdout } = run(['--help'])
  return stdout
    .slice(stdout.indexOf('Commands:'))
    .split('\n')
    .map(line => line.match(/^ {2}(\S+)/)?.[1])
    .filter(name => name !== undefined && name !== 'help')
}

describe('json envelope', () => {
  for (const [command, args] of Object.entries(JSON_INVOCATIONS)) {
    test(`${command} stamps the schema version`, () => {
      assert.equal(parseJson(args).schemaVersion, docs.envelope.value)
    })
  }

  test('audit always returns an array, single skill or not', () => {
    const single = parseJson(JSON_INVOCATIONS.audit)
    const many = parseJson(JSON_INVOCATIONS['audit-all'])
    assert.equal(single.count, 1)
    assert.equal(single.results.length, 1)
    assert.equal(many.count, many.results.length)
    assert.ok(many.count > 1)
    for (const result of [...single.results, ...many.results]) {
      assert.deepEqual(Object.keys(result).sort(), [
        'report',
        'score',
        'skillDir',
        'suggestions',
      ])
    }
  })
})

describe('docs', () => {
  test('describes every command the CLI registers', () => {
    assert.deepEqual(
      docs.commands.map(command => command.name).sort(),
      helpCommandNames().sort(),
    )
  })

  test('describes the output and exit codes of every command', () => {
    for (const command of docs.commands) {
      assert.ok(command.output, `${command.name} has no documented output`)
      assert.ok(command.output.description.length > 0, command.name)
      assert.ok(command.output.exitCodes.length > 0, command.name)
    }
  })

  test('documented fields match the real payloads', () => {
    for (const command of docs.commands) {
      // The MCP server writes protocol messages, not a report; compare needs
      // two saved payloads and is covered in compare.test.mjs.
      if (command.name === 'mcp' || command.name === 'compare') continue

      const args = JSON_INVOCATIONS[command.name]
      assert.ok(args, `${command.name} has no JSON invocation under test`)
      const payload = parseJson(args)
      assert.deepEqual(
        Object.keys(payload)
          .filter(key => key !== 'schemaVersion')
          .sort(),
        [...command.output.fields].sort(),
        command.name,
      )
    }
  })

  test('reports arguments and flags as the commands declare them', () => {
    const audit = docs.commands.find(command => command.name === 'audit')
    assert.deepEqual(audit.arguments[0], {
      name: 'path',
      required: true,
      variadic: false,
      description:
        'skill directory or skills root (scans nested SKILL.md recursively)',
    })
    const minScore = audit.options.find(option => option.name === 'minScore')
    assert.equal(minScore.flags, '-m, --min-score <n>')
    assert.equal(minScore.takesValue, true)
    const json = audit.options.find(option => option.name === 'json')
    assert.equal(json.takesValue, false)
  })

  test('--json is accepted even though docs output is always JSON', () => {
    assert.deepEqual(parseJson(['docs', '--json']), docs)
  })
})
