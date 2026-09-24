import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  maskJavaScript,
  parseImportClause,
  scanJavaScriptImports,
} from '../dist/ecosystems/javascript.js'
import { lineOf } from '../dist/ecosystems/types.js'
import { buildRepoReality, resolveParser } from '../dist/repoReality.js'
import { parseJson, repoRoot, runExpectingFailure } from './helpers.mjs'

const EDGE_FIXTURE = path.join(repoRoot, 'fixtures/lexer-edge-cases')
const edgeSource = fs.readFileSync(path.join(EDGE_FIXTURE, 'src/edge.tsx'), 'utf-8')

const bySpecifier = imports =>
  Object.fromEntries(imports.map(imp => [imp.specifier, imp]))

describe('maskJavaScript', () => {
  test('keeps length and line structure while blanking non-code', () => {
    const source = "const a = 'x\\'y' // c\n/* m\nl */ const r = /'/g; `t${'n'}`"
    const { text } = maskJavaScript(source)
    assert.equal(text.length, source.length)
    assert.equal(text.split('\n').length, source.split('\n').length)
    assert.ok(!text.includes("x\\'y"))
    assert.ok(!text.includes('// c'))
    assert.ok(!text.includes('l */'))
  })

  test('preserves strings in specifier position only', () => {
    const { text } = maskJavaScript(
      "import a from 'pkg-a'; const s = 'not-a-pkg'; require('pkg-b'); import('pkg-c')",
    )
    assert.ok(text.includes("'pkg-a'"))
    assert.ok(text.includes("'pkg-b'"))
    assert.ok(text.includes("'pkg-c'"))
    assert.ok(!text.includes('not-a-pkg'))
  })

  test('tells division from regex literals', () => {
    const { text } = maskJavaScript("const a = 10 / 2 / 1; const b = /import 'x'/g")
    assert.ok(text.includes('10 / 2 / 1'))
    assert.ok(!text.includes("import 'x'"))
  })
})

describe('parseImportClause', () => {
  test('default, namespace, named, aliased and type-only bindings', () => {
    const sorted = list => [...list].sort((a, b) => (a.local < b.local ? -1 : 1))
    // The default import is recorded under its local name, like ts-morph's
    // `getDefaultImport().getText()`, so both parsers fill usedIdentifiers alike.
    assert.deepEqual(sorted(parseImportClause('React, { useState, type FC, a as b }')), [
      { source: 'FC', local: 'FC' },
      { source: 'React', local: 'React' },
      { source: 'a', local: 'b' },
      { source: 'useState', local: 'useState' },
    ])
    assert.deepEqual(parseImportClause('* as Query'), [
      { source: 'Query', local: 'Query' },
    ])
    assert.deepEqual(parseImportClause('type { Only }'), [
      { source: 'Only', local: 'Only' },
    ])
  })
})

describe('scanJavaScriptImports', () => {
  const imports = scanJavaScriptImports(edgeSource)
  const found = bySpecifier(imports)

  test('finds every real import form', () => {
    assert.deepEqual(Object.keys(found).sort(), [
      './local/module',
      '@tanstack/react-query',
      'chalk',
      'clsx',
      'dayjs',
      'lodash-es',
      'next/dynamic',
      'next/navigation',
      'react',
      'side-effect-only',
      'zod',
    ])
  })

  test('ignores imports inside comments, strings, templates, regexes and JSX', () => {
    const specifiers = Object.keys(found)
    for (const decoy of [
      'commented-out-line',
      'commented-out-block',
      'nope',
      'string-import',
      'template-import',
      'template-require',
      'regex-import',
      'jsx-attribute',
      'jsx-template',
    ]) {
      assert.ok(!specifiers.includes(decoy), `${decoy} should be masked`)
    }
    assert.ok(!specifiers.some(s => s.includes('example.com')))
  })

  test('reduces specifiers to package names, relative paths to none', () => {
    assert.equal(found['next/navigation'].packageName, 'next')
    assert.equal(found['@tanstack/react-query'].packageName, '@tanstack/react-query')
    assert.equal(found['./local/module'].packageName, '')
  })

  test('records bindings by source name and knows when it cannot', () => {
    assert.deepEqual(
      found.react.bindings.map(b => b.source).sort(),
      ['FC', 'React', 'useState'],
    )
    assert.deepEqual(found['lodash-es'].bindings, [
      { source: 'debounce', local: 'delay' },
      { source: 'throttle', local: 'throttle' },
    ])
    assert.deepEqual(found['@tanstack/react-query'].bindings, [
      { source: 'Query', local: 'Query' },
    ])
    assert.equal(found['side-effect-only'].bindingsKnown, true)
    assert.deepEqual(found['side-effect-only'].bindings, [])
    // A destructured require has no clause the lexer parses.
    assert.equal(found.clsx.bindingsKnown, false)
  })

  test('offsets point at the statement in the original source', () => {
    for (const imp of imports) {
      assert.equal(edgeSource.slice(imp.start, imp.end), imp.text)
    }
    assert.equal(lineOf(edgeSource, found.react.start), 3) // 0-based: line 4 of the file
    assert.equal(found.react.text, "import React, { useState, type FC } from 'react'")
    assert.equal(found['next/dynamic'].text, "import('next/dynamic')")
  })

  test('handles CRLF, semicolon-free and multi-line statements', () => {
    const source =
      "import {\r\n  a,\r\n  b as c\r\n} from 'multi'\r\nimport d from \"dq\"\r\nexport * as ns from 'reexport'"
    const found = bySpecifier(scanJavaScriptImports(source))
    assert.deepEqual(Object.keys(found).sort(), ['dq', 'multi', 'reexport'])
    assert.deepEqual(found.multi.bindings, [
      { source: 'a', local: 'a' },
      { source: 'b', local: 'c' },
    ])
  })

  test('does not read import.meta or member access named require as imports', () => {
    const found = bySpecifier(
      scanJavaScriptImports(
        "const u = import.meta.url; obj.require('x'); const m = module.require('y'); require.resolve('z')",
      ),
    )
    assert.deepEqual(Object.keys(found), [])
  })
})

describe('parser selection', () => {
  test('defaults to the lexer and rejects unknown parsers', () => {
    assert.equal(resolveParser(), 'lexer')
    assert.equal(resolveParser('ts-morph'), 'ts-morph')
    assert.throws(() => resolveParser('babel'), /Unknown parser "babel"/)
  })

  test('the CLI rejects an unknown --parser as a usage error', () => {
    const { status, stderr } = runExpectingFailure([
      'scan',
      './fixtures/fake-project',
      '--parser',
      'babel',
      '--no-cache',
    ])
    assert.equal(status, 2)
    assert.match(stderr, /Invalid --parser: Unknown parser "babel"/)
  })
})

describe('lexer / ts-morph parity', () => {
  // ts-morph is a devDependency here, so the optional path is exercised in CI.
  const stable = reality => ({
    ecosystems: reality.ecosystems,
    declaredDeps: reality.declaredDeps,
    usedImports: Object.fromEntries(
      Object.entries(reality.usedImports).map(([k, v]) => [k, [...v].sort()]),
    ),
    usedIdentifiers: Object.fromEntries(
      Object.entries(reality.usedIdentifiers).map(([k, v]) => [k, [...v].sort()]),
    ),
    importEvidence: Object.fromEntries(
      Object.entries(reality.importEvidence).map(([k, v]) => [
        k,
        [...v].sort((a, b) => a.specifier.localeCompare(b.specifier)),
      ]),
    ),
  })

  for (const fixture of ['lexer-edge-cases', 'fake-project', 'polyglot-project']) {
    test(`both parsers agree on ${fixture}`, () => {
      const root = path.join(repoRoot, 'fixtures', fixture)
      const lexer = buildRepoReality(root, { cache: false, parser: 'lexer' })
      const tsMorph = buildRepoReality(root, { cache: false, parser: 'ts-morph' })
      assert.deepEqual(stable(lexer), stable(tsMorph))
    })
  }

  test('the scan report names the parser that produced it', () => {
    const lexer = parseJson(['scan', './fixtures/fake-project', '--no-cache'])
    const tsMorph = parseJson([
      'scan',
      './fixtures/fake-project',
      '--no-cache',
      '--parser',
      'ts-morph',
    ])
    assert.equal(lexer.parser, 'lexer')
    assert.equal(tsMorph.parser, 'ts-morph')
  })
})
