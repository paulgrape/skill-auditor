import { builtinModules } from 'node:module'

const BUILTINS = new Set(builtinModules)

/**
 * True when a module specifier names an npm package rather than something the
 * project resolves by other means. Node builtins, `package.json` subpath
 * imports (`#internal`) and tsconfig/bundler path aliases (`@/…`, `~/…`) all
 * look like bare specifiers but can never appear in a dependency list, so
 * counting them as packages produces phantom references on both sides of the
 * audit.
 */
export function isPackageSpecifier(specifier: string): boolean {
  if (!specifier) return false
  if (/^[./]/.test(specifier)) return false
  if (specifier.startsWith('node:')) return false
  if (specifier.startsWith('#')) return false
  if (specifier.startsWith('~')) return false
  // A scoped package needs a non-empty scope, so "@/components/x" is an alias.
  if (specifier.startsWith('@/')) return false
  return !BUILTINS.has(specifier.split('/')[0])
}

/**
 * Reduces an import specifier to its npm package name, e.g.
 * `next/navigation` -> `next`, `@tanstack/react-query/build` ->
 * `@tanstack/react-query`. Returns '' for anything that is not a package.
 */
export function topLevelPackage(specifier: string): string {
  if (!isPackageSpecifier(specifier)) return ''
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
}
