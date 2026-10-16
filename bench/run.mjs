#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  auditSkillsSafely,
  buildRepoReality,
  buildRepoRealityAsync,
  clearRealityCache,
  detectGaps,
  findSkillDirs,
  mapConcurrent,
  walkProjectAsync,
} from '../dist/index.js'

/**
 * Benchmarks skill-auditor against a synthetic 10,000-file polyglot tree.
 *
 * Usage:
 *   node bench/run.mjs [--files 10000] [--json]
 *
 * When $GITHUB_STEP_SUMMARY is set in CI, appends a Markdown summary table to
 * the GitHub Actions job summary.
 */

function parseArgs(argv) {
  let fileCount = Number.parseInt(
    process.env.SKILL_AUDITOR_BENCH_FILES ?? '10000',
    10,
  )
  let json = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--files' && argv[i + 1]) {
      fileCount = Number.parseInt(argv[++i], 10)
    } else if (argv[i] === '--json') {
      json = true
    }
  }
  if (!Number.isFinite(fileCount) || fileCount < 10) {
    throw new Error(`Invalid --files count: ${fileCount}`)
  }
  return { fileCount, json }
}

const TEMPLATES = [
  {
    ext: '.tsx',
    body: i =>
      `import { useRouter, usePathname } from 'next/navigation'\nimport { create } from 'zustand'\nimport { z } from 'zod'\nexport const Schema${i} = z.object({ id: z.string() })\nexport const useStore${i} = create(() => ({ pathname: usePathname, router: useRouter }))\n`,
  },
  {
    ext: '.ts',
    body: i =>
      `import { useQuery } from '@tanstack/react-query'\nimport { z } from 'zod'\nexport function fetchItem${i}() { return useQuery({ queryKey: ['item', ${i}], queryFn: () => z.string().parse('ok') }) }\n`,
  },
  {
    ext: '.py',
    body: i =>
      `from fastapi import FastAPI, Depends\nfrom pydantic import BaseModel\nimport httpx\n\nclass Item${i}(BaseModel):\n    name: str\n`,
  },
  {
    ext: '.go',
    body: i =>
      `package pkg\n\nimport (\n\t"github.com/gin-gonic/gin"\n\t"go.uber.org/zap"\n)\n\nfunc Route${i}(r *gin.Engine, log *zap.Logger) {}\n`,
  },
  {
    ext: '.rs',
    body: i =>
      `use axum::{Router, routing::get};\nuse serde::{Deserialize, Serialize};\n\n#[derive(Serialize, Deserialize)]\npub struct Payload${i} { pub id: u64 }\n`,
  },
]

async function generateSyntheticRepo(projectDir, skillsDir, fileCount) {
  const start = performance.now()
  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(skillsDir, { recursive: true })

  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: 'bench-synthetic-repo',
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
          zustand: '^5.0.0',
          zod: '^3.23.0',
          '@tanstack/react-query': '^5.0.0',
        },
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(
    path.join(projectDir, 'pyproject.toml'),
    `[project]\nname = "bench-service"\ndependencies = ["fastapi>=0.115.0", "pydantic>=2.9.0", "httpx>=0.27.0"]\n`,
  )
  fs.writeFileSync(
    path.join(projectDir, 'go.mod'),
    `module example.com/bench\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n\tgo.uber.org/zap v1.27.0\n)\n`,
  )
  fs.writeFileSync(
    path.join(projectDir, 'Cargo.toml'),
    `[package]\nname = "bench"\nversion = "0.1.0"\n\n[dependencies]\naxum = "0.7"\nserde = "1.0"\n`,
  )

  const dirCount = Math.min(100, Math.max(1, Math.ceil(fileCount / 100)))
  const dirs = Array.from({ length: dirCount }, (_, d) =>
    path.join(projectDir, 'src', `mod-${String(d).padStart(3, '0')}`),
  )
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const indices = Array.from({ length: fileCount }, (_, i) => i)
  await mapConcurrent(indices, 64, async i => {
    const template = TEMPLATES[i % TEMPLATES.length]
    const dir = dirs[i % dirs.length]
    const filePath = path.join(dir, `file_${i}${template.ext}`)
    await fs.promises.writeFile(filePath, template.body(i), 'utf-8')
  })

  const categories = [
    {
      name: 'routing',
      code: "```ts\nimport { useRouter } from 'next/navigation'\nexport const nav = () => useRouter().push('/home')\n```",
    },
    {
      name: 'state',
      code: "```ts\nimport { create } from 'zustand'\nexport const useStore = create(() => ({ count: 0 }))\n```",
    },
    {
      name: 'validation',
      code: "```ts\nimport { z } from 'zod'\nexport const User = z.object({ id: z.string() })\n```",
    },
    {
      name: 'web-framework',
      code: '```python\nfrom fastapi import FastAPI\napp = FastAPI()\n```',
    },
  ]
  for (const cat of categories) {
    const dir = path.join(skillsDir, cat.name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      [
        '---',
        `name: ${cat.name}`,
        `description: ${cat.name} patterns for this project. Use when editing ${cat.name} modules.`,
        'metadata:',
        `  categories: ${cat.name}`,
        '---',
        '',
        `# ${cat.name}`,
        '',
        `This project uses standard ${cat.name} conventions across all service modules and frontend routes.`,
        '',
        cat.code,
        '',
      ].join('\n'),
    )
  }

  return performance.now() - start
}

function roundMs(ms) {
  return Math.round(ms * 10) / 10
}

function formatMarkdown(metrics) {
  const lines = [
    `### \`skill-auditor\` Synthetic Benchmark (${metrics.fileCount.toLocaleString('en-US')} source files)`,
    '',
    '| Step | Duration (ms) | Throughput (files/s) | Notes |',
    '|------|--------------:|---------------------:|-------|',
    `| Generate synthetic tree | ${metrics.setupMs.toFixed(1)} | ${Math.round((metrics.fileCount / metrics.setupMs) * 1000).toLocaleString('en-US')} | ${metrics.walkedFiles.toLocaleString('en-US')} total files (sources + manifests) |`,
    `| Single tree walk (\`walkProjectAsync\`) | ${metrics.walkMs.toFixed(1)} | ${Math.round((metrics.walkedFiles / metrics.walkMs) * 1000).toLocaleString('en-US')} | \`fast-glob\` with stats |`,
    `| Cold async scan (\`buildRepoRealityAsync\`) | ${metrics.coldAsyncMs.toFixed(1)} | ${Math.round((metrics.walkedFiles / metrics.coldAsyncMs) * 1000).toLocaleString('en-US')} | Single walk + content-hash fingerprint + scan |`,
    `| Warm async scan (cache hit) | ${metrics.warmAsyncMs.toFixed(1)} | ${Math.round((metrics.walkedFiles / metrics.warmAsyncMs) * 1000).toLocaleString('en-US')} | Served from fingerprinted cache (${metrics.speedup}x faster) |`,
    `| Cold sync scan (\`buildRepoReality\`, no cache) | ${metrics.coldSyncMs.toFixed(1)} | ${Math.round((metrics.walkedFiles / metrics.coldSyncMs) * 1000).toLocaleString('en-US')} | Synchronous baseline |`,
    `| Cold \`auditSkillsSafely\` (${metrics.skillCount} skills) | ${metrics.coldAuditMs.toFixed(1)} | — | Populates per-skill extraction cache |`,
    `| Warm \`detectGaps\` (${metrics.skillCount} skills) | ${metrics.warmGapsMs.toFixed(1)} | — | Reuses per-skill extraction cache |`,
    '',
  ]
  return lines.join('\n')
}

async function main() {
  const { fileCount, json } = parseArgs(process.argv.slice(2))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-auditor-bench-'))
  const projectDir = path.join(root, 'project')
  const skillsDir = path.join(root, 'skills')
  const cacheDir = path.join(root, 'cache')
  process.env.SKILL_AUDITOR_CACHE_DIR = cacheDir
  process.env.SKILL_AUDITOR_NO_CACHE = ''

  try {
    const setupMs = await generateSyntheticRepo(projectDir, skillsDir, fileCount)

    const tWalk = performance.now()
    const tree = await walkProjectAsync(projectDir)
    const walkMs = performance.now() - tWalk

    clearRealityCache()
    const tColdAsync = performance.now()
    const reality = await buildRepoRealityAsync(projectDir)
    const coldAsyncMs = performance.now() - tColdAsync

    const tWarmAsync = performance.now()
    await buildRepoRealityAsync(projectDir)
    const warmAsyncMs = performance.now() - tWarmAsync

    const tColdSync = performance.now()
    buildRepoReality(projectDir, { cache: false })
    const coldSyncMs = performance.now() - tColdSync

    const skillDirs = findSkillDirs([skillsDir])
    const tColdAudit = performance.now()
    auditSkillsSafely(reality, skillDirs)
    const coldAuditMs = performance.now() - tColdAudit

    const tWarmGaps = performance.now()
    detectGaps(reality, [skillsDir], 'frontend')
    const warmGapsMs = performance.now() - tWarmGaps

    const metrics = {
      fileCount,
      walkedFiles: tree.files.length,
      skillCount: skillDirs.length,
      ecosystems: reality.ecosystems,
      setupMs: roundMs(setupMs),
      walkMs: roundMs(walkMs),
      coldAsyncMs: roundMs(coldAsyncMs),
      warmAsyncMs: roundMs(Math.max(0.1, warmAsyncMs)),
      coldSyncMs: roundMs(coldSyncMs),
      coldAuditMs: roundMs(coldAuditMs),
      warmGapsMs: roundMs(warmGapsMs),
      speedup: Math.round((coldAsyncMs / Math.max(0.1, warmAsyncMs)) * 10) / 10,
    }

    const markdown = formatMarkdown(metrics)
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n', 'utf-8')
    }

    if (json) {
      process.stdout.write(JSON.stringify(metrics, null, 2) + '\n')
    } else {
      process.stdout.write(markdown + '\n')
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch(err => {
  process.stderr.write(`Benchmark failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
