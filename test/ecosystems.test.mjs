import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { goPackageName, readGoMod, scanGoImports } from '../dist/ecosystems/go.js'
import {
  normalizePythonName,
  parseRequirement,
  readPyproject,
  readRequirements,
  scanPythonImports,
} from '../dist/ecosystems/python.js'
import { readCargoToml, rustCrateName, scanRustImports } from '../dist/ecosystems/rust.js'
import { lineOf } from '../dist/ecosystems/types.js'
import { parseToml } from '../dist/toml.js'

const specifiers = imports => imports.map(imp => imp.specifier).sort()
const packages = imports => [...new Set(imports.map(imp => imp.packageName))].sort()

describe('toml', () => {
  test('tables, dotted keys, arrays, inline tables and arrays of tables', () => {
    const doc = parseToml(`
# comment
title = "x" # trailing comment
[a.b]
c = 1
d = [ "one",
  'two', # inside array
]
e = { f = true, g = "h" }
"quoted key" = 'literal'
[[arr]]
n = 1
[[arr]]
n = 2
[dep.'cfg(unix)'.x]
y = "z"
`)
    assert.equal(doc.title, 'x')
    assert.deepEqual(doc.a.b.c, 1)
    assert.deepEqual(doc.a.b.d, ['one', 'two'])
    assert.deepEqual(doc.a.b.e, { f: true, g: 'h' })
    assert.equal(doc.a.b['quoted key'], 'literal')
    assert.deepEqual(doc.arr, [{ n: 1 }, { n: 2 }])
    assert.equal(doc.dep['cfg(unix)'].x.y, 'z')
  })

  test('multi-line strings and escapes', () => {
    const doc = parseToml('a = """\nline\n"""\nb = "tab\\tq\\"" \nc = \'\'\'raw \\n\'\'\'')
    assert.equal(doc.a, 'line\n')
    assert.equal(doc.b, 'tab\tq"')
    assert.equal(doc.c, 'raw \\n')
  })
})

describe('python', () => {
  test('normalizes names per PEP 503 and parses PEP 508 requirements', () => {
    assert.equal(normalizePythonName('Python_Dotenv.Extra'), 'python-dotenv-extra')
    assert.deepEqual(parseRequirement('requests[security]>=2.0; python_version>"3"'), {
      name: 'requests',
      version: '>=2.0',
    })
    assert.deepEqual(parseRequirement('SQLAlchemy'), { name: 'sqlalchemy', version: '*' })
    assert.deepEqual(parseRequirement('pkg @ https://x/y.whl'), {
      name: 'pkg',
      version: 'https://x/y.whl',
    })
    assert.equal(parseRequirement('# comment'), null)
    assert.equal(parseRequirement('-r other.txt'), null)
  })

  test('reads PEP 621, optional groups, dependency-groups and Poetry tables', () => {
    const deps = readPyproject(`
[project]
dependencies = ["fastapi>=0.1", "Pydantic ~= 2"]
[project.optional-dependencies]
dev = ["pytest"]
[dependency-groups]
lint = ["ruff==0.4"]
[tool.poetry.dependencies]
python = "^3.11"
httpx = { version = "^0.27", extras = ["http2"] }
local-lib = { path = "../lib" }
[tool.poetry.group.test.dependencies]
coverage = "^7"
`)
    assert.deepEqual(deps, {
      fastapi: '>=0.1',
      pydantic: '~= 2',
      pytest: '*',
      ruff: '==0.4',
      httpx: '^0.27',
      'local-lib': 'path:../lib',
      coverage: '^7',
    })
  })

  test('reads requirements.txt with comments, options and continuations', () => {
    const deps = readRequirements(
      '# deps\n-r base.txt\nDjango>=4.2 # web\nnumpy \\\n  ==1.26\n--index-url https://x\n\ncelery[redis]',
    )
    assert.deepEqual(deps, { django: '>=4.2', numpy: '==1.26', celery: '*' })
  })

  test('scans imports, skips stdlib, relative and local modules, strings and comments', () => {
    const source = [
      '"""docstring says import flask"""',
      'import os, numpy as np',
      'import sqlalchemy.orm',
      'from fastapi import FastAPI, Depends as Dep',
      'from pydantic import (',
      '    BaseModel,',
      '    Field,',
      ')',
      'from . import sibling',
      'from app.settings import X',
      '# import requests',
      'text = "import yaml"',
    ].join('\n')
    const imports = scanPythonImports(source, { localModules: new Set(['app']) })
    assert.deepEqual(packages(imports).filter(Boolean), [
      'fastapi',
      'numpy',
      'pydantic',
      'sqlalchemy',
    ])
    assert.ok(!specifiers(imports).includes('flask'))
    assert.ok(!specifiers(imports).includes('requests'))
    assert.ok(!specifiers(imports).includes('yaml'))
    const fastapi = imports.find(imp => imp.packageName === 'fastapi')
    assert.deepEqual(fastapi.bindings, [
      { source: 'FastAPI', local: 'FastAPI' },
      { source: 'Depends', local: 'Dep' },
    ])
    // A whole-module import is bound under its local name, like a JS default import.
    const numpy = imports.find(imp => imp.packageName === 'numpy')
    assert.deepEqual(numpy.bindings, [{ source: 'np', local: 'np' }])
    const pydantic = imports.find(imp => imp.packageName === 'pydantic')
    assert.deepEqual(
      pydantic.bindings.map(b => b.source),
      ['BaseModel', 'Field'],
    )
    assert.equal(lineOf(source, pydantic.start), 4) // 0-based
    assert.equal(source.slice(pydantic.start, pydantic.end).trim(), pydantic.text)
  })
})

describe('go', () => {
  test('reduces import paths to modules and drops stdlib and local packages', () => {
    assert.equal(goPackageName('fmt'), '')
    assert.equal(goPackageName('net/http'), '')
    assert.equal(goPackageName('github.com/gin-gonic/gin/binding'), 'github.com/gin-gonic/gin')
    assert.equal(goPackageName('github.com/redis/go-redis/v9'), 'github.com/redis/go-redis')
    assert.equal(goPackageName('golang.org/x/sync/errgroup'), 'golang.org/x/sync')
    assert.equal(goPackageName('gopkg.in/yaml.v3'), 'gopkg.in/yaml.v3')
    assert.equal(goPackageName('example.com/app/internal/x', 'example.com/app'), '')
    assert.equal(
      goPackageName('example.com/worker/internal/jobs', ['example.com/api', 'example.com/worker']),
      '',
    )
    // A single local module must not hide a sibling module as a dependency.
    assert.equal(
      goPackageName('example.com/worker/internal/jobs', 'example.com/api'),
      'example.com/worker',
    )
  })

  test('reads go.mod: module path, direct requires, normalized major versions', () => {
    const mod = readGoMod(`
module example.com/app

go 1.22

require (
\tgithub.com/gin-gonic/gin v1.9.1
\tgithub.com/redis/go-redis/v9 v9.5.1
\tgolang.org/x/sync v0.7.0 // indirect
)

require github.com/stretchr/testify v1.9.0
replace github.com/gin-gonic/gin => ../gin
`)
    assert.equal(mod.modulePath, 'example.com/app')
    assert.deepEqual(mod.require, {
      'github.com/gin-gonic/gin': 'v1.9.1',
      'github.com/redis/go-redis': 'v9.5.1',
      'github.com/stretchr/testify': 'v1.9.0',
    })
  })

  test('scans single and block imports with aliases, ignoring comments', () => {
    const source = [
      'package main',
      '/* import "github.com/no/block" */',
      'import "github.com/single/one"',
      'import (',
      '\t"fmt"',
      '\t"example.com/app/internal/store"',
      '\tredis "github.com/redis/go-redis/v9"',
      '\t_ "golang.org/x/sync/errgroup"',
      ')',
      '// import "github.com/no/line"',
      'var s = `import "github.com/no/raw"`',
    ].join('\n')
    const imports = scanGoImports(source, { localModule: 'example.com/app' })
    assert.deepEqual(specifiers(imports), [
      'example.com/app/internal/store',
      'fmt',
      'github.com/redis/go-redis/v9',
      'github.com/single/one',
      'golang.org/x/sync/errgroup',
    ])
    assert.deepEqual(packages(imports), [
      '',
      'github.com/redis/go-redis',
      'github.com/single/one',
      'golang.org/x/sync',
    ])
    const redis = imports.find(imp => imp.specifier.includes('go-redis'))
    assert.deepEqual(redis.bindings, [{ source: 'redis', local: 'redis' }])
    const blank = imports.find(imp => imp.specifier.includes('errgroup'))
    assert.deepEqual(blank.bindings, [])
    assert.equal(lineOf(source, redis.start), 6) // 0-based
  })
})

describe('rust', () => {
  test('normalizes crate names to their identifier form', () => {
    assert.equal(rustCrateName('tokio-util'), 'tokio_util')
  })

  test('reads every dependency table of a Cargo.toml', () => {
    const deps = readCargoToml(`
[package]
name = "worker"
[dependencies]
serde = { version = "1.0", features = ["derive"] }
tracing-subscriber = "0.3"
local = { path = "../local" }
shared = { workspace = true }
[dev-dependencies]
proptest = "1.4"
[build-dependencies]
cc = "1"
[target.'cfg(unix)'.dependencies]
nix = "0.28"
[workspace.dependencies]
anyhow = "1"
`)
    assert.deepEqual(deps, {
      serde: '1.0',
      tracing_subscriber: '0.3',
      local: 'path:../local',
      shared: 'workspace',
      proptest: '1.4',
      cc: '1',
      nix: '0.28',
      anyhow: '1',
    })
  })

  test('scans use trees, extern crate and bare paths, ignoring std/crate/self/super', () => {
    const source = [
      '//! use rand::Rng; in docs',
      'use std::collections::HashMap;',
      'use serde::{Deserialize, Serialize};',
      'use tokio::{sync::mpsc, time::Duration};',
      'use tracing_subscriber::fmt as tracing_fmt;',
      'use crate::config::Settings;',
      'use super::*;',
      'extern crate anyhow;',
      '/* use reqwest::Client; */',
      'fn main() {',
      '    let s = "use hyper::Body;";',
      '    let v = serde_json::from_str(s);',
      '}',
    ].join('\n')
    const imports = scanRustImports(source, {
      declaredCrates: new Set(['serde', 'tokio', 'tracing_subscriber', 'anyhow', 'serde_json']),
    })
    assert.deepEqual(packages(imports).filter(Boolean), [
      'anyhow',
      'serde',
      'serde_json',
      'tokio',
      'tracing_subscriber',
    ])
    for (const decoy of ['rand', 'reqwest', 'hyper', 'std', 'crate', 'super']) {
      assert.ok(!packages(imports).includes(decoy), `${decoy} should not be a crate reference`)
    }
    const tokio = imports.filter(imp => imp.packageName === 'tokio')
    assert.deepEqual(specifiers(tokio), ['tokio::sync', 'tokio::time'])
    assert.deepEqual(
      tokio.flatMap(imp => imp.bindings.map(b => b.local)).sort(),
      ['Duration', 'mpsc'],
    )
    const tracing = imports.find(imp => imp.packageName === 'tracing_subscriber')
    assert.deepEqual(tracing.bindings, [{ source: 'fmt', local: 'tracing_fmt' }])
    assert.equal(lineOf(source, tracing.start), 4) // 0-based
  })
})
