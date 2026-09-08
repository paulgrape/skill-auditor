import type { Ecosystem } from '../types.js'

/**
 * What the repo scan reads, per ecosystem. The cache fingerprints exactly
 * these files, so the two can never disagree about what invalidates a scan.
 */

/** Source files each ecosystem's scan reads (relative globs, DEFAULT_IGNORE applied). */
export const SOURCE_GLOBS: Record<Ecosystem, string[]> = {
  npm: ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
  python: ['**/*.py'],
  go: ['**/*.go'],
  cargo: ['**/*.rs'],
}

/** Manifests each ecosystem's declared dependencies come from. */
export const MANIFEST_GLOBS: Record<Ecosystem, string[]> = {
  npm: ['package.json', '**/package.json', 'pnpm-workspace.yaml'],
  python: ['**/pyproject.toml', '**/requirements*.txt'],
  go: ['**/go.mod'],
  cargo: ['**/Cargo.toml'],
}

export const ECOSYSTEMS: Ecosystem[] = ['npm', 'python', 'go', 'cargo']

export function allSourceGlobs(): string[] {
  return ECOSYSTEMS.flatMap(e => SOURCE_GLOBS[e])
}

export function allManifestGlobs(): string[] {
  return ECOSYSTEMS.flatMap(e => MANIFEST_GLOBS[e])
}
