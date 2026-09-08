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

describe('multi-module repositories', () => {
  test('every go.mod module is local: a second module is not a dependency of the first', () => {
    const scan = parseJson(['scan', './fixtures/go-multimodule', '--no-cache'])
    assert.deepEqual(scan.ecosystems, ['go'])
    assert.deepEqual(Object.keys(scan.declaredDeps).sort(), [
      'github.com/gin-gonic/gin',
      'github.com/robfig/cron',
    ])
    assert.deepEqual(Object.keys(scan.usedImports).sort(), [
      'github.com/gin-gonic/gin',
      'github.com/robfig/cron',
    ])
    assert.deepEqual(scan.usedImports['github.com/robfig/cron'], ['github.com/robfig/cron/v3'])
    assert.deepEqual(scan.usedIdentifiers['github.com/robfig/cron'], ['cron'])
  })

  test('requirements.txt -r includes are dropped, not followed', () => {
    // Following -r/-c is a 2.1 item; this fixture pins the 2.0 contract so a
    // later change cannot silently start treating include files as the stack.
    const scan = parseJson(['scan', './fixtures/python-requirements-include', '--no-cache'])
    assert.deepEqual(scan.ecosystems, ['python'])
    assert.equal(scan.declaredDeps.flask, '>=3.0')
    assert.ok(!('requests' in scan.declaredDeps))
    assert.deepEqual(Object.keys(scan.usedImports).sort(), ['flask', 'requests'])
  })

  test('a Cargo workspace merges every member manifest and workspace.dependencies', () => {
    const scan = parseJson(['scan', './fixtures/cargo-workspace', '--no-cache'])
    assert.deepEqual(scan.ecosystems, ['cargo'])
    // Root first: the workspace table's version wins over the member's `workspace = true`.
    assert.equal(scan.declaredDeps.serde, '1')
    assert.equal(scan.declaredDeps.anyhow, '1')
    assert.equal(scan.declaredDeps.clap, '4')
    assert.deepEqual(scan.usedImports.serde, ['serde'])
    assert.deepEqual(scan.usedImports.anyhow, ['anyhow'])
    assert.deepEqual(scan.usedImports.clap, ['clap'])
    assert.deepEqual(scan.usedIdentifiers.clap, ['Parser'])
    assert.ok(!('std' in scan.usedImports))
    assert.ok(!('crate' in scan.usedImports))
  })
})
