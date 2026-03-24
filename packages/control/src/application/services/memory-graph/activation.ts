import type { Claim, ClaimPath, ActivationBundle, ActivationResult } from './types';

const MAX_SEGMENT_CHARS = 2000;
const RELATION_RESERVE = 200;

export function buildActivationBundles(
  claims: Claim[],
  evidenceCounts: Map<string, number>,
  pathsByClaim: Map<string, ClaimPath[]>,
): ActivationBundle[] {
  return claims.map(claim => ({
    claim,
    evidenceCount: evidenceCounts.get(claim.id) ?? 0,
    paths: pathsByClaim.get(claim.id) ?? [],
  }));
}

export function renderActivationSegment(bundles: ActivationBundle[]): ActivationResult {
  if (bundles.length === 0) {
    return { bundles: [], segment: '', hasContent: false };
  }

  const lines: string[] = ['[Active memory]'];
  let totalChars = lines[0].length;

  const sorted = [...bundles].sort((a, b) => b.claim.confidence - a.claim.confidence);

  for (let i = 0; i < sorted.length; i++) {
    const { claim: c, evidenceCount } = sorted[i];
    const evidenceNote = evidenceCount > 0 ? ` (${evidenceCount} evidence)` : '';
    const line = `${i + 1}. [${c.confidence.toFixed(2)}] ${c.subject} ${c.predicate} ${c.object}${evidenceNote}`;

    if (totalChars + line.length + 1 > MAX_SEGMENT_CHARS - RELATION_RESERVE) break;
    lines.push(line);
    totalChars += line.length + 1;
  }

  const seenPaths = new Set<string>();
  const pathLines: string[] = [];

  for (const bundle of sorted) {
    for (const path of bundle.paths) {
      if (seenPaths.has(path.id)) continue;
      seenPaths.add(path.id);

      const summary = path.pathSummary ?? path.pathRelations.join(' -> ');
      const pathLine = `- "${bundle.claim.subject}" --${summary}--> (${path.hopCount} hops, confidence: ${path.minConfidence.toFixed(2)})`;

      if (totalChars + pathLine.length + 20 > MAX_SEGMENT_CHARS) break;
      pathLines.push(pathLine);
      totalChars += pathLine.length + 1;
    }
  }

  if (pathLines.length > 0) {
    lines.push('', '[Known relations]', ...pathLines);
  }

  return { bundles: sorted, segment: lines.join('\n'), hasContent: true };
}
