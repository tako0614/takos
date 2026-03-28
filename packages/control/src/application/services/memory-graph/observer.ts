import type { ToolObserver, ToolObservation, Claim, Evidence } from './types';
import { RunOverlay } from './overlay';
import { bytesToHex } from '../../../shared/utils/encoding-utils';

function randomHexId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function createToolObserver(
  accountId: string,
  runId: string,
  overlay: RunOverlay,
): ToolObserver {
  return {
    observe(record: ToolObservation): void {
      try {
        observeToolExecution(accountId, runId, overlay, record);
      } catch {
        // best-effort
      }
    },

    getOverlayClaims(): Claim[] {
      return overlay.getAllClaims();
    },

    getOverlayEvidence(): Evidence[] {
      return overlay.getAllEvidence();
    },
  };
}

function observeToolExecution(
  accountId: string,
  runId: string,
  overlay: RunOverlay,
  record: ToolObservation,
): void {
  if (record.toolName === 'remember' && !record.error) {
    observeRemember(accountId, runId, overlay, record);
  } else if (record.error) {
    observeToolError(accountId, runId, overlay, record);
  } else if (record.toolName === 'recall') {
    observeRecall(accountId, runId, overlay, record);
  }
}

function observeRemember(
  accountId: string,
  runId: string,
  overlay: RunOverlay,
  record: ToolObservation,
): void {
  const content = record.arguments.content as string | undefined;
  const type = record.arguments.type as string | undefined;
  if (!content) return;

  const { subject, predicate, object } = extractSPO(content);

  const claimId = randomHexId();
  overlay.addClaim({
    id: claimId,
    accountId,
    claimType: type === 'procedural' ? 'preference'
      : type === 'episode' ? 'observation'
      : 'fact',
    subject,
    predicate,
    object,
    confidence: 0.7,
    sourceRunId: runId,
  });

  overlay.addEvidence({
    id: randomHexId(),
    accountId,
    claimId,
    kind: 'supports',
    sourceType: 'tool_result',
    sourceRef: `remember:${runId}`,
    content: content.slice(0, 2048),
    trust: 0.9,
  });
}

function observeToolError(
  accountId: string,
  runId: string,
  overlay: RunOverlay,
  record: ToolObservation,
): void {
  const relatedClaims = overlay.findClaimsBySubject(record.toolName);
  if (relatedClaims.length === 0) return;

  for (const claim of relatedClaims.slice(0, 3)) {
    overlay.addEvidence({
      id: randomHexId(),
      accountId,
      claimId: claim.id,
      kind: 'context',
      sourceType: 'tool_result',
      sourceRef: `${record.toolName}:error:${runId}`,
      content: `Tool error: ${(record.error ?? '').slice(0, 500)}`,
      trust: 0.5,
      taint: 'tool_error',
    });
  }
}

function observeRecall(
  accountId: string,
  runId: string,
  overlay: RunOverlay,
  record: ToolObservation,
): void {
  const query = record.arguments.query as string | undefined;
  if (!query || !record.result) return;

  const relatedClaims = overlay.searchClaims(query);
  for (const claim of relatedClaims.slice(0, 3)) {
    overlay.addEvidence({
      id: randomHexId(),
      accountId,
      claimId: claim.id,
      kind: 'context',
      sourceType: 'memory_recall',
      sourceRef: `recall:${runId}`,
      content: `Recall query: "${query}" returned results`,
      trust: 0.6,
    });
  }
}

const SPO_PATTERN = /^(.+?)\s+(is|are|was|were|uses|prefers|likes|wants|needs|has|runs|deploys|supports|requires|depends on)\s+(.+)$/i;

function extractSPO(text: string): { subject: string; predicate: string; object: string } {
  const clean = text.trim().replace(/\s+/g, ' ');

  const match = clean.match(SPO_PATTERN);
  if (match) {
    return {
      subject: match[1].slice(0, 200),
      predicate: match[2].toLowerCase(),
      object: match[3].slice(0, 500),
    };
  }

  const words = clean.split(' ');
  const split = Math.min(3, Math.ceil(words.length / 3));

  return {
    subject: words.slice(0, split).join(' ').slice(0, 200),
    predicate: 'relates_to',
    object: (words.slice(split).join(' ') || clean).slice(0, 500),
  };
}
