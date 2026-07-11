import type { DriftFinding, SkillSuggestion } from './types.js'

function suggestForFinding(finding: DriftFinding): string {
  switch (finding.kind) {
    case 'category-conflict':
      return finding.repoReality
        ? `Replace "${finding.skillReference}" with "${finding.repoReality}" to match the project's stack.`
        : `Remove or replace "${finding.skillReference}" with the library the project actually uses.`

    case 'missing-dependency':
      return `Either add "${finding.skillReference}" to the project, or remove references to it from the skill if it's not relevant.`

    case 'deprecated-api':
      return finding.repoReality
        ? `Update "${finding.skillReference}" to use "${finding.repoReality}" (or equivalent App Router API).`
        : `Remove or modernize the deprecated API "${finding.skillReference}".`

    case 'unused-reference':
      return `Remove the unused reference to "${finding.skillReference}", or add context explaining when it applies.`

    default:
      return finding.message
  }
}

export function buildSuggestions(findings: DriftFinding[]): SkillSuggestion[] {
  return findings.map(finding => ({
    finding,
    suggestion: suggestForFinding(finding),
  }))
}
