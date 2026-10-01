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
