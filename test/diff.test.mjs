import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildAlignmentReport } from '../dist/diff.js'
import { makeRepo, makeSkill } from './helpers.mjs'

describe('category findings', () => {
  test('reports a conflict when the repo picked a rival in the same category', () => {
    const report = buildAlignmentReport(
      makeSkill({ packages: ['redux'] }),
      makeRepo({ declaredDeps: { zustand: '5' } }),
    )
    const conflicts = report.findings.filter(f => f.kind === 'category-conflict')
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].severity, 'critical')
    assert.equal(conflicts[0].message, 'Skill uses "redux" (state); project uses "zustand" for the same concern.')
    assert.equal(report.scorableReferenceCount, 1)
    assert.equal(report.matchedReferenceCount, 0)
  })

  test('reports a missing dependency when the category is absent entirely', () => {
    const report = buildAlignmentReport(
      makeSkill({ packages: ['redux'] }),
      makeRepo({ declaredDeps: { next: '15' } }),
    )
    const missing = report.findings.filter(f => f.kind === 'missing-dependency')
    assert.equal(missing.length, 1)
    assert.equal(missing[0].severity, 'warning')
    assert.equal(missing[0].message, 'Skill uses "redux" (state); project has no state library.')
  })

  test('excludes unknown packages from the alignment denominator', () => {
    const report = buildAlignmentReport(
      makeSkill({ packages: ['left-pad'] }),
      makeRepo({ declaredDeps: { next: '15' } }),
    )
    assert.equal(report.scorableReferenceCount, 0)
    assert.ok(report.findings.some(f => f.kind === 'unused-reference'))
  })
})

describe('multi-category packages', () => {
  const rtk = () => makeSkill({ packages: ['@reduxjs/toolkit'] })

  test('produce a single finding naming every conflicting category', () => {
    const report = buildAlignmentReport(
      rtk(),
      makeRepo({ declaredDeps: { zustand: '5', swr: '2' } }),
    )
    assert.equal(report.findings.length, 1)
    const [finding] = report.findings
    assert.equal(finding.kind, 'category-conflict')
    assert.match(finding.message, /\(state\/data-fetching\)/)
    assert.equal(finding.repoReality, 'swr, zustand')
    assert.equal(report.scorableReferenceCount, 1)
  })

  test('conflict on a rival in any one of their categories', () => {
    const report = buildAlignmentReport(
      rtk(),
      makeRepo({ declaredDeps: { swr: '2' } }),
    )
    assert.equal(report.findings.length, 1)
    assert.equal(report.findings[0].kind, 'category-conflict')
    // Only data-fetching has a rival, so state must not be named.
    assert.match(report.findings[0].message, /\(data-fetching\)/)
  })

  test('report every category when the repo has none of them', () => {
    const report = buildAlignmentReport(rtk(), makeRepo())
    assert.equal(report.findings.length, 1)
    assert.equal(report.findings[0].kind, 'missing-dependency')
    assert.match(
      report.findings[0].message,
      /project has no state\/data-fetching library/,
    )
  })

  test('count once toward alignment when the repo does use them', () => {
    const report = buildAlignmentReport(
      rtk(),
      makeRepo({ declaredDeps: { '@reduxjs/toolkit': '2' } }),
    )
    assert.deepEqual(report.findings, [])
    assert.equal(report.scorableReferenceCount, 1)
    assert.equal(report.matchedReferenceCount, 1)
    assert.equal(report.alignmentScore, 1)
  })
})

describe('deprecated APIs', () => {
  test('fire only when the repo uses the successor API', () => {
    const skill = makeSkill({
      packages: ['next'],
      importSpecifiers: ['next/router'],
      apiCalls: ['getServerSideProps'],
    })

    const pagesRouterRepo = makeRepo({
      declaredDeps: { next: '15' },
      usedImports: { next: ['next/router'] },
    })
    assert.ok(
      !buildAlignmentReport(skill, pagesRouterRepo).findings.some(
        f => f.kind === 'deprecated-api',
      ),
    )

    const appRouterRepo = makeRepo({
      declaredDeps: { next: '15' },
      usedImports: { next: ['next/navigation'] },
    })
    assert.equal(
      buildAlignmentReport(skill, appRouterRepo).findings.filter(
        f => f.kind === 'deprecated-api',
      ).length,
      2,
    )
  })
})

describe('identifier verification', () => {
  test('verifies packages whose demonstrated identifiers appear in the repo', () => {
    const report = buildAlignmentReport(
      makeSkill({
        packages: ['next'],
        importedIdentifiers: { next: ['useRouter'] },
      }),
      makeRepo({
        declaredDeps: { next: '15' },
        usedIdentifiers: { next: ['useRouter'] },
      }),
    )
    assert.deepEqual(report.verifiedPackages, ['next'])
    assert.ok(!report.findings.some(f => f.kind === 'unverified-api'))
  })

  test('flags demonstrated APIs the repo never imports', () => {
    const report = buildAlignmentReport(
      makeSkill({
        packages: ['next'],
        importedIdentifiers: { next: ['useSearchParams'] },
      }),
      makeRepo({
        declaredDeps: { next: '15' },
        usedIdentifiers: { next: ['useRouter'] },
      }),
    )
    assert.deepEqual(report.verifiedPackages, [])
    const unverified = report.findings.filter(f => f.kind === 'unverified-api')
    assert.equal(unverified.length, 1)
    assert.equal(unverified[0].repoReality, 'useRouter')
  })
})
