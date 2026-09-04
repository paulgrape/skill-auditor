import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory that contains this package's package.json (the install root). */
export function packageRoot(): string {
  return dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
}

/** Own version, read from the installed package.json next to dist/. */
export function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
    )
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}
