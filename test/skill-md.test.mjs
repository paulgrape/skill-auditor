import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { repoRoot, run, runExpectingFailure } from './helpers.mjs'

/**
 * `$BASELINE` in the skill is a saved audit payload; the test writes a real
 * one so the documented --baseline commands run against an existing file.
 * Written before any test so the extraction can be synchronous.
 */
const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-skill-md-'))
const baselineFile = path.join(baselineDir, 'baseline.json')
const afterFile = path.join(baselineDir, 'after.json')
const auditPayload = run(
  ['audit', './fixtures/nested-skills', '--project', './fixtures/fake-project', '--json'],
  { allowFail: true },
).stdout
fs.writeFileSync(baselineFile, auditPayload)
fs.writeFileSync(afterFile, auditPayload)

/**
 * Extracts every `skill-auditor ...` invocation from the bundled skill so the
 * skill and the CLI cannot drift apart silently: a command the skill tells an
 * agent to run must actually parse.
 */
function documentedCommands() {
  const raw = fs.readFileSync(
    path.join(repoRoot, 'skills/skill-auditor/SKILL.md'),
    'utf-8',
  )
  const commands = new Set()
  for (const rawLine of raw.split('\n')) {
    const line = rawLine
      .trim()
      .replace(/^npx -y skill-auditor@latest\s+/, 'skill-auditor ')
    const match = line.match(/^skill-auditor\s+(.+)$/)
    // Placeholder-bearing lines (`<skillDir>`, backticks) are prose, not runnable.
    if (!match || /[<`]/.test(match[1])) continue
    commands.add(
      match[1]
        .replaceAll('$SKILLS_ROOT', './fixtures/nested-skills')
        .replaceAll('$PROJECT', './fixtures/fake-project'),
    )
  }
  return [...commands]
}

describe('bundled SKILL.md', () => {
  const commands = documentedCommands()

  after(() => fs.rmSync(baselineDir, { recursive: true, force: true }))

  test('documents runnable commands', () => {
    assert.ok(commands.length >= 6, `found only ${commands.length} commands`)
  })

  test('documents the baseline loop', () => {
    assert.ok(commands.some(command => command.includes('--baseline')))
    assert.ok(commands.some(command => command.includes('--fail-on-regression')))
    assert.ok(commands.some(command => command.startsWith('compare ')))
  })

  for (const command of commands) {
    test(`CLI accepts: skill-auditor ${command}`, () => {
      // Substituted after splitting: a temp path may contain spaces.
      const args = command.split(/\s+/).map(arg => {
        if (arg === '$BASELINE') return baselineFile
        if (arg === '$AFTER') return afterFile
        return arg
      })
      const { stderr } = runExpectingFailure(args)
      // A non-zero exit is expected (findings, gaps, failing spec items); a
      // usage or runtime error is not.
      assert.doesNotMatch(stderr, /\b[Ee]rror:/, stderr)
    })
  }
})
