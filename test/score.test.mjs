import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildAlignmentReport } from '../dist/diff.js'
import { classifySkillKind, scoreSkill } from '../dist/score.js'
import {
  SPECIFICITY_SATURATION,
  STUFFING_SCORE_CAP,
  SUBSTANTIATION_WEIGHTS,
} from '../dist/taxonomy.js'
import { makeRepo, makeSkill } from './helpers.mjs'

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
