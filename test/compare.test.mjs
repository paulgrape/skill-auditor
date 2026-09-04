import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  FAKE_PROJECT,
  parseJson,
  run,
  runExpectingFailure,
} from './helpers.mjs'

describe('compare and --baseline', () => {
  const aligned = parseJson([
    'audit',
    './fixtures/aligned-skill',
    '--project',
    FAKE_PROJECT,
    '--json',
  ])
  const stuffed = parseJson([
    'audit',
    './fixtures/stuffed-skill',
    '--project',
    FAKE_PROJECT,
    '--json',
  ])

  test('compare reports a regression when the later audit is worse', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-compare-'))
    const before = path.join(dir, 'before.json')
    const after = path.join(dir, 'after.json')
    fs.writeFileSync(before, JSON.stringify(aligned))
    fs.writeFileSync(
      after,
      JSON.stringify({
        ...stuffed,
        results: stuffed.results.map(r => ({
          ...r,
          report: { ...r.report, skillName: aligned.results[0].report.skillName },
        })),
      }),
    )
    try {
      const payload = parseJson(['compare', before, after, '--json'])
      assert.equal(payload.summary.regressed, 1)
      const { status } = runExpectingFailure([
        'compare',
        before,
        after,
        '--fail-on-regression',
        '--json',
      ])
      assert.equal(status, 1)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('--format markdown and sarif emit those formats', () => {
    const { stdout: md } = run([
      'audit',
      './fixtures/aligned-skill',
      '--project',
      FAKE_PROJECT,
      '--format',
      'markdown',
    ])
    assert.match(md, /## Skill audit/)
    assert.match(md, /aligned-skill/)

    const { stdout: sarif } = run(
      [
        'audit',
        './fixtures/stuffed-skill',
        '--project',
        FAKE_PROJECT,
        '--format',
        'sarif',
      ],
      { allowFail: true },
    )
    const parsed = JSON.parse(sarif)
    assert.equal(parsed.version, '2.1.0')
    assert.ok(parsed.runs[0].results.length > 0)
    assert.equal(parsed.runs[0].tool.driver.name, 'skill-auditor')
  })

  test('rejects an unknown --format with exit 2', () => {
    const { status, stderr } = runExpectingFailure([
      'audit',
      './fixtures/aligned-skill',
      '--project',
      FAKE_PROJECT,
      '--format',
      'xml',
    ])
    assert.equal(status, 2)
    assert.match(stderr, /Invalid --format/)
  })
})
