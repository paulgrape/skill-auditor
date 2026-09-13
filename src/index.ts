/**
 * Programmatic entry point: the same analysis the CLI runs, as functions.
 *
 * The pipeline is buildRepoReality (what the project is) plus
 * extractSkillIdentifiers (what the skill claims), compared by
 * buildAlignmentReport and graded by scoreSkill. auditSkills wires those
 * together; the *Report helpers return the versioned JSON envelopes the CLI
 * and the MCP server emit.
 */
export { buildAlignmentReport } from './diff.js'
export {
  defaultSkillRoots,
  findSkillDirs,
  resolveSkillPath,
} from './discoverSkills.js'
export { compareAudits, readAuditPayload } from './compare.js'
export { describeConfig, loadProjectConfig, prepareProject } from './config.js'
export { envelope, SCHEMA_VERSION, toPlainJson } from './envelope.js'
export {
  AUDIT_FORMATS,
  formatAuditMarkdown,
  formatAuditSarif,
  formatAuditText,
  type AuditFormat,
} from './formats.js'
export { detectGaps, requireChecklist } from './gaps.js'
export { buildRepoReality } from './repoReality.js'
export {
  auditReport,
  auditSkill,
  auditSkills,
  auditSkillsSafely,
  gapsReport,
  scanReport,
  validateReport,
  type AuditError,
  type AuditResult,
} from './reports.js'
export { scaffoldSkill } from './scaffold.js'
export { scoreSkill } from './score.js'
export { extractSkillIdentifiers } from './skillIdentifiers.js'
export { runSpecCompliance } from './specCompliance.js'
export { buildSuggestions } from './suggestions.js'
export {
  CATEGORY_TAXONOMY,
  categoriesForPackage,
  MUST_HAVE_CHECKLISTS,
} from './taxonomy.js'
export { validateSkill, validateSkills } from './validate.js'
export type * from './types.js'
