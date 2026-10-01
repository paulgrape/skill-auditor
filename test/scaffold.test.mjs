import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { FAKE_PROJECT, parseJson, repoRoot, run } from './helpers.mjs'

describe('scaffold', () => {
  test('dry-run emits a skill grounded in project evidence', () => {
    const payload = parseJson([
      'scaffold',
      'routing',
      '--project',
      FAKE_PROJECT,
      '--dry-run',
      '--json',
    ])
    assert.equal(payload.written, false)
    assert.equal(payload.name, 'routing')
    assert.match(payload.contents, /metadata:\n  categories: routing/)
    assert.match(payload.contents, /next\/navigation/)
    assert.match(payload.contents, /src\/app\.tsx/)
    assert.doesNotMatch(payload.contents, /\ncategories:\n/)
  })

  test('writes SKILL.md under --out and refuses to clobber it', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-scaffold-'))
    try {
      const { stdout } = run([
        'scaffold',
        'state',
        '--project',
        FAKE_PROJECT,
        '--out',
        out,
      ])
      const skillPath = path.join(out, 'state', 'SKILL.md')
      assert.match(stdout, /Wrote /)
      assert.equal(fs.existsSync(skillPath), true)
      const body = fs.readFileSync(skillPath, 'utf-8')
      assert.match(body, /zustand/)

      const { status, stderr } = run(
        ['scaffold', 'state', '--project', FAKE_PROJECT, '--out', out],
        { allowFail: true },
      )
      assert.equal(status, 1)
      assert.match(stderr, /already exists/)
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  })

  test('--name picks the directory and frontmatter name; --force overwrites', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-scaffold-name-'))
    try {
      const first = parseJson([
        'scaffold',
        'state',
        '--project',
        FAKE_PROJECT,
        '--out',
        out,
        '--name',
        'client-state',
        '--json',
      ])
      const skillPath = path.join(out, 'client-state', 'SKILL.md')
      assert.equal(first.written, true)
      assert.equal(first.name, 'client-state')
      assert.equal(path.resolve(first.skillPath), skillPath)
      const body = fs.readFileSync(skillPath, 'utf-8')
      assert.match(body, /^name: client-state$/m)
      assert.match(body, /categories: state/)

      fs.writeFileSync(skillPath, '# edited by hand\n')
      const { status } = run(
        ['scaffold', 'state', '--project', FAKE_PROJECT, '--out', out, '--name', 'client-state'],
        { allowFail: true },
      )
      assert.equal(status, 1, 'without --force the edited file is kept')
      assert.equal(fs.readFileSync(skillPath, 'utf-8'), '# edited by hand\n')

      const forced = parseJson([
        'scaffold',
        'state',
        '--project',
        FAKE_PROJECT,
        '--out',
        out,
        '--name',
        'client-state',
        '--force',
        '--json',
      ])
      assert.equal(forced.written, true)
      assert.match(fs.readFileSync(skillPath, 'utf-8'), /zustand/)
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  })
})
