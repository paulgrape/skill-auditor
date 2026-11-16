import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildAlignmentReport } from '../dist/diff.js'
import { readMakeTargets } from '../dist/repoReality.js'
import { buildSuggestions } from '../dist/suggestions.js'
import { categoriesForPackage, configureTaxonomy, MUST_HAVE_CHECKLISTS } from '../dist/taxonomy.js'
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

describe('backend taxonomy, ecosystem-qualified keys, and polyglot deprecations', () => {
  test('exposes the built-in backend checklist and backend categories across Python, Go, and Rust', () => {
    assert.deepEqual(MUST_HAVE_CHECKLISTS.backend, [
      'web-framework',
      'orm-db',
      'validation',
      'testing',
      'logging',
    ])
    assert.deepEqual(categoriesForPackage('fastapi'), ['web-framework'])
    assert.deepEqual(categoriesForPackage('github.com/gin-gonic/gin'), ['web-framework'])
    assert.deepEqual(categoriesForPackage('axum'), ['web-framework'])
    assert.deepEqual(categoriesForPackage('celery'), ['task-queue'])
    assert.deepEqual(categoriesForPackage('structlog'), ['logging'])
  })

  test('supports ecosystem-qualified taxonomy keys (ecosystem:name)', () => {
    configureTaxonomy({
      taxonomy: {
        'task-queue': ['python:redis'],
        'orm-db': ['npm:redis'],
      },
      checklists: {},
      ignore: [],
    })
    try {
      assert.deepEqual(categoriesForPackage('redis', ['python']), ['task-queue'])
      assert.deepEqual(categoriesForPackage('redis', ['npm']), ['orm-db'])
    } finally {
      configureTaxonomy()
    }
  })

  test('flags Go, Rust, and Python deprecated APIs (Tier 1 & Tier 2)', () => {
    // Go: io/ioutil and github.com/pkg/errors
    const goReport = buildAlignmentReport(
      makeSkill({
        packages: ['github.com/pkg/errors'],
        importSpecifiers: ['io/ioutil', 'github.com/pkg/errors'],
      }),
      makeRepo({
        ecosystems: ['go'],
        declaredDeps: { 'github.com/gin-gonic/gin': 'v1.9.1' },
      }),
    )
    const goDeprecated = goReport.findings
      .filter(f => f.kind === 'deprecated-api')
      .map(f => f.skillReference)
    assert.ok(goDeprecated.includes('io/ioutil'))
    assert.ok(goDeprecated.includes('github.com/pkg/errors'))

    // Rust: failure, structopt, async-std, lazy_static
    const rustReport = buildAlignmentReport(
      makeSkill({
        packages: ['failure', 'structopt', 'async_std', 'lazy_static'],
        importSpecifiers: ['failure', 'structopt', 'async_std', 'lazy_static'],
      }),
      makeRepo({
        ecosystems: ['cargo'],
        declaredDeps: { tokio: '1', clap: '4', thiserror: '1' },
      }),
    )
    const rustDeprecated = rustReport.findings
      .filter(f => f.kind === 'deprecated-api')
      .map(f => f.skillReference)
    for (const ref of ['failure', 'structopt', 'async_std', 'lazy_static']) {
      assert.ok(rustDeprecated.includes(ref), `expected ${ref} in ${rustDeprecated}`)
    }

    // Python: pydantic.v1, Pydantic v1 APIs, distutils, SQLAlchemy 1.x Query, FastAPI on_event
    const pyReport = buildAlignmentReport(
      makeSkill({
        packages: ['pydantic', 'sqlalchemy', 'fastapi', 'distutils'],
        importSpecifiers: ['pydantic.v1', 'distutils.core'],
        apiCalls: ['.dict()', '@validator', 'class Config', 'session.query', 'on_event'],
      }),
      makeRepo({
        ecosystems: ['python'],
        declaredDeps: { pydantic: '>=2.6', sqlalchemy: '>=2.0', fastapi: '>=0.111' },
      }),
    )
    const pyDeprecated = pyReport.findings
      .filter(f => f.kind === 'deprecated-api')
      .map(f => f.skillReference)
    for (const ref of [
      'pydantic.v1',
      '.dict()',
      '@validator',
      'class Config',
      'distutils',
      'session.query',
      'on_event',
    ]) {
      assert.ok(pyDeprecated.includes(ref), `expected ${ref} in ${pyDeprecated}`)
    }
  })

  test('detects Go // indirect dependencies and suggests running go mod tidy', () => {
    const skill = makeSkill({
      packages: ['golang.org/x/sync'],
      packageEcosystems: { 'golang.org/x/sync': 'go' },
    })
    const repo = makeRepo({
      ecosystems: ['go'],
      declaredDeps: { 'github.com/gin-gonic/gin': 'v1.9.1' },
      indirectDeps: { 'golang.org/x/sync': 'v0.7.0' },
    })
    const report = buildAlignmentReport(skill, repo)
    const finding = report.findings.find(f => f.skillReference === 'golang.org/x/sync')
    assert.ok(finding)
    assert.equal(finding.kind, 'missing-dependency')
    assert.equal(finding.repoReality, 'go.mod (// indirect)')

    const suggestions = buildSuggestions(report.findings, repo)
    assert.ok(suggestions.some(s => s.suggestion.includes('go mod tidy')))
  })
})

describe('stale-path and stale-command findings', () => {
  test('emits stale-path for cited project file paths that do not exist', () => {
    const skill = makeSkill({
      paths: {
        'src/app.tsx': { file: 'SKILL.md', line: 10, heading: 'Routing' },
        'src/foo.ts': { file: 'SKILL.md', line: 14, heading: 'Routing' },
        'app/main.py': { file: 'SKILL.md', line: 22, heading: 'Backend' },
      },
    })
    const repo = makeRepo({
      projectFiles: ['src/app.tsx', 'package.json'],
    })
    const report = buildAlignmentReport(skill, repo)
    const stalePaths = report.findings.filter(f => f.kind === 'stale-path')
    assert.equal(stalePaths.length, 2)
    assert.deepEqual(
      stalePaths.map(f => f.skillReference),
      ['app/main.py', 'src/foo.ts'],
    )
    assert.equal(stalePaths[0].severity, 'warning')
    assert.equal(stalePaths[1].location.line, 14)

    const suggestions = buildSuggestions(stalePaths)
    assert.ok(
      suggestions.every(s => s.suggestion.includes('does not exist in the project')),
    )
  })

  test('emits stale-command for npm/pnpm/make targets missing from package.json or Makefile', () => {
    const skill = makeSkill({
      commands: [
        {
          command: 'npm run build',
          runner: 'npm',
          target: 'build',
          location: { file: 'SKILL.md', line: 12 },
        },
        {
          command: 'pnpm lint:fix',
          runner: 'pnpm',
          target: 'lint:fix',
          location: { file: 'SKILL.md', line: 15 },
        },
        {
          command: 'make deploy',
          runner: 'make',
          target: 'deploy',
          location: { file: 'SKILL.md', line: 20 },
        },
      ],
    })
    const repo = makeRepo({
      scripts: ['build', 'test'],
      makeTargets: ['check', 'test'],
    })
    const report = buildAlignmentReport(skill, repo)
    const staleCommands = report.findings.filter(f => f.kind === 'stale-command')
    assert.equal(staleCommands.length, 2)
    assert.deepEqual(
      staleCommands.map(f => f.skillReference),
      ['pnpm lint:fix', 'make deploy'],
    )
    assert.equal(staleCommands[0].repoReality, 'build, test')
    assert.equal(staleCommands[1].repoReality, 'check, test')

    const suggestions = buildSuggestions(staleCommands)
    assert.ok(suggestions[0].suggestion.includes('build, test'))
    assert.ok(suggestions[1].suggestion.includes('check, test'))
  })

  test('readMakeTargets parses .PHONY and target rules while ignoring variables and pattern rules', () => {
    const makefile = [
      '# Build makefile',
      '.PHONY: build lint',
      'CC := gcc',
      'FLAGS ?= -O2',
      '%.o: %.c',
      '\t$(CC) -c $<',
      'build:',
      '\tgo build ./...',
      'test-unit test-int: build',
      '\tgo test ./...',
    ].join('\n')
    assert.deepEqual(readMakeTargets(makefile), [
      'build',
      'lint',
      'test-int',
      'test-unit',
    ])
  })
})
