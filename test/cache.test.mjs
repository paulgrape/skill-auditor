import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  auditSkillsSafely,
  buildRepoReality,
  clearRealityCache,
  CONTENT_HASH_MAX_BYTES,
  detectGaps,
  extractSkillIdentifiers,
  findSkillDirs,
  fingerprintProject,
  walkProject,
} from '../dist/index.js'
import { parseJson, repoRoot } from './helpers.mjs'

const packageVersion = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
).version

/**
 * The cache is observable only through its effects, so these tests plant a
 * marker in the cached reality: a scan that still shows the marker was served
 * from the cache, one that does not was rebuilt.
 */
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-cache-'))
  const project = path.join(dir, 'project')
  const cacheDir = path.join(dir, 'cache')
  fs.cpSync(path.join(repoRoot, 'fixtures/fake-project'), project, { recursive: true })
  const env = { SKILL_AUDITOR_CACHE_DIR: cacheDir, SKILL_AUDITOR_NO_CACHE: '' }
  const scan = args => parseJson(['scan', project, ...args], { env })
  const cacheFile = () => {
    const files = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []
    assert.equal(files.length, 1, `expected one cache entry, found ${files.join(', ')}`)
    return path.join(cacheDir, files[0])
  }
  const plantMarker = () => {
    const file = cacheFile()
    const entry = JSON.parse(fs.readFileSync(file, 'utf-8'))
    entry.reality.declaredDeps['cache-marker'] = 'served-from-cache'
    fs.writeFileSync(file, JSON.stringify(entry))
  }
  return { dir, project, cacheDir, scan, cacheFile, plantMarker }
}

describe('RepoReality cache', () => {
  test('writes an entry keyed by the project and serves it while nothing changed', () => {
    const { dir, scan, cacheFile, plantMarker } = setup()
    try {
      const first = scan([])
      assert.ok(!('cache-marker' in first.declaredDeps))
      const entry = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8'))
      assert.equal(typeof entry.fingerprint, 'string')
      assert.equal(entry.version, packageVersion)

      plantMarker()
      const second = scan([])
      assert.equal(second.declaredDeps['cache-marker'], 'served-from-cache')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a source edit invalidates the entry', () => {
    const { dir, project, scan, plantMarker } = setup()
    try {
      scan([])
      plantMarker()
      fs.appendFileSync(path.join(project, 'src/app.tsx'), "\nimport { z } from 'zod'\nexport const s = z.string()\n")
      const rebuilt = scan([])
      assert.ok(!('cache-marker' in rebuilt.declaredDeps))
      assert.deepEqual(rebuilt.usedImports.zod, ['zod'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a manifest edit invalidates the entry', () => {
    const { dir, project, scan, plantMarker } = setup()
    try {
      scan([])
      plantMarker()
      const pkgPath = path.join(project, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      pkg.dependencies.zod = '^3.0.0'
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
      const rebuilt = scan([])
      assert.ok(!('cache-marker' in rebuilt.declaredDeps))
      assert.equal(rebuilt.declaredDeps.zod, '^3.0.0')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a config edit invalidates the entry', () => {
    const { dir, project, scan, plantMarker } = setup()
    try {
      scan([])
      plantMarker()
      fs.writeFileSync(
        path.join(project, '.skill-auditor.json'),
        JSON.stringify({ ignore: ['**/src/**'] }),
      )
      const rebuilt = scan([])
      assert.ok(!('cache-marker' in rebuilt.declaredDeps))
      assert.deepEqual(rebuilt.usedImports, {}, 'the new ignore glob applies to the rebuild')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('switching parsers never serves the other parser’s entry', () => {
    const { dir, scan, plantMarker } = setup()
    try {
      scan([])
      plantMarker()
      const tsMorph = scan(['--parser', 'ts-morph'])
      assert.ok(!('cache-marker' in tsMorph.declaredDeps))
      assert.equal(tsMorph.parser, 'ts-morph')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('--no-cache and SKILL_AUDITOR_NO_CACHE bypass a valid entry', () => {
    const { dir, project, scan, plantMarker } = setup()
    try {
      scan([])
      plantMarker()
      assert.ok(!('cache-marker' in scan(['--no-cache']).declaredDeps))
      const viaEnv = parseJson(['scan', project], {
        env: { SKILL_AUDITOR_CACHE_DIR: path.join(dir, 'cache'), SKILL_AUDITOR_NO_CACHE: '1' },
      })
      assert.ok(!('cache-marker' in viaEnv.declaredDeps))
      // The entry itself is untouched by a bypass, so the next cached run still hits.
      assert.equal(scan([]).declaredDeps['cache-marker'], 'served-from-cache')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a corrupt entry is ignored and rewritten', () => {
    const { dir, scan, cacheFile } = setup()
    try {
      scan([])
      fs.writeFileSync(cacheFile(), '{not json')
      const rebuilt = scan([])
      assert.deepEqual(Object.keys(rebuilt.declaredDeps).sort(), ['next', 'react', 'zustand'])
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(cacheFile(), 'utf-8')))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('content hash invalidates same-size, same-mtime edits for files under the threshold', () => {
    const { dir, project, scan, plantMarker } = setup()
    try {
      scan([])
      plantMarker()
      const appPath = path.join(project, 'src/app.tsx')
      const original = fs.readFileSync(appPath, 'utf-8')
      const origStat = fs.statSync(appPath)
      assert.ok(origStat.size <= CONTENT_HASH_MAX_BYTES)

      // Replace 'zustand' (7 chars) with 'jotai  ' (7 chars) so byte size is identical,
      // then restore exact atime/mtime timestamps.
      const modified = original.replace("'zustand'", "'jotai'  ")
      assert.equal(Buffer.byteLength(modified), Buffer.byteLength(original))
      fs.writeFileSync(appPath, modified, 'utf-8')
      fs.utimesSync(appPath, origStat.atime, origStat.mtime)

      const rebuilt = scan([])
      assert.ok(!('cache-marker' in rebuilt.declaredDeps), 'same-size/same-mtime edit invalidated cache via content hash')
      assert.ok('jotai' in rebuilt.usedImports)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('files above CONTENT_HASH_MAX_BYTES use mtime+size without reading contents during fingerprint', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-large-fp-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'large-test', dependencies: { zod: '^3.0.0' } }),
      )
      const largeFile = path.join(dir, 'large.ts')
      const padding = '// ' + 'x'.repeat(CONTENT_HASH_MAX_BYTES + 1024) + '\n'
      fs.writeFileSync(largeFile, padding + "import { z } from 'zod'\n", 'utf-8')

      const walked = walkProject(dir)
      const fp1 = fingerprintProject(dir, 'lexer', walked)
      const largeEntry = walked.files.find(f => f.relativePath === 'large.ts')
      assert.ok(largeEntry)
      assert.ok(largeEntry.size > CONTENT_HASH_MAX_BYTES)
      assert.equal(
        largeEntry.content,
        undefined,
        'files over threshold are not read into memory during fingerprinting',
      )

      // Changing mtime on the large file changes the fingerprint.
      const future = new Date(Date.now() + 60_000)
      fs.utimesSync(largeFile, future, future)
      const fp2 = fingerprintProject(dir, 'lexer')
      assert.notEqual(fp1, fp2)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('per-skill extraction cache shares extracted SkillIdentifiers between audit and gaps and invalidates on edit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-skill-cache-'))
    const prevCacheDir = process.env.SKILL_AUDITOR_CACHE_DIR
    try {
      const skillsRoot = path.join(dir, 'skills')
      const skillDir = path.join(skillsRoot, 'aligned-skill')
      const cacheDir = path.join(dir, 'cache')
      const skillsCacheDir = `${cacheDir}-skills`
      fs.cpSync(path.join(repoRoot, 'fixtures/aligned-skill'), skillDir, { recursive: true })
      process.env.SKILL_AUDITOR_CACHE_DIR = cacheDir
      clearRealityCache()

      const repo = buildRepoReality(path.join(repoRoot, 'fixtures/fake-project'))
      const dirs = findSkillDirs([skillsRoot])
      const { results } = auditSkillsSafely(repo, dirs)
      assert.equal(results.length, 1)

      const skillCacheFiles = fs.readdirSync(skillsCacheDir)
      assert.equal(skillCacheFiles.length, 1)
      const skillCacheFile = path.join(skillsCacheDir, skillCacheFiles[0])

      // Plant a synthetic category on the disk cache entry and clear in-memory cache
      // so detectGaps proves it reads from the per-skill cache rather than re-extracting.
      const cachedEntry = JSON.parse(fs.readFileSync(skillCacheFile, 'utf-8'))
      cachedEntry.skill.categories.push('cached-sentinel-category')
      fs.writeFileSync(skillCacheFile, JSON.stringify(cachedEntry))
      clearRealityCache()

      const gaps = detectGaps(repo, [skillsRoot])
      assert.ok(
        gaps.coveredCategories.includes('cached-sentinel-category'),
        'detectGaps reused cached skill extraction',
      )

      // Editing SKILL.md invalidates the skill cache entry.
      fs.appendFileSync(path.join(skillDir, 'SKILL.md'), '\n<!-- edited -->\n')
      const reextracted = extractSkillIdentifiers(skillDir)
      assert.ok(!reextracted.categories.has('cached-sentinel-category'))
    } finally {
      if (prevCacheDir === undefined) delete process.env.SKILL_AUDITOR_CACHE_DIR
      else process.env.SKILL_AUDITOR_CACHE_DIR = prevCacheDir
      clearRealityCache()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
