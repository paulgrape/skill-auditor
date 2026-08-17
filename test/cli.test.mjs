import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FAKE_PROJECT, parseJson, run } from './helpers.mjs'

describe('scan', () => {
  const scan = parseJson(['scan', FAKE_PROJECT])

  test('records import evidence with project file paths', () => {
    assert.ok(scan.importEvidence?.next?.length > 0)
    assert.ok(scan.importEvidence.next.some(e => e.file === 'src/app.tsx'))
  })

  test('records the identifiers imported from each package', () => {
    assert.ok(scan.usedIdentifiers?.next?.includes('useRouter'))
    assert.ok(scan.usedIdentifiers?.zustand?.includes('create'))
  })
})

describe('audit', () => {
  const stale = parseJson([
    'audit',
    './fixtures/fake-skill',
    '--project',
    FAKE_PROJECT,
    '--json',
  ])
  const aligned = parseJson([
    'audit',
    './fixtures/aligned-skill',
    '--project',
    FAKE_PROJECT,
    '--json',
  ])
  const stuffed = parseJson([
    'audit',
    './fixtures/stuffed-skill',
    '--project',
    FAKE_PROJECT,
    '--json',
  ])
  const neutral = parseJson([
    'audit',
    './fixtures/neutral-skill',
    '--project',
    FAKE_PROJECT,
    '--json',
  ])

  test('flags a stale skill and suggests fixes', () => {
    assert.ok(stale.report.findings.some(f => f.severity === 'critical'))
    assert.equal(stale.score.kind, 'technical')
    assert.ok(stale.score.overall < 60)
    assert.ok(stale.suggestions.length > 0)
  })

  test('scores a repo-grounded skill highly with no findings', () => {
    assert.ok(aligned.score.overall >= 85)
    assert.deepEqual(aligned.report.findings, [])
    assert.ok(aligned.report.verifiedPackages.includes('next'))
    assert.ok(aligned.report.verifiedPackages.includes('zustand'))
    assert.equal(aligned.score.breakdown.focus, 1)
  })

  test('caps a stuffed skill below an aligned one', () => {
    assert.ok(stuffed.report.findings.some(f => f.kind === 'metric-stuffing'))
    assert.ok(stuffed.score.overall <= 60)
    assert.ok(stuffed.score.overall < aligned.score.overall)
  })

  test('reports neutral skills on intrinsic quality only', () => {
    assert.equal(neutral.score.kind, 'neutral')
    assert.equal(neutral.score.overall, null)
    assert.ok(neutral.score.intrinsicQuality >= 80)
  })

  test('penalizes a misaligned multi-category template', () => {
    const template = parseJson([
      'audit',
      './templates/frontend-must-have',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    assert.equal(template.score.kind, 'technical')
    assert.ok(!template.report.findings.some(f => f.kind === 'metric-stuffing'))
    assert.ok(template.report.findings.some(f => f.kind === 'missing-dependency'))
    assert.ok(template.score.breakdown.focus < 1)
    assert.ok(template.score.overall < 70)
  })

  test('returns a results array when given a skills root', () => {
    const rootAudit = parseJson([
      'audit',
      './fixtures/nested-skills',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    assert.equal(rootAudit.count, 2)
    assert.equal(rootAudit.results.length, 2)
  })
})

describe('gaps', () => {
  test('reports checklist gaps for the frontend checklist', () => {
    const gaps = parseJson([
      'gaps',
      './fixtures/fake-skill',
      '--project',
      FAKE_PROJECT,
      '--checklist',
      'frontend',
      '--json',
    ])
    assert.ok(gaps.projectCategories.length > 0)
    assert.ok(gaps.gaps.some(g => g.kind === 'checklist-gap'))
  })

  test('attaches project evidence to an uncovered category', () => {
    const gaps = parseJson([
      'gaps',
      './fixtures/neutral-skill',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    const routing = gaps.gaps.find(g => g.category === 'routing')
    assert.ok(routing.evidence.length > 0)
    assert.ok(routing.evidence.some(e => e.file === 'src/app.tsx'))
    assert.ok(routing.evidence.some(e => e.example?.includes('next/navigation')))
    assert.ok(routing.recommendation.includes('src/app.tsx'))
  })

  test('surfaces the same evidence in text output', () => {
    const { stdout } = run([
      'gaps',
      './fixtures/neutral-skill',
      '--project',
      FAKE_PROJECT,
    ])
    assert.ok(stdout.includes('src/app.tsx'))
    assert.ok(stdout.includes('next/navigation'))
  })

  test('counts frontmatter categories as website-domain coverage', () => {
    const uncovered = parseJson([
      'gaps',
      './fixtures/nested-skills',
      '--project',
      FAKE_PROJECT,
      '--checklist',
      'website',
      '--json',
    ])
    assert.ok(
      uncovered.gaps.some(
        g => g.kind === 'checklist-gap' && g.category === 'accessibility',
      ),
    )

    const covered = parseJson([
      'gaps',
      './templates',
      '--project',
      FAKE_PROJECT,
      '--checklist',
      'website',
      '--json',
    ])
    assert.deepEqual(covered.gaps, [])
    assert.ok(covered.coveredCategories.includes('accessibility'))
  })
})

describe('discovery', () => {
  test('finds nested skills recursively', () => {
    const listed = parseJson(['list', './fixtures/nested-skills', '--json'])
    assert.equal(listed.count, 2)
    assert.ok(listed.skillDirs.some(d => d.includes('routing')))
    assert.ok(listed.skillDirs.some(d => d.includes('state')))
  })

  test('gaps scans nested skills as coverage', () => {
    const nested = parseJson([
      'gaps',
      './fixtures/nested-skills',
      '--project',
      FAKE_PROJECT,
      '--json',
    ])
    assert.equal(nested.skillDirs.length, 2)
    assert.ok(nested.coveredCategories.includes('routing'))
    assert.ok(nested.coveredCategories.includes('state'))
  })

  test('--defaults scans well-known roots and ignores absent ones', () => {
    const listed = parseJson(['list', '--defaults', '--json'], {
      cwd: './fixtures/default-roots',
    })
    assert.equal(listed.count, 2)
    assert.ok(listed.skillDirs.some(d => d.includes('foo')))
    assert.ok(listed.skillDirs.some(d => d.includes('bar')))
  })
})

describe('extract', () => {
  test('reads the categories frontmatter list', () => {
    const extracted = parseJson(['extract', './templates/website-accessibility'])
    assert.ok(extracted.categories.includes('accessibility'))
  })
})

describe('spec-check', () => {
  const spec = parseJson([
    'spec-check',
    '--project',
    './fixtures/website-project',
    '--json',
  ])

  test('summarizes pass, fail and skip counts', () => {
    assert.ok(spec.summary.pass > 0)
    assert.ok(spec.summary.fail > 0)
    assert.ok(spec.summary.skip > 0)
  })

  test('classifies items by what the repo implements', () => {
    assert.ok(
      spec.findings.some(
        f => f.id === 'foundations.doctype' && f.status === 'pass',
      ),
    )
    assert.ok(
      spec.findings.some(f => f.id === 'seo.robots-txt' && f.status === 'fail'),
    )
    assert.ok(
      spec.findings.some(
        f => f.id === 'security.https-tls' && f.status === 'skip',
      ),
    )
  })

  test('--priority filters to a single priority', () => {
    const required = parseJson([
      'spec-check',
      '--project',
      './fixtures/website-project',
      '--priority',
      'required',
      '--json',
    ])
    assert.ok(required.findings.every(f => f.priority === 'required'))
  })
})
