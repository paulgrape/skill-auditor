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
function stripRegistryPrefix(specifier: string): string {
  if (specifier.startsWith('npm:')) return specifier.slice(4)
  if (specifier.startsWith('jsr:')) return specifier.slice(4)
  return specifier
}

export function isPackageSpecifier(specifier: string): boolean {
  if (!specifier) return false
  if (/^[./]/.test(specifier)) return false
  if (specifier.startsWith('node:')) return false
  if (specifier.startsWith('#')) return false
  if (specifier.startsWith('~')) return false
  // A scoped package needs a non-empty scope, so "@/components/x" is an alias.
  if (specifier.startsWith('@/')) return false
  const stripped = stripRegistryPrefix(specifier)
  if (!stripped || /^[./]/.test(stripped) || stripped.startsWith('@/')) return false
  return !BUILTINS.has(stripped.split('/')[0])
}

/**
 * Reduces an import specifier to its npm package name, e.g.
 * `next/navigation` -> `next`, `@tanstack/react-query/build` ->
 * `@tanstack/react-query`, `npm:zod@^3.22.0` -> `zod`,
 * `jsr:@std/path@^1.0.0/posix` -> `@std/path`. Returns '' for anything that
 * is not a package.
 */
export function topLevelPackage(specifier: string): string {
  if (!isPackageSpecifier(specifier)) return ''
  const stripped = stripRegistryPrefix(specifier)
  if (stripped.startsWith('@')) {
    const parts = stripped.split('/')
    if (parts.length < 2 || !parts[1]) return ''
    const pkgName = parts[1].split('@')[0]
    return pkgName ? `${parts[0]}/${pkgName}` : ''
  }
  const first = stripped.split('/')[0]
  return first.split('@')[0]
}
