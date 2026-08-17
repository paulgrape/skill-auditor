import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FAKE_PROJECT, runExpectingFailure } from './helpers.mjs'

const ALIGNED = './fixtures/aligned-skill'

describe('--min-score', () => {
  test('passes when every scored skill clears the threshold', () => {
    const { status } = runExpectingFailure([
      'audit',
      ALIGNED,
      '--project',
      FAKE_PROJECT,
      '--min-score',
      '85',
      '--json',
    ])
    assert.equal(status, 0)
  })

  test('exits 1 and names the offender below the threshold', () => {
    const { status, stderr } = runExpectingFailure([
      'audit',
      ALIGNED,
      '--project',
      FAKE_PROJECT,
      '--min-score',
      '100',
    ])
    assert.equal(status, 1)
    assert.match(stderr, /below the --min-score threshold of 100/)
    assert.match(stderr, /aligned-skill/)
  })

  test('ignores neutral skills, which have no score to gate on', () => {
    const { status } = runExpectingFailure([
      'audit',
      './fixtures/neutral-skill',
      '--project',
      FAKE_PROJECT,
      '--min-score',
      '100',
      '--json',
    ])
    assert.equal(status, 0)
  })

  test('applies to every skill under a root in audit-all', () => {
    const { status } = runExpectingFailure([
      'audit-all',
      './fixtures/nested-skills',
      '--project',
      FAKE_PROJECT,
      '--min-score',
      '100',
      '--json',
    ])
    assert.equal(status, 1)
  })

  test('rejects values that are not a 0-100 number', () => {
    for (const value of ['abc', '-1', '101']) {
      const { status, stderr } = runExpectingFailure([
        'audit',
        ALIGNED,
        '--project',
        FAKE_PROJECT,
        '--min-score',
        value,
      ])
      assert.equal(status, 2, value)
      assert.match(stderr, /Invalid --min-score/)
    }
  })

  test('is off by default', () => {
    const { status } = runExpectingFailure([
      'audit',
      ALIGNED,
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    assert.equal(status, 0)
  })
})
