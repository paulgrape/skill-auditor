import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parseJson, runExpectingFailure } from './helpers.mjs'

describe('project config', () => {
  test('extends the taxonomy so a custom package covers a custom category', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-config-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: 'config-fixture',
          dependencies: { 'acme-router': '1.0.0' },
        }),
      )
      fs.writeFileSync(path.join(dir, 'src.js'), "import x from 'acme-router'\n")
      fs.writeFileSync(
        path.join(dir, '.skill-auditor.json'),
        JSON.stringify({
          taxonomy: { routing: ['acme-router'] },
          checklists: { acme: ['routing'] },
        }),
      )

      const scan = parseJson(['scan', dir])
      assert.equal(scan.config.source, '.skill-auditor.json')
      assert.ok(scan.declaredDeps['acme-router'])

      const gaps = parseJson([
        'gaps',
        dir,
        '--project',
        dir,
        '--checklist',
        'acme',
        '--json',
      ])
      assert.ok(gaps.projectCategories.includes('routing'))
      assert.ok(
        gaps.gaps.some(g => g.kind === 'checklist-gap' && g.category === 'routing'),
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('extra ignore globs keep generated code out of the ground truth', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-ignore-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'ignore-fixture', dependencies: { zod: '3', 'gen-only': '1' } }),
      )
      fs.mkdirSync(path.join(dir, 'src'))
      fs.mkdirSync(path.join(dir, 'generated'))
      fs.writeFileSync(path.join(dir, 'src/app.js'), "import { z } from 'zod'\nexport const s = z.string()\n")
      fs.writeFileSync(path.join(dir, 'generated/client.js'), "import gen from 'gen-only'\nexport default gen\n")

      const unfiltered = parseJson(['scan', dir, '--no-cache'])
      assert.ok('gen-only' in unfiltered.usedImports)

      fs.writeFileSync(
        path.join(dir, '.skill-auditor.json'),
        JSON.stringify({ ignore: ['**/generated/**'] }),
      )
      const scan = parseJson(['scan', dir, '--no-cache'])
      assert.deepEqual(scan.config.ignore, ['**/generated/**'])
      assert.deepEqual(Object.keys(scan.usedImports), ['zod'])
      // Declared dependencies come from the manifest, which is not ignored.
      assert.equal(scan.declaredDeps['gen-only'], '1')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('reads a "skill-auditor" key in package.json when there is no config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-pkgconfig-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: 'pkg-config-fixture',
          dependencies: { 'acme-router': '1.0.0' },
          'skill-auditor': {
            taxonomy: { routing: ['acme-router'] },
            checklists: { acme: ['routing'] },
          },
        }),
      )
      fs.writeFileSync(path.join(dir, 'src.js'), "import x from 'acme-router'\nexport default x\n")

      const scan = parseJson(['scan', dir, '--no-cache'])
      assert.equal(scan.config.source, 'package.json#skill-auditor')
      assert.deepEqual(scan.config.taxonomy, { routing: ['acme-router'] })

      const gaps = parseJson(['gaps', dir, '--project', dir, '--checklist', 'acme', '--no-cache', '--json'])
      assert.ok(gaps.projectCategories.includes('routing'))

      // The file wins over the package.json key when both exist.
      fs.writeFileSync(path.join(dir, '.skill-auditor.json'), JSON.stringify({}))
      const withFile = parseJson(['scan', dir, '--no-cache'])
      assert.equal(withFile.config.source, '.skill-auditor.json')
      assert.deepEqual(withFile.config.taxonomy, {})
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects a malformed package.json config the same way', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-bad-pkgconfig-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'x', 'skill-auditor': { ignore: 'not-an-array' } }),
      )
      const { status, stderr } = runExpectingFailure(['scan', dir, '--no-cache'])
      assert.equal(status, 2)
      assert.match(stderr, /package\.json#skill-auditor: "ignore" must be an array/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects an unknown config field', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-bad-config-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'x' }),
      )
      fs.writeFileSync(
        path.join(dir, '.skill-auditor.json'),
        JSON.stringify({ stuffingCap: 100 }),
      )
      const { status, stderr } = runExpectingFailure(['scan', dir])
      assert.equal(status, 2)
      assert.match(stderr, /unknown field/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
