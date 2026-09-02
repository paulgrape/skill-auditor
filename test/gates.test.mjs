import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  FAKE_PROJECT,
  parseJson,
  run,
  runExpectingFailure,
} from './helpers.mjs'

const ALIGNED = './fixtures/aligned-skill'
const STUFFED = './fixtures/stuffed-skill' // critical + warning findings
const NEUTRAL = './fixtures/neutral-skill' // no findings at all

function audit(skill, ...extra) {
  return runExpectingFailure([
    'audit',
    skill,
    '--project',
    FAKE_PROJECT,
    '--json',
    ...extra,
  ])
}

describe('--fail-on', () => {
  test('fails on critical findings by default and passes a clean skill', () => {
    assert.equal(audit(STUFFED).status, 1)
    assert.equal(audit(ALIGNED).status, 0)
  })

  test('lowers the bar to warnings and infos when asked', () => {
    const { results } = parseJson([
      'audit',
      STUFFED,
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    const severities = new Set(results[0].report.findings.map(f => f.severity))
    assert.ok(severities.has('warning'), 'fixture must carry a warning')

    assert.equal(audit(STUFFED, '--fail-on', 'warning').status, 1)
    assert.equal(audit(STUFFED, '--fail-on', 'info').status, 1)
    // A skill with no findings passes at every level.
    assert.equal(audit(NEUTRAL, '--fail-on', 'info').status, 0)
  })

  test('rejects an unknown severity with exit code 2', () => {
    const { status, stderr } = audit(ALIGNED, '--fail-on', 'severe')
    assert.equal(status, 2)
    assert.match(stderr, /Invalid --fail-on "severe"/)
  })

  test('applies to audit-all as well', () => {
    const auditAll = (...roots) =>
      runExpectingFailure([
        'audit-all',
        ...roots,
        '--project',
        FAKE_PROJECT,
        '--fail-on',
        'warning',
        '--json',
      ]).status
    // nested-skills are clean; adding the stuffed skill trips the gate.
    assert.equal(auditAll('./fixtures/nested-skills'), 0)
    assert.equal(auditAll('./fixtures/nested-skills', STUFFED), 1)
  })
})

describe('--fail-on-gap', () => {
  test('exits 1 when a gap exists and 0 when coverage is complete', () => {
    const withGaps = runExpectingFailure([
      'gaps',
      NEUTRAL,
      '--project',
      FAKE_PROJECT,
      '--fail-on-gap',
      '--json',
    ])
    assert.equal(withGaps.status, 1)
    assert.ok(JSON.parse(withGaps.stdout).gaps.length > 0)

    const covered = runExpectingFailure([
      'gaps',
      './templates',
      '--project',
      FAKE_PROJECT,
      '--checklist',
      'website',
      '--fail-on-gap',
      '--json',
    ])
    assert.equal(covered.status, 0)
    assert.deepEqual(JSON.parse(covered.stdout).gaps, [])
  })

  test('is off by default', () => {
    const { status } = runExpectingFailure([
      'gaps',
      NEUTRAL,
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    assert.equal(status, 0)
  })
})

describe('gaps', () => {
  test('rejects an unknown checklist with exit code 2 instead of ignoring it', () => {
    const { status, stderr } = runExpectingFailure([
      'gaps',
      './fixtures/nested-skills',
      '--project',
      FAKE_PROJECT,
      '--checklist',
      'frontned',
    ])
    assert.equal(status, 2)
    assert.match(stderr, /Unknown checklist "frontned"/)
    assert.match(stderr, /frontend, website/)
  })

  test('scans the working directory when no roots are given', () => {
    const gaps = parseJson(['gaps', '--project', '../fake-project', '--json'], {
      cwd: './fixtures/nested-skills',
    })
    assert.equal(gaps.skillDirs.length, 2)
    assert.ok(gaps.coveredCategories.includes('routing'))
  })

  test('lists the valid checklist keys in --help', () => {
    const { stdout } = run(['gaps', '--help'])
    assert.match(stdout, /frontend\|website/)
  })
})

describe('unreadable skills', () => {
  const BROKEN = './fixtures/broken-skill' // SKILL.md is a directory

  test('are reported in errors without aborting the audit, and fail the run', () => {
    const { status, stdout, stderr } = audit(BROKEN)
    assert.equal(status, 1)
    const payload = JSON.parse(stdout)
    assert.equal(payload.count, 0)
    assert.deepEqual(payload.results, [])
    assert.equal(payload.errors.length, 1)
    assert.match(payload.errors[0].skillDir, /broken-skill/)
    assert.ok(payload.errors[0].error.length > 0)
    assert.match(stderr, /Could not audit .*broken-skill/)
  })

  test('errors is always present and empty on a clean run', () => {
    const payload = JSON.parse(audit(ALIGNED).stdout)
    assert.deepEqual(payload.errors, [])
  })
})
