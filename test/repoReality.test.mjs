import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

  test('requirements.txt -r includes are followed relative to the file', () => {
    const scan = parseJson(['scan', './fixtures/python-requirements-include', '--no-cache'])
    assert.deepEqual(scan.ecosystems, ['python'])
    assert.equal(scan.declaredDeps.flask, '>=3.0')
    assert.equal(scan.declaredDeps.requests, '>=2.32')
    assert.deepEqual(Object.keys(scan.usedImports).sort(), ['flask', 'requests'])
  })

  test('a Cargo workspace merges every member manifest and workspace.dependencies', () => {
    const scan = parseJson(['scan', './fixtures/cargo-workspace', '--no-cache'])
    assert.deepEqual(scan.ecosystems, ['cargo'])
    // Root first: the workspace table's version wins over the member's `workspace = true`.
    assert.equal(scan.declaredDeps.serde, '1')
    assert.equal(scan.declaredDeps.anyhow, '1')
    assert.equal(scan.declaredDeps.clap, '4')
    assert.ok(!('wscore' in scan.declaredDeps), 'workspace member path dep is local')
    assert.ok(!('cli' in scan.declaredDeps), 'workspace member crate is local')
    assert.deepEqual(scan.usedImports.serde, ['serde'])
    assert.deepEqual(scan.usedImports.anyhow, ['anyhow'])
    assert.deepEqual(scan.usedImports.clap, ['clap'])
    assert.deepEqual(scan.usedIdentifiers.clap, ['Parser'])
    assert.ok(!('wscore' in scan.usedImports), 'imports of a workspace member crate are local')
    assert.ok(!('std' in scan.usedImports))
    assert.ok(!('crate' in scan.usedImports))
  })

  test('reads optionalDependencies from package.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-optdeps-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: 'optdeps-fixture',
          dependencies: { zod: '^3.22.0' },
          optionalDependencies: { sharp: '^0.33.0' },
        }),
      )
      const scan = parseJson(['scan', dir, '--no-cache'])
      assert.equal(scan.declaredDeps.zod, '^3.22.0')
      assert.equal(scan.declaredDeps.sharp, '^0.33.0')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('resolves go.work use directives and local go.mod replace targets as local modules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-gowork-'))
    try {
      fs.mkdirSync(path.join(dir, 'api'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'shared'), { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'go.work'),
        'go 1.22\nuse (\n\t./api\n\t./shared\n)\n',
      )
      fs.writeFileSync(
        path.join(dir, 'shared/go.mod'),
        'module example.com/shared\n\ngo 1.22\n',
      )
      fs.writeFileSync(
        path.join(dir, 'api/go.mod'),
        [
          'module example.com/api',
          'go 1.22',
          'require (',
          '\texample.com/shared v0.0.0',
          '\tgithub.com/gin-gonic/gin v1.9.1',
          ')',
          'replace example.com/shared => ../shared',
        ].join('\n'),
      )
      fs.writeFileSync(
        path.join(dir, 'api/main.go'),
        [
          'package main',
          'import (',
          '\t"example.com/shared/auth"',
          '\t"github.com/gin-gonic/gin"',
          ')',
          'func main() { _ = gin.Default(); _ = auth.Check }',
        ].join('\n'),
      )
      const scan = parseJson(['scan', dir, '--no-cache'])
      assert.deepEqual(scan.ecosystems, ['go'])
      assert.equal(scan.declaredDeps['github.com/gin-gonic/gin'], 'v1.9.1')
      assert.ok(!('example.com/shared' in scan.declaredDeps), 'locally replaced module is not an external dep')
      assert.ok(!('example.com/shared' in scan.usedImports), 'imports of local go.work/replaced module are skipped')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
