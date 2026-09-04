/**
 * Directories every file walk skips: dependency trees, build output and tool
 * caches. Shared so the repo scan, skill discovery and the spec check cannot
 * drift apart on what counts as project source. A project can add its own
 * globs from `.skill-auditor.json` (see configureIgnore).
 */
export const BASE_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/.git/**',
]

/** The live ignore list; mutated in place so holders of the reference see updates. */
export const DEFAULT_IGNORE: string[] = [...BASE_IGNORE]

/** Resets to the base list and appends the project's extra globs. */
export function configureIgnore(extra: string[] = []): void {
  DEFAULT_IGNORE.splice(0, DEFAULT_IGNORE.length, ...BASE_IGNORE)
  for (const glob of extra) {
    if (!DEFAULT_IGNORE.includes(glob)) DEFAULT_IGNORE.push(glob)
  }
}
