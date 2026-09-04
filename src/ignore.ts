/**
 * Directories every file walk skips: dependency trees, build output and tool
 * caches. Shared so the repo scan, skill discovery and the spec check cannot
 * drift apart on what counts as project source.
 */
export const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/.git/**',
]
