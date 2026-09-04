import type { DriftFinding, SkillSuggestion } from './types.js'

/**
 * Suggestions demand substance, not string swaps. The audit loop is only
 * useful if acting on a suggestion produces a genuinely better skill — so
 * every suggestion asks for repo-grounded content (real examples, real file
 * paths, prose that explains), never "add reference X to raise the score".
 */
function suggestForFinding(finding: DriftFinding): string {
  switch (finding.kind) {
    case 'category-conflict':
      return finding.repoReality
        ? `Rewrite this part of the skill around "${finding.repoReality}" — the library the project actually uses. Replace the "${finding.skillReference}" example with a working snippet that mirrors how the repo uses "${finding.repoReality}" (check \`scan --json\` importEvidence for real files to copy patterns from). Do not just swap the package name.`
        : `Remove or replace "${finding.skillReference}" with the library the project actually uses, including a real usage example.`

    case 'missing-dependency':
      return `The project has no library for what "${finding.skillReference}" does. Either this skill covers a concern the project doesn't have (drop the section), or the recommendation is intentional (keep it, but say explicitly that the project would need to adopt "${finding.skillReference}" first).`

    case 'deprecated-api':
      return finding.repoReality
        ? `Rewrite the example that uses "${finding.skillReference}" with the "${finding.repoReality}" equivalent, matching how the repo's own files use it — not just a renamed import.`
        : `Remove or modernize the deprecated API "${finding.skillReference}".`

    case 'unused-reference':
      return `Remove the unused reference to "${finding.skillReference}", or add context explaining when it applies. Do not keep it just to look specific.`

    case 'unverified-api':
      return finding.repoReality
        ? `The skill demonstrates APIs the project never uses (${finding.skillReference}). Rebuild the example around what the repo actually imports (${finding.repoReality}) so the skill teaches this project's real patterns.`
        : `The skill demonstrates APIs the project never uses (${finding.skillReference}). Rebuild the example around the repo's real usage.`

    case 'metric-stuffing':
      return `This looks like score optimization, not skill improvement: ${finding.message} The score is capped until this is fixed. Cut the padding and write substantive content — one concern, real repo-grounded examples, prose that explains when and why.`

    case 'unscorable':
      return `Nothing in this skill is wrong for the project — it is just not grounded in it. Pick the one concern the skill is about, find the package the project uses for it (\`scan --json\` usedImports and importEvidence), and add a working example that imports and uses that package's real API with a few sentences on when to apply it. If the skill is intentionally package-agnostic, leave it: a low score with no drift findings is not a defect.`

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
