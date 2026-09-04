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
