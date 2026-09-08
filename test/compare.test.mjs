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

  test('audit --baseline attaches the comparison and --fail-on-regression gates on it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-baseline-'))
    const baseline = path.join(dir, 'baseline.json')
    try {
      // A baseline in which the stuffed skill scored like the aligned one, so
      // auditing it now is a regression.
      fs.writeFileSync(
        baseline,
        JSON.stringify({
          ...aligned,
          results: aligned.results.map(r => ({
            ...r,
            report: { ...r.report, skillName: stuffed.results[0].report.skillName },
          })),
        }),
      )
      const payload = parseJson([
        'audit',
        './fixtures/stuffed-skill',
        '--project',
        FAKE_PROJECT,
        '--baseline',
        baseline,
        '--json',
      ])
      assert.equal(payload.comparison.summary.regressed, 1)
      assert.equal(payload.comparison.skills[0].before.overall, aligned.results[0].score.overall)
      assert.equal(payload.comparison.skills[0].after.overall, stuffed.results[0].score.overall)

      const { status } = runExpectingFailure([
        'audit',
        './fixtures/stuffed-skill',
        '--project',
        FAKE_PROJECT,
        '--baseline',
        baseline,
        '--fail-on-regression',
        '--json',
      ])
      assert.equal(status, 1)

      // Against itself nothing regresses. Use the aligned skill so default
      // `--fail-on critical` does not also fire (stuffed carries criticals).
      fs.writeFileSync(baseline, JSON.stringify(aligned))
      const { status: sameStatus } = runExpectingFailure([
        'audit',
        './fixtures/aligned-skill',
        '--project',
        FAKE_PROJECT,
        '--baseline',
        baseline,
        '--fail-on-regression',
        '--json',
      ])
      assert.equal(sameStatus, 0)

      const { status: missing, stderr } = runExpectingFailure([
        'audit',
        './fixtures/aligned-skill',
        '--project',
        FAKE_PROJECT,
        '--baseline',
        path.join(dir, 'nope.json'),
        '--json',
      ])
      assert.equal(missing, 1)
      assert.match(stderr, /Cannot read audit payload .*nope\.json/)
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
