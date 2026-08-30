import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  auditReport,
  auditSkills,
  buildAlignmentReport,
  buildRepoReality,
  detectGaps,
  extractSkillIdentifiers,
  findSkillDirs,
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
  })

  test('detects uncovered categories', () => {
    const roots = [path.join(repoRoot, 'fixtures/nested-skills')]
    const gaps = detectGaps(buildRepoReality(project), roots, 'frontend')

    assert.ok(gaps.coveredCategories.includes('state'))
    assert.ok(gaps.gaps.some(gap => gap.category === 'testing'))
  })
})
