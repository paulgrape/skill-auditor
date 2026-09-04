import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseJson, run, runExpectingFailure } from './helpers.mjs'

describe('validate', () => {
  test('accepts a spec-compliant skill', () => {
    const payload = parseJson(['validate', './fixtures/aligned-skill', '--json'])
    assert.equal(payload.valid, true)
    assert.equal(payload.count, 1)
    assert.equal(payload.results[0].valid, true)
  })

  test('reports spec violations and exits 1', () => {
    const { status, stdout } = runExpectingFailure([
      'validate',
      './fixtures/invalid-skill',
      '--json',
    ])
    assert.equal(status, 1)
    const payload = JSON.parse(stdout)
    assert.equal(payload.valid, false)
    const rules = payload.results[0].violations.map(v => v.rule)
    assert.ok(rules.includes('name-format'))
    assert.ok(rules.includes('name-matches-directory'))
    assert.ok(rules.includes('categories-not-in-metadata'))
    assert.ok(rules.includes('compatibility-type'))
    assert.ok(rules.includes('unknown-field'))
    assert.ok(rules.includes('client-extension-field'))
    assert.ok(rules.includes('description-trigger'))
  })

  test('reads metadata.categories as the spec-conformant form', () => {
    const extracted = parseJson(['extract', './templates/website-accessibility'])
    assert.deepEqual(extracted.categories, ['accessibility'])
    const validated = parseJson([
      'validate',
      './templates/website-accessibility',
      '--json',
    ])
    assert.equal(validated.valid, true)
    assert.ok(
      !validated.results[0].violations.some(
        v => v.rule === 'categories-not-in-metadata',
      ),
    )
  })

  test('text output names VALID / INVALID', () => {
    const { stdout, status } = runExpectingFailure([
      'validate',
      './fixtures/invalid-skill',
    ])
    assert.equal(status, 1)
    assert.match(stdout, /INVALID/)
  })
})
