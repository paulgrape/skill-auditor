import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { repoRoot, runExpectingFailure } from './helpers.mjs'

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

  test('documents runnable commands', () => {
    assert.ok(commands.length >= 6, `found only ${commands.length} commands`)
  })

  for (const command of commands) {
    test(`CLI accepts: skill-auditor ${command}`, () => {
      const { stderr } = runExpectingFailure(command.split(/\s+/))
      // A non-zero exit is expected (findings, gaps, failing spec items); a
      // usage or runtime error is not.
      assert.doesNotMatch(stderr, /\b[Ee]rror:/, stderr)
    })
  }
})
