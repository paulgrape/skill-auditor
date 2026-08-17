import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseJson } from './helpers.mjs'

describe('workspace dependencies', () => {
  test('merges npm/yarn workspace package.json deps', () => {
    const scan = parseJson(['scan', './fixtures/monorepo-project'])
    assert.equal(scan.declaredDeps.next, '^15.0.0')
    assert.equal(scan.declaredDeps['@tanstack/react-query'], '^5.0.0')
    assert.equal(scan.declaredDeps.tailwindcss, '^4.0.0')
    assert.equal(scan.declaredDeps.typescript, '^5.0.0')
  })

  test('merges pnpm-workspace.yaml package deps', () => {
    const scan = parseJson(['scan', './fixtures/pnpm-monorepo'])
    assert.equal(scan.declaredDeps.zustand, '^5.0.0')
    assert.equal(scan.declaredDeps['react-hook-form'], '^7.0.0')
    assert.equal(scan.declaredDeps.zod, '^3.0.0')
  })

  test('honours negated workspace globs', () => {
    const scan = parseJson(['scan', './fixtures/pnpm-monorepo'])
    assert.ok(!('mobx' in scan.declaredDeps))
  })

  test('workspace stack drives gap detection', () => {
    const gaps = parseJson([
      'gaps',
      './fixtures/neutral-skill',
      '--project',
      './fixtures/monorepo-project',
      '--json',
    ])
    assert.ok(gaps.projectCategories.includes('routing'))
    assert.ok(gaps.projectCategories.includes('data-fetching'))
    assert.ok(gaps.projectCategories.includes('styling'))
  })

  test('a single-package project is unaffected', () => {
    const scan = parseJson(['scan', './fixtures/fake-project'])
    assert.deepEqual(Object.keys(scan.declaredDeps).sort(), [
      'next',
      'react',
      'zustand',
    ])
  })
})
