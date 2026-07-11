import fg from 'fast-glob'
import * as fs from 'fs'
import * as path from 'path'

const DEFAULT_IGNORE = ['**/node_modules/**', '**/dist/**', '**/.git/**']

const DEFAULT_SKILL_DIRS = [
  '.cursor/skills',
  '.claude/skills',
  '.agents/skills',
  '.codex/skills',
]

/** Returns project-local well-known skill roots that actually exist. */
export function defaultSkillRoots(cwd: string = '.'): string[] {
  return DEFAULT_SKILL_DIRS.map(d => path.join(cwd, d)).filter(
    d => fs.existsSync(d) && fs.statSync(d).isDirectory(),
  )
}

/**
 * Finds every directory containing a SKILL.md under the given roots.
 * Each input path may be a skill dir itself or a parent tree to scan recursively.
 */
export function findSkillDirs(roots: string[]): string[] {
  const found = new Set<string>()

  for (const root of roots) {
    const resolved = path.resolve(root)

    if (!fs.existsSync(resolved)) continue

    if (fs.statSync(resolved).isFile()) {
      if (path.basename(resolved).toLowerCase() === 'skill.md') {
        found.add(path.dirname(resolved))
      }
      continue
    }

    const matches = fg.sync('**/SKILL.md', {
      cwd: resolved,
      absolute: true,
      ignore: DEFAULT_IGNORE,
      onlyFiles: true,
    })

    for (const skillMd of matches) {
      found.add(path.dirname(skillMd))
    }
  }

  return [...found].sort()
}

/**
 * Resolves an audit target to one or more skill directories.
 * - Direct skill dir (contains SKILL.md) -> single entry
 * - Skills root (nested SKILL.md files) -> all discovered entries
 */
export function resolveSkillPath(input: string): string[] {
  const resolved = path.resolve(input)

  if (!fs.existsSync(resolved)) {
    throw new Error(`Path not found: ${input}`)
  }

  if (fs.statSync(resolved).isFile()) {
    if (path.basename(resolved).toLowerCase() === 'skill.md') {
      return [path.dirname(resolved)]
    }
    throw new Error(`Not a SKILL.md file: ${input}`)
  }

  const directSkillMd = path.join(resolved, 'SKILL.md')
  if (fs.existsSync(directSkillMd)) {
    return [resolved]
  }

  const nested = findSkillDirs([resolved])
  if (nested.length === 0) {
    throw new Error(
      `No SKILL.md found under ${input}. Pass a skill directory or a skills root.`,
    )
  }

  return nested
}
