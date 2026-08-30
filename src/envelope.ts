/**
 * Version of the JSON contract carried by every machine-readable output.
 *
 * Consumers should read `schemaVersion` before parsing the rest. It is bumped
 * when a field is removed or changes meaning; adding fields is not breaking
 * and does not bump it.
 */
export const SCHEMA_VERSION = 1

/** Stamps a payload with the contract version, kept first for readability. */
export function envelope<T extends object>(
  payload: T,
): T & { schemaVersion: number } {
  return { schemaVersion: SCHEMA_VERSION, ...payload }
}

/** JSON.stringify replacer that turns Sets into sorted arrays. */
export function setAwareReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return [...value].sort()
  return value
}

/**
 * Converts a value containing Sets into plain JSON data. Needed wherever the
 * payload is embedded in a larger structure (MCP `structuredContent`) rather
 * than serialized straight to stdout.
 */
export function toPlainJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, setAwareReplacer))
}
