import type { Ecosystem } from '../types.js'

/**
 * One binding an import introduces. `source` is the name the module exports
 * (what verification compares), `local` is the identifier the importing code
 * writes; they differ only for `a as b`. Default, namespace and whole-module
 * imports have no exported name of their own, so their local name stands in.
 */
export interface ImportBinding {
  source: string
  local: string
}

/**
 * One import statement, normalized across languages so the repo scan and the
 * skill extractor read every ecosystem through the same shape.
 */
export interface SourceImport {
  ecosystem: Ecosystem
  /** Module path as written: `next/navigation`, `sklearn.model_selection`, `github.com/gin-gonic/gin`, `tokio::sync` */
  specifier: string
  /** Package the specifier resolves to; '' when it is not a dependency (relative path, stdlib, alias, local module) */
  packageName: string
  bindings: ImportBinding[]
  /**
   * Whether the bindings can be checked for use. `require()` and dynamic
   * `import()` results are not tracked, and a re-export (`export { a } from`)
   * has no body that could use what it forwards, so those are at most
   * "fenced" evidence. Their bindings still feed the repo's usedIdentifiers.
   */
  bindingsKnown: boolean
  /** Statement text as written */
  text: string
  /** Character offsets of the statement in the source */
  start: number
  end: number
}

/** Counts newlines before `offset`, i.e. the 0-based line an offset sits on. */
export function lineOf(source: string, offset: number): number {
  let line = 0
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++
  }
  return line
}
