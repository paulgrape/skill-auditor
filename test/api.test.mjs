import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  auditReport,
  auditSkills,
  auditSkillsSafely,
  buildAlignmentReport,
  buildRepoReality,
  detectGaps,
  extractSkillIdentifiers,
  findSkillDirs,
  requireChecklist,
  SCHEMA_VERSION,
  scoreSkill,
} from '../dist/index.js'
import { FAKE_PROJECT, repoRoot } from './helpers.mjs'

const project = path.join(repoRoot, FAKE_PROJECT)

describe('programmatic api', () => {
  test('package exports point at built files', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
    )
    for (const entry of Object.values(pkg.exports['.'])) {
      assert.ok(
        fs.existsSync(path.join(repoRoot, entry)),
        `${entry} does not exist`,
      )
    }
  })

  test('scores a skill through the same pipeline as the CLI', () => {
    const repo = buildRepoReality(project)
    const skill = extractSkillIdentifiers(
      path.join(repoRoot, 'fixtures/aligned-skill'),
    )
    const report = buildAlignmentReport(skill, repo)
    const score = scoreSkill(report, skill, repo)

    assert.ok(repo.declaredDeps.next)
    assert.ok(repo.usedImports.next.has('next/navigation'))
    assert.deepEqual(report.findings, [])
    assert.ok(score.overall >= 85)
  })

  test('audits a set of skill directories at once', () => {
    const repo = buildRepoReality(project)
    const results = auditSkills(
      repo,
      findSkillDirs([path.join(repoRoot, 'fixtures/nested-skills')]),
    )
    const payload = auditReport(results)

    assert.equal(payload.schemaVersion, SCHEMA_VERSION)
    assert.equal(payload.count, 2)
    assert.equal(payload.results.length, 2)
    assert.deepEqual(payload.errors, [])
  })

  test('isolates an unreadable skill instead of aborting the batch', () => {
    const repo = buildRepoReality(project)
    const aligned = path.join(repoRoot, 'fixtures/aligned-skill')
    const broken = path.join(repoRoot, 'fixtures/broken-skill')

    assert.throws(() => auditSkills(repo, [aligned, broken]))

    const { results, errors } = auditSkillsSafely(repo, [aligned, broken])
    assert.equal(results.length, 1)
    assert.equal(results[0].skillDir, aligned)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].skillDir, broken)
    assert.ok(errors[0].error.length > 0)

    const payload = auditReport(results, errors)
    assert.equal(payload.count, 1)
    assert.equal(payload.errors.length, 1)
  })

  test('detects uncovered categories', () => {
    const roots = [path.join(repoRoot, 'fixtures/nested-skills')]
    const gaps = detectGaps(buildRepoReality(project), roots, 'frontend')

    assert.ok(gaps.coveredCategories.includes('state'))
    assert.ok(gaps.gaps.some(gap => gap.category === 'testing'))
  })

  test('rejects an unknown checklist key', () => {
    assert.deepEqual(requireChecklist('frontend').length > 0, true)
    assert.throws(() => requireChecklist('nope'), /Unknown checklist "nope"/)
    assert.throws(
      () => detectGaps(buildRepoReality(project), [], 'nope'),
      /Unknown checklist/,
    )
  })
})
