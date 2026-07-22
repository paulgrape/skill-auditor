#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cliPath = path.join(repoRoot, 'dist/cli.js')

function run(args, { allowFail = false, cwd = repoRoot } = {}) {
  try {
    return execSync(`node "${cliPath}" ${args}`, { encoding: 'utf-8', cwd })
  } catch (err) {
    if (allowFail && err.stdout) return err.stdout
    throw err
  }
}

function parseJson(args) {
  const out = run(`${args} --json`, { allowFail: true })
  return JSON.parse(out)
}

let passed = 0
let failed = 0

function assert(label, condition) {
  if (condition) {
    console.log(`  ok  ${label}`)
    passed++
  } else {
    console.error(` FAIL ${label}`)
    failed++
  }
}

console.log('Testing scan command...')
const scan = JSON.parse(run('scan ./fixtures/fake-project'))
assert('scan includes importEvidence', scan.importEvidence?.next?.length > 0)
assert('scan evidence includes file path', scan.importEvidence.next.some(e => e.file === 'src/app.tsx'))
assert('scan records used identifiers per package', scan.usedIdentifiers?.next?.includes('useRouter'))
assert('scan records zustand identifiers', scan.usedIdentifiers?.zustand?.includes('create'))

console.log('Testing stale skill (fake-skill)...')
const stale = parseJson('audit ./fixtures/fake-skill --project ./fixtures/fake-project')
assert('stale skill has critical findings', stale.report.findings.some(f => f.severity === 'critical'))
assert('stale skill score is low', stale.score.overall !== null && stale.score.overall < 60)
assert('stale skill is technical', stale.score.kind === 'technical')
assert('stale skill has suggestions', stale.suggestions.length > 0)

console.log('Testing aligned skill...')
const aligned = parseJson('audit ./fixtures/aligned-skill --project ./fixtures/fake-project')
assert('aligned skill score is high', aligned.score.overall !== null && aligned.score.overall >= 85)
assert('aligned skill has no findings', aligned.report.findings.length === 0)
assert('aligned skill has verified packages', aligned.report.verifiedPackages.includes('next') && aligned.report.verifiedPackages.includes('zustand'))
assert('aligned skill focus is perfect', aligned.score.breakdown.focus === 1)

console.log('Testing stuffed skill (anti-gaming)...')
const stuffed = parseJson('audit ./fixtures/stuffed-skill --project ./fixtures/fake-project')
assert('stuffed skill gets metric-stuffing finding', stuffed.report.findings.some(f => f.kind === 'metric-stuffing'))
assert('stuffed skill score is capped', stuffed.score.overall !== null && stuffed.score.overall <= 60)
assert('stuffed skill scores below aligned skill', stuffed.score.overall < aligned.score.overall)

console.log('Testing frontend-must-have template...')
const good = parseJson('audit ./templates/frontend-must-have --project ./fixtures/fake-project')
assert('template skill is technical', good.score.kind === 'technical')
assert('template is not flagged as stuffing', !good.report.findings.some(f => f.kind === 'metric-stuffing'))
assert('template gets missing-dependency warnings for absent stack', good.report.findings.some(f => f.kind === 'missing-dependency'))
assert('multi-category template loses focus', good.score.breakdown.focus < 1)
assert('misaligned template scores below 70', good.score.overall !== null && good.score.overall < 70)

console.log('Testing neutral skill...')
const neutral = parseJson('audit ./fixtures/neutral-skill --project ./fixtures/fake-project')
assert('neutral skill kind', neutral.score.kind === 'neutral')
assert('neutral alignment N/A', neutral.score.overall === null)
assert('neutral has intrinsic quality', neutral.score.intrinsicQuality >= 80)

console.log('Testing gaps command...')
const gaps = JSON.parse(run('gaps ./fixtures/fake-skill --project ./fixtures/fake-project --checklist frontend --json'))
assert('gaps returns project categories', gaps.projectCategories.length > 0)
assert('gaps finds checklist gaps', gaps.gaps.some(g => g.kind === 'checklist-gap'))

const evidenceGaps = JSON.parse(run('gaps ./fixtures/neutral-skill --project ./fixtures/fake-project --json'))
const routingGap = evidenceGaps.gaps.find(g => g.category === 'routing')
assert('routing gap includes evidence', routingGap?.evidence?.length > 0)
assert('routing gap evidence has project file path', routingGap?.evidence?.some(e => e.file === 'src/app.tsx'))
assert('routing gap evidence has import example', routingGap?.evidence?.some(e => e.example?.includes('next/navigation')))
assert('routing gap recommendation mentions file path', routingGap?.recommendation?.includes('src/app.tsx'))
const gapsText = run('gaps ./fixtures/neutral-skill --project ./fixtures/fake-project')
assert('gaps text output includes file path', gapsText.includes('src/app.tsx'))
assert('gaps text output includes import example', gapsText.includes('next/navigation'))

console.log('Testing recursive skill discovery...')
const listed = JSON.parse(run('list ./fixtures/nested-skills --json'))
assert('list finds nested skills', listed.count === 2)
assert('list includes routing skill', listed.skillDirs.some(d => d.includes('routing')))
assert('list includes state skill', listed.skillDirs.some(d => d.includes('state')))

const nestedGaps = JSON.parse(run('gaps ./fixtures/nested-skills --project ./fixtures/fake-project --json'))
assert('gaps scans nested skills', nestedGaps.skillDirs.length === 2)
assert('nested skills cover routing+state', nestedGaps.coveredCategories.includes('routing') && nestedGaps.coveredCategories.includes('state'))

console.log('Testing audit on skills root...')
const rootAudit = parseJson('audit ./fixtures/nested-skills --project ./fixtures/fake-project')
assert('audit on root returns multiple results', rootAudit.count === 2)
assert('audit on root includes results array', Array.isArray(rootAudit.results) && rootAudit.results.length === 2)

console.log('Testing --defaults flag...')
const defaultRootsDir = path.join(repoRoot, 'fixtures/default-roots')
const defaultsListed = JSON.parse(
  run('list --defaults --json', { cwd: defaultRootsDir }),
)
assert('--defaults finds .cursor/skills skill', defaultsListed.skillDirs.some(d => d.includes('foo')))
assert('--defaults finds .codex/skills skill', defaultsListed.skillDirs.some(d => d.includes('bar')))
assert('--defaults ignores absent dirs without error', defaultsListed.count === 2)

console.log('Testing frontmatter categories extraction...')
const extracted = JSON.parse(run('extract ./templates/website-accessibility'))
assert('extract reads categories frontmatter', extracted.categories.includes('accessibility'))

console.log('Testing website checklist gaps...')
const websiteGapsUncovered = JSON.parse(
  run('gaps ./fixtures/nested-skills --project ./fixtures/fake-project --checklist website --json'),
)
assert(
  'website checklist flags uncovered domains',
  websiteGapsUncovered.gaps.some(g => g.kind === 'checklist-gap' && g.category === 'accessibility'),
)

const websiteGapsCovered = JSON.parse(
  run('gaps ./templates --project ./fixtures/fake-project --checklist website --json'),
)
assert('category skills cover website domains', websiteGapsCovered.gaps.length === 0)
assert(
  'frontmatter categories count as coverage',
  websiteGapsCovered.coveredCategories.includes('accessibility'),
)

console.log('Testing spec-check command...')
const spec = JSON.parse(run('spec-check --project ./fixtures/website-project --json', { allowFail: true }))
assert('spec-check reports pass/fail/skip summary', spec.summary.pass > 0 && spec.summary.fail > 0 && spec.summary.skip > 0)
assert('spec-check passes compliant foundations', spec.findings.some(f => f.id === 'foundations.doctype' && f.status === 'pass'))
assert('spec-check fails missing robots.txt', spec.findings.some(f => f.id === 'seo.robots-txt' && f.status === 'fail'))
assert('spec-check skips runtime-only items', spec.findings.some(f => f.id === 'security.https-tls' && f.status === 'skip'))

const specRequired = JSON.parse(
  run('spec-check --project ./fixtures/website-project --priority required --json', { allowFail: true }),
)
assert('spec-check --priority filters to one priority', specRequired.findings.every(f => f.priority === 'required'))

console.log('')
if (failed > 0) {
  console.error(`${failed} failed, ${passed} passed`)
  process.exit(1)
}
console.log(`All ${passed} checks passed.`)
