import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  extractShellCommands,
  extractSkillIdentifiers,
  normalizeCitedPath,
} from '../dist/skillIdentifiers.js'
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

  test('a skill referencing only non-packages is neutral: API calls do not make it technical', () => {
    // It still has API-call-shaped identifiers (readFileSync(, join(), which
    // used to push it into the mixed bucket and grade it on an alignment it
    // never claimed. Since 2.0 only package references decide the kind.
    assert.ok(extracted.apiCalls.length > 0)
    const { results } = parseJson([
      'audit',
      './fixtures/builtin-skill',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    assert.equal(results[0].score.kind, 'neutral')
    assert.equal(results[0].score.overall, null)
    assert.deepEqual(results[0].report.findings, [])
  })
})

describe('bundled references', () => {
  const extracted = parseJson(['extract', './fixtures/references-skill'])

  test('a references/*.md file is read section-aware and located by file', () => {
    assert.deepEqual(extracted.packages, ['zustand'])
    assert.deepEqual(extracted.importedIdentifiers.zustand, ['create'])
    assert.equal(extracted.packageRefs.zustand.substantiation, 'usage')
    assert.equal(extracted.packageRefs.zustand.substantiatedByProse, true)
    assert.deepEqual(extracted.packageRefs.zustand.location, {
      file: 'references/stores.md',
      line: 8,
      heading: 'Store conventions',
    })
    assert.equal(extracted.unusedImportCount, 0)
  })

  test('the reference file counts toward alignment and verification', () => {
    const { results } = parseJson([
      'audit',
      './fixtures/references-skill',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    const [{ report, score }] = results
    assert.equal(score.kind, 'mixed')
    assert.deepEqual(report.verifiedPackages, ['zustand'])
    assert.deepEqual(report.findings, [])
  })
})

describe('fence languages', () => {
  const extracted = parseJson(['extract', './fixtures/non-js-skill'])

  test('CSS, HTML and shell fences yield no packages or API calls', () => {
    assert.deepEqual(extracted.packages, [])
    assert.deepEqual(extracted.importSpecifiers, [])
    // `@media (` and `$(` used to be read as API calls.
    assert.deepEqual(extracted.apiCalls, [])
  })

  test('so a skill made only of them is neutral, not a failing technical skill', () => {
    const { results } = parseJson([
      'audit',
      './fixtures/non-js-skill',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    assert.equal(results[0].score.kind, 'neutral')
    assert.equal(results[0].score.overall, null)
    assert.deepEqual(results[0].report.findings, [])
  })

  test('every bundled website template is neutral', () => {
    const { results } = parseJson([
      'audit',
      './templates',
      '--project',
      './fixtures/website-project',
      '--json',
    ])
    for (const result of results) {
      if (!result.report.skillName.startsWith('website-')) continue
      assert.equal(result.score.kind, 'neutral', result.report.skillName)
    }
  })
})

describe('import aliases', () => {
  const extracted = parseJson(['extract', './fixtures/alias-skill'])

  test('record the exported name, not the local alias', () => {
    assert.deepEqual(extracted.importedIdentifiers.next, ['useRouter'])
    assert.deepEqual(extracted.importedIdentifiers.zustand, ['create'])
  })

  test('count as demonstrated usage when the alias is used', () => {
    assert.equal(extracted.unusedImportCount, 0)
    assert.equal(extracted.packageRefs.next.substantiation, 'usage')
    assert.equal(extracted.packageRefs.zustand.substantiation, 'usage')
  })

  test('verify against the repo like an un-aliased import would', () => {
    const { results } = parseJson([
      'audit',
      './fixtures/alias-skill',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    const [aliased] = results
    assert.deepEqual(aliased.report.verifiedPackages, ['next', 'zustand'])
    assert.ok(!aliased.report.findings.some(f => f.kind === 'unverified-api'))

    const [plain] = parseJson([
      'audit',
      './fixtures/aligned-skill',
      '--project',
      FAKE_PROJECT,
      '--json',
    ]).results
    assert.equal(aliased.score.overall, plain.score.overall)
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

  test('records the SKILL.md line of a fenced import', () => {
    const extracted = parseJson(['extract', './fixtures/aligned-skill'])
    assert.ok(extracted.locations.packages.next.line >= 1)
    assert.ok(extracted.locations.importSpecifiers['next/navigation'])
  })
})

describe('procedural skills', () => {
  test('a shell-only workflow is not alignment-scored', () => {
    const { results } = parseJson([
      'audit',
      './fixtures/procedural-skill',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    assert.equal(results[0].score.kind, 'procedural')
    assert.equal(results[0].score.overall, null)
  })

  test('a `# comment` inside a shell fence does not start a new section', () => {
    // Splitting there used to leave half a fence in each section; the fence
    // regex then paired the orphaned closer with the next opener and read
    // the prose in between as an untagged code block.
    const extracted = parseJson(['extract', './fixtures/procedural-skill'])
    assert.equal(extracted.codeEvidence.shellFences, 2)
    assert.equal(extracted.codeEvidence.codeFences, 0)
    assert.deepEqual(extracted.apiCalls, [])
    assert.deepEqual(extracted.packages, ['vitest'])
    assert.equal(extracted.locations.packages.vitest.heading, 'Run the test CLI')
  })

  test('the bundled workflow skill is procedural, not a failing technical skill', () => {
    const { results } = parseJson([
      'audit',
      './skills/skill-auditor',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    assert.equal(results[0].score.kind, 'procedural')
    assert.equal(results[0].score.overall, null)
  })
})

describe('cited paths and shell commands', () => {
  test('normalizeCitedPath accepts project-relative file paths and rejects specifiers, aliases, routes, and globs', () => {
    assert.equal(normalizeCitedPath('src/foo.ts'), 'src/foo.ts')
    assert.equal(normalizeCitedPath('./app/main.py:42'), 'app/main.py')
    assert.equal(normalizeCitedPath('.github/workflows/ci.yml#L10'), '.github/workflows/ci.yml')
    assert.equal(normalizeCitedPath('next/navigation'), null)
    assert.equal(normalizeCitedPath('@/components/Button.tsx'), null)
    assert.equal(normalizeCitedPath('~/styles/theme.ts'), null)
    assert.equal(normalizeCitedPath('/llms.txt'), null)
    assert.equal(normalizeCitedPath('src/stores/'), null)
    assert.equal(normalizeCitedPath('<path/from/evidence.ts>'), null)
    assert.equal(normalizeCitedPath('github.com/gin-gonic/gin'), null)
    assert.equal(normalizeCitedPath('robots.txt'), null)
  })

  test('extractShellCommands parses npm run, pnpm, yarn run, bun run, and make targets while skipping built-in CLI subcommands', () => {
    const commands = extractShellCommands(
      [
        '# comment line',
        'npm install -g skill-auditor',
        'npm run typecheck && pnpm test:unit',
        'pnpm install',
        'pnpm --filter web build',
        'make -C backend migrate',
      ].join('\n'),
    )
    assert.deepEqual(commands, [
      { command: 'npm run typecheck', runner: 'npm', target: 'typecheck', line: 2 },
      { command: 'pnpm test:unit', runner: 'pnpm', target: 'test:unit', line: 2 },
      { command: 'pnpm build', runner: 'pnpm', target: 'build', line: 4 },
      { command: 'make migrate', runner: 'make', target: 'migrate', line: 5 },
    ])
  })

  test('extracts project paths from aligned-skill and ignores skill-local bundled references', () => {
    const aligned = extractSkillIdentifiers('./fixtures/aligned-skill')
    assert.ok(aligned.locations.paths?.['src/app.tsx'])
    assert.equal(aligned.locations.paths['src/app.tsx'].line, 10)

    const withRefs = extractSkillIdentifiers('./fixtures/references-skill')
    assert.equal(withRefs.locations.paths?.['references/stores.md'], undefined)
  })

  test('audits a skill with stale paths and stale commands end-to-end against a project', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-230-'))
    try {
      const projDir = path.join(tmp, 'project')
      const skillDir = path.join(tmp, 'my-skill')
      fs.mkdirSync(path.join(projDir, 'src'), { recursive: true })
      fs.mkdirSync(skillDir, { recursive: true })

      fs.writeFileSync(
        path.join(projDir, 'package.json'),
        JSON.stringify({
          name: 'proj',
          scripts: { build: 'tsc', test: 'node --test' },
          dependencies: { zustand: '^5.0.0' },
        }),
      )
      fs.writeFileSync(
        path.join(projDir, 'Makefile'),
        '.PHONY: check\ncheck:\n\tnpm test\n',
      )
      fs.writeFileSync(
        path.join(projDir, 'src', 'real.ts'),
        "import { create } from 'zustand'\nexport const s = create(() => ({}))\n",
      )

      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: my-skill',
          'description: State workflow skill. Use when updating stores.',
          '---',
          '',
          '# State workflow',
          '',
          'Inspect `src/real.ts` and `src/deleted.ts` before editing `app/main.py`.',
          '',
          '```bash',
          'npm run build',
          'npm run missing-script',
          'pnpm ghost-task',
          'make check',
          'make deploy',
          '```',
        ].join('\n'),
      )

      const { results } = parseJson([
        'audit',
        skillDir,
        '--project',
        projDir,
        '--no-cache',
        '--json',
      ])
      const findings = results[0].report.findings
      const stalePaths = findings
        .filter(f => f.kind === 'stale-path')
        .map(f => f.skillReference)
      const staleCommands = findings
        .filter(f => f.kind === 'stale-command')
        .map(f => f.skillReference)

      assert.deepEqual(stalePaths, ['app/main.py', 'src/deleted.ts'])
      assert.deepEqual(staleCommands, [
        'npm run missing-script',
        'pnpm ghost-task',
        'make deploy',
      ])
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
