import { readFileSync } from 'node:fs'

/** Own version, read from the installed package.json next to dist/. */
export function readPackageVersion(): string {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}
