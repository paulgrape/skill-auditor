import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseJson } from './helpers.mjs'

const PROJECT = './fixtures/polyglot-project'
const SKILL = './fixtures/polyglot-skill'

describe('polyglot project ground truth', () => {
  const scan = parseJson(['scan', PROJECT, '--no-cache'])

  test('reports every ecosystem it found, in a stable order', () => {
    assert.deepEqual(scan.ecosystems, ['npm', 'python', 'go', 'cargo'])
  })

  test('merges declared dependencies from every manifest', () => {
    assert.equal(scan.declaredDeps.react, '^19.0.0')
    // pyproject: PEP 621 list (normalized names, markers dropped), extras, Poetry table
    assert.equal(scan.declaredDeps.fastapi, '>=0.110')
    assert.equal(scan.declaredDeps.pydantic, '~= 2.6')
    assert.equal(scan.declaredDeps.sqlalchemy, '>=2.0')
    assert.equal(scan.declaredDeps.pytest, '>=8')
    assert.equal(scan.declaredDeps.httpx, '^0.27')
    // go.mod: direct requires only, major-version suffix folded into the module
    assert.equal(scan.declaredDeps['github.com/gin-gonic/gin'], 'v1.9.1')
    assert.equal(scan.declaredDeps['github.com/redis/go-redis'], 'v9.5.1')
    assert.equal(scan.declaredDeps['github.com/stretchr/testify'], 'v1.9.0')
    assert.ok(!('golang.org/x/sync' in scan.declaredDeps), 'indirect requires are not the stack')
    // Cargo.toml: every dependency table, hyphens normalized to the code form
    assert.equal(scan.declaredDeps.serde, '1.0')
    assert.equal(scan.declaredDeps.tokio, '1')
    assert.equal(scan.declaredDeps.tracing_subscriber, '0.3')
    assert.equal(scan.declaredDeps.proptest, '1.4')
    assert.equal(scan.declaredDeps.nix, '0.28')
    assert.equal(scan.declaredDeps.cc, '1')
  })

  test('collects imports from every language, dropping stdlib and local modules', () => {
    assert.deepEqual(scan.usedImports.react, ['react'])
    assert.deepEqual(scan.usedImports.fastapi, ['fastapi'])
    assert.deepEqual(scan.usedImports.sqlalchemy, ['sqlalchemy.orm'])
    assert.deepEqual(scan.usedImports['github.com/gin-gonic/gin'], ['github.com/gin-gonic/gin'])
    assert.deepEqual(scan.usedImports['golang.org/x/sync'], ['golang.org/x/sync/errgroup'])
    assert.deepEqual(scan.usedImports.tokio, ['tokio::sync', 'tokio::time'])
    assert.deepEqual(scan.usedImports.serde_json, ['serde_json'])
    for (const notADependency of ['os', 'sys', 'app', 'fmt', 'net/http', 'std', 'crate', 'strings']) {
      assert.ok(!(notADependency in scan.usedImports), `${notADependency} is not a dependency`)
    }
    assert.ok(
      !Object.keys(scan.usedImports).some(name => name.startsWith('example.com/')),
      'the go module’s own packages are local',
    )
  })

  test('skips imports quoted in comments and strings', () => {
    for (const decoy of ['flask', 'requests', 'rand', 'reqwest', 'hyper']) {
      assert.ok(!(decoy in scan.usedImports), `${decoy} only appears in comments/strings`)
    }
    assert.ok(!Object.keys(scan.usedImports).some(name => name.includes('should/not/count')))
  })

  test('records identifiers and evidence with the ecosystem and file', () => {
    assert.deepEqual(scan.usedIdentifiers.fastapi, ['Depends', 'FastAPI'])
    assert.deepEqual(scan.usedIdentifiers.pydantic, ['BaseModel', 'Field'])
    assert.deepEqual(scan.usedIdentifiers.serde, ['Deserialize', 'Serialize'])
    assert.deepEqual(scan.usedIdentifiers['github.com/redis/go-redis'], ['redis'])
    const byEcosystem = Object.fromEntries(
      Object.values(scan.importEvidence)
        .flat()
        .map(entry => [entry.ecosystem, entry.file]),
    )
    assert.equal(byEcosystem.npm, 'frontend/src/main.tsx')
    assert.equal(byEcosystem.python, 'backend/app/main.py')
    assert.equal(byEcosystem.go, 'services/main.go')
    assert.equal(byEcosystem.cargo, 'crates/worker/src/main.rs')
  })
})

describe('polyglot skill', () => {
  const extracted = parseJson(['extract', SKILL])

  test('reads python, go and rust fences plus bundled scripts as package references', () => {
    assert.deepEqual(extracted.packages, [
      'fastapi',
      'flask',
      'github.com/gin-gonic/gin',
      'httpx',
      'pydantic',
      'serde',
      'tokio',
    ])
    assert.deepEqual(extracted.importedIdentifiers.serde, ['Deserialize', 'Serialize'])
    assert.deepEqual(extracted.importedIdentifiers['github.com/gin-gonic/gin'], ['gin'])
    assert.equal(extracted.codeEvidence.codeFences, 4)
    assert.equal(extracted.apiCalls.length, 0)
  })

  test('every reference carries a file and line, bundled files included', () => {
    for (const ref of Object.values(extracted.packageRefs)) {
      assert.equal(typeof ref.location.file, 'string')
      assert.equal(typeof ref.location.line, 'number')
    }
    assert.deepEqual(extracted.packageRefs.fastapi.location, {
      file: 'SKILL.md',
      line: 17,
      heading: 'Backend endpoints',
    })
    assert.deepEqual(extracted.packageRefs.httpx.location, {
      file: 'scripts/check_schema.py',
      line: 3,
    })
    assert.equal(extracted.packageRefs.httpx.substantiation, 'usage')
  })

  test('audits against a polyglot project and locates the finding', () => {
    const { results } = parseJson(['audit', SKILL, '--project', PROJECT, '--no-cache', '--json'])
    const [{ report, score }] = results
    assert.equal(score.kind, 'technical')
    assert.deepEqual(report.verifiedPackages, [
      'fastapi',
      'github.com/gin-gonic/gin',
      'pydantic',
      'serde',
      'tokio',
    ])
    assert.equal(report.findings.length, 1)
    const [finding] = report.findings
    assert.equal(finding.kind, 'unused-reference')
    assert.equal(finding.skillReference, 'flask')
    assert.deepEqual(finding.location, {
      file: 'SKILL.md',
      line: 74,
      heading: 'Migrating away from Flask',
    })
  })

  test('SARIF output points at the file and line of each finding', () => {
    const sarif = parseJson([
      'audit',
      SKILL,
      '--project',
      PROJECT,
      '--no-cache',
      '--format',
      'sarif',
    ])
    const [result] = sarif.runs[0].results
    assert.equal(result.ruleId, 'unused-reference')
    const location = result.locations[0].physicalLocation
    assert.match(location.artifactLocation.uri, /polyglot-skill\/SKILL\.md$/)
    assert.equal(location.region.startLine, 74)
    assert.deepEqual(result.locations[0].logicalLocations, [
      { name: 'Migrating away from Flask', kind: 'section' },
    ])
  })
})
