import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, test } from 'node:test'
import { buildAlignmentReport } from '../dist/diff.js'
import { findSkillDirs } from '../dist/discoverSkills.js'
import { buildRepoReality } from '../dist/repoReality.js'
import { auditSkillsSafely } from '../dist/reports.js'
import { classifySkillKind, explainLowScore, scoreSkill } from '../dist/score.js'
import {
  FRESHNESS_PENALTY,
  SPECIFICITY_SATURATION,
  STUFFING_SCORE_CAP,
  SUBSTANTIATION_WEIGHTS,
} from '../dist/taxonomy.js'
import { makeRepo, makeSkill, repoRoot } from './helpers.mjs'

function score(skill, repo) {
  return scoreSkill(buildAlignmentReport(skill, repo), skill, repo)
}

describe('classifySkillKind', () => {
  test('is neutral with no technical references', () => {
    assert.equal(classifySkillKind(makeSkill()), 'neutral')
  })

  test('is mixed at or below the threshold and technical above it', () => {
    assert.equal(classifySkillKind(makeSkill({ packages: ['next'] })), 'mixed')
    assert.equal(
      classifySkillKind(makeSkill({ packages: ['next', 'zustand', 'zod'] })),
      'mixed',
    )
    assert.equal(
      classifySkillKind(
        makeSkill({ packages: ['next', 'zustand', 'zod', 'vitest'] }),
      ),
      'technical',
    )
  })

  test('is procedural when the only fenced code is shell', () => {
    assert.equal(
      classifySkillKind(
        makeSkill({
          packages: ['vitest'],
          codeEvidence: { codeFences: 0, shellFences: 2 },
        }),
      ),
      'procedural',
    )
  })
})

describe('focus', () => {
  const repo = makeRepo({
    declaredDeps: {
      next: '15',
      zustand: '5',
      zod: '3',
      '@reduxjs/toolkit': '2',
      swr: '2',
    },
  })

  test('is perfect within two categories', () => {
    assert.equal(score(makeSkill({ packages: ['next'] }), repo).breakdown.focus, 1)
    assert.equal(
      score(makeSkill({ packages: ['next', 'zustand'] }), repo).breakdown.focus,
      1,
    )
  })

  test('decays past two categories', () => {
    const wide = score(
      makeSkill({ packages: ['next', 'zustand', 'zod'] }),
      repo,
    )
    assert.equal(wide.breakdown.focus, 2 / 3)
  })

  test('counts a multi-category package in every category it belongs to', () => {
    // @reduxjs/toolkit is both state and data-fetching, so on its own it fills
    // the two-category budget exactly.
    const rtkOnly = score(makeSkill({ packages: ['@reduxjs/toolkit'] }), repo)
    assert.equal(rtkOnly.breakdown.focus, 1)

    // Adding routing pushes it to three categories.
    const rtkAndNext = score(
      makeSkill({ packages: ['@reduxjs/toolkit', 'next'] }),
      repo,
    )
    assert.equal(rtkAndNext.breakdown.focus, 2 / 3)
  })

  test('ignores packages the taxonomy does not classify', () => {
    const unknown = score(
      makeSkill({ packages: ['next', 'zustand', 'left-pad'] }),
      repo,
    )
    assert.equal(unknown.breakdown.focus, 1)
  })
})

describe('specificity', () => {
  const repo = makeRepo({ declaredDeps: { next: '15' } })

  test('follows the sqrt curve on substantiation weight', () => {
    const usage = score(makeSkill({ packages: ['next'] }), repo)
    assert.equal(
      usage.breakdown.specificity,
      Math.sqrt(SUBSTANTIATION_WEIGHTS.usage / SPECIFICITY_SATURATION),
    )
  })

  test('weights a bare mention below an idle import below demonstrated usage', () => {
    const specificityFor = substantiation =>
      score(makeSkill({ packages: ['next'], substantiation }), repo).breakdown
        .specificity

    const mention = specificityFor('mention')
    const fenced = specificityFor('fenced')
    const usage = specificityFor('usage')

    assert.ok(mention < fenced)
    assert.ok(fenced < usage)
    assert.equal(
      mention,
      Math.sqrt(SUBSTANTIATION_WEIGHTS.mention / SPECIFICITY_SATURATION),
    )
  })

  test('halves references in sections without prose', () => {
    const withProse = score(makeSkill({ packages: ['next'] }), repo)
    const withoutProse = score(
      makeSkill({ packages: ['next'], substantiatedByProse: false }),
      repo,
    )
    assert.equal(
      withoutProse.breakdown.specificity,
      withProse.breakdown.specificity * Math.SQRT1_2,
    )
  })

  test('ignores references the repo does not have', () => {
    const absent = score(makeSkill({ packages: ['left-pad'] }), repo)
    assert.equal(absent.breakdown.specificity, 0)
  })
})

describe('alignment', () => {
  test('uses a neutral prior when nothing is scorable', () => {
    const repo = makeRepo()
    const result = score(makeSkill({ packages: ['left-pad'] }), repo)
    assert.equal(result.breakdown.alignment, 0.5)
  })

  test('is the matched share of scorable references', () => {
    const repo = makeRepo({ declaredDeps: { next: '15' } })
    const result = score(makeSkill({ packages: ['next', 'zustand'] }), repo)
    assert.equal(result.breakdown.alignment, 0.5)
  })
})

describe('freshness', () => {
  const appRouterRepo = makeRepo({
    declaredDeps: { next: '15' },
    usedImports: { next: ['next/navigation'] },
  })

  test('is perfect without deprecated APIs', () => {
    const result = score(makeSkill({ packages: ['next'] }), appRouterRepo)
    assert.equal(result.breakdown.freshness, 1)
  })

  test('drops by the penalty per critical deprecated-api finding, floored at zero', () => {
    const one = score(
      makeSkill({ packages: ['next'], importSpecifiers: ['next/router'] }),
      appRouterRepo,
    )
    assert.equal(one.breakdown.freshness, 1 - FRESHNESS_PENALTY)

    const two = score(
      makeSkill({
        packages: ['next'],
        importSpecifiers: ['next/router'],
        apiCalls: ['getServerSideProps'],
      }),
      appRouterRepo,
    )
    assert.equal(two.breakdown.freshness, Math.max(0, 1 - 2 * FRESHNESS_PENALTY))

    const three = score(
      makeSkill({
        packages: ['next'],
        importSpecifiers: ['next/router'],
        apiCalls: ['getServerSideProps', 'getStaticProps'],
      }),
      appRouterRepo,
    )
    assert.equal(three.breakdown.freshness, 0)
  })

  test('is not charged when the repo never adopted the successor API', () => {
    const pagesRouterRepo = makeRepo({
      declaredDeps: { next: '15' },
      usedImports: { next: ['next/router'] },
    })
    const result = score(
      makeSkill({ packages: ['next'], importSpecifiers: ['next/router'] }),
      pagesRouterRepo,
    )
    assert.equal(result.breakdown.freshness, 1)
  })

  test('is still reported for neutral skills', () => {
    const result = score(makeSkill(), appRouterRepo)
    assert.equal(result.kind, 'neutral')
    assert.equal(result.breakdown.freshness, 1)
  })
})

describe('metric-stuffing cap', () => {
  test('caps the overall score however the dimensions add up', () => {
    const repo = makeRepo({
      declaredDeps: {
        next: '15',
        zustand: '5',
        zod: '3',
        vitest: '1',
        swr: '2',
        tailwindcss: '4',
        prisma: '5',
        formik: '2',
      },
    })
    const skill = makeSkill({
      packages: Object.keys(repo.declaredDeps),
      substantiation: 'usage',
    })
    const result = score(skill, repo)
    assert.ok(
      result.breakdown.alignment === 1,
      'every reference matches the repo',
    )
    assert.ok(result.overall <= STUFFING_SCORE_CAP)
  })
})

describe('explainLowScore', () => {
  test('API calls alone no longer produce a scored-but-unexplained skill', () => {
    const skill = makeSkill({ apiCalls: ['inventedHelper'] })
    const repo = makeRepo()
    const report = buildAlignmentReport(skill, repo)
    const scored = scoreSkill(report, skill, repo)
    assert.equal(scored.kind, 'neutral')
    assert.equal(scored.overall, null)
    assert.equal(explainLowScore(report, scored, skill), null)
  })

  test('names the dimensions when a low score has no other finding', () => {
    // The live scorer cannot currently produce this shape (matched packages
    // score at least ~77; unmatched ones always emit a drift finding). The
    // guard is pinned with a constructed report so a future scoring change
    // still has a finding an agent can act on.
    const skill = makeSkill({
      packages: ['next', 'zustand', 'swr', 'zod', 'vitest'],
      substantiation: 'mention',
    })
    const report = {
      skillName: skill.skillName,
      skillPath: skill.skillPath,
      alignmentScore: 1,
      scorableReferenceCount: 5,
      matchedReferenceCount: 5,
      verifiedPackages: [],
      findings: [],
    }
    const scored = {
      kind: 'technical',
      overall: 69,
      grade: 'D',
      breakdown: { alignment: 1, focus: 0.4, freshness: 1, specificity: 0 },
      intrinsicQuality: 0,
      intrinsicGrade: 'F',
    }
    const finding = explainLowScore(report, scored, skill)
    assert.equal(finding?.kind, 'unscorable')
    assert.match(finding.message, /alignment 100%, specificity 0%, focus 40%/)
    assert.match(finding.message, /next \(mention\)/)
  })

  test('a skill whose packages all match cannot score low without a finding', () => {
    // Alignment and freshness alone are worth 65 points; the cheapest matched
    // reference (a bare mention in a prose-less section) still adds enough
    // specificity to clear the threshold even with focus at its worst. (Four
    // packages, not five: five bare mentions is metric stuffing, a finding.)
    const packages = ['next', 'zustand', 'swr', 'zod']
    const skill = makeSkill({
      packages,
      substantiation: 'mention',
      substantiatedByProse: false,
    })
    const repo = makeRepo({
      declaredDeps: Object.fromEntries(packages.map(p => [p, '1'])),
    })
    const report = buildAlignmentReport(skill, repo)
    const scored = scoreSkill(report, skill, repo)
    assert.deepEqual(report.findings, [])
    assert.ok(scored.breakdown.focus <= 0.5)
    assert.ok(scored.overall >= 70, `scored ${scored.overall}`)
    assert.equal(explainLowScore(report, scored, skill), null)
  })

  test('never fires on a real skill: every low score already carries a finding', () => {
    const skillDirs = findSkillDirs([path.join(repoRoot, 'fixtures')]).filter(
      dir => !dir.includes('broken-skill'),
    )
    for (const project of ['fake-project', 'polyglot-project']) {
      const repo = buildRepoReality(path.join(repoRoot, 'fixtures', project), { cache: false })
      const { results, errors } = auditSkillsSafely(repo, skillDirs)
      assert.deepEqual(errors, [])
      for (const { skillDir, report, score } of results) {
        if (score.overall === null || score.overall >= 70) continue
        assert.ok(report.findings.length > 0, `${skillDir} scored ${score.overall} with no finding`)
        assert.ok(
          !report.findings.some(f => f.kind === 'unscorable'),
          `${skillDir} needed the unscorable guard`,
        )
      }
    }
  })

  test('is silent when findings already explain the score', () => {
    const skill = makeSkill({ packages: ['redux'] })
    const repo = makeRepo({ declaredDeps: { zustand: '5' } })
    const report = buildAlignmentReport(skill, repo)
    const scored = scoreSkill(report, skill, repo)
    assert.ok(report.findings.length > 0)
    assert.equal(explainLowScore(report, scored, skill), null)
  })
})
