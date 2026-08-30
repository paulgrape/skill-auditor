import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FAKE_PROJECT, parseJson } from './helpers.mjs'

describe('non-package specifiers', () => {
  const extracted = parseJson(['extract', './fixtures/builtin-skill'])

  test('node builtins are not counted as packages', () => {
    assert.deepEqual(extracted.packages, [])
    for (const specifier of ['node:fs', 'path']) {
      assert.ok(!extracted.importSpecifiers.includes(specifier), specifier)
    }
  })

  test('path aliases and subpath imports are not counted as packages', () => {
    for (const specifier of [
      '@/components/Button',
      '~/styles/theme',
      '#internal/logger',
    ]) {
      assert.ok(!extracted.importSpecifiers.includes(specifier), specifier)
    }
  })

  test('a skill referencing only non-packages produces no findings', () => {
    const { results } = parseJson([
      'audit',
      './fixtures/builtin-skill',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    assert.deepEqual(results[0].report.findings, [])
    assert.equal(results[0].report.scorableReferenceCount, 0)
    assert.equal(results[0].score.breakdown.specificity, 0)
  })
})

describe('skill metadata', () => {
  test('reads name and categories from frontmatter only', () => {
    const extracted = parseJson(['extract', './templates/website-accessibility'])
    assert.equal(extracted.skillName, 'website-accessibility')
    assert.ok(extracted.categories.includes('accessibility'))
  })

  test('does not pick up example frontmatter from the body', () => {
    // The bundled skill documents a template containing `name: <project>-<category>`.
    const extracted = parseJson(['extract', './skills/skill-auditor'])
    assert.equal(extracted.skillName, 'skill-auditor')
    assert.deepEqual(extracted.categories, [])
  })
})
