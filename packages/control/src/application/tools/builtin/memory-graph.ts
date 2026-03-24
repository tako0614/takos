import type { D1Database } from '../../../shared/types/bindings.ts';
import type { ToolDefinition, ToolHandler } from '../types';
import { searchClaims, getPathsForClaim, getEvidenceForClaim } from '../../services/memory-graph/claim-store';

export const MEMORY_GRAPH_RECALL: ToolDefinition = {
  name: 'memory_graph_recall',
  description: 'Search structured memory claims, paths between claims, or evidence supporting a claim. Use mode "claims" to find facts, "path_search" to discover relationships, "evidence" to see supporting/contradicting references.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (for claims mode) or context description',
      },
      mode: {
        type: 'string',
        description: 'Retrieval mode: "claims" (search facts), "path_search" (find relationships), "evidence" (get references)',
        enum: ['claims', 'path_search', 'evidence'],
      },
      claim_id: {
        type: 'string',
        description: 'Claim ID for evidence or path_search mode',
      },
      limit: {
        type: 'number',
        description: 'Max results (default 10)',
      },
    },
    required: ['query', 'mode'],
  },
};

export const memoryGraphRecallHandler: ToolHandler = async (args, context) => {
  const query = args.query as string;
  const mode = args.mode as 'claims' | 'path_search' | 'evidence';
  const claimId = args.claim_id as string | undefined;
  const limit = Math.min((args.limit as number) || 10, 50);

  switch (mode) {
    case 'claims':
      return handleClaimsMode(context.db, context.spaceId, query, limit);
    case 'path_search':
      return handlePathSearchMode(context.db, context.spaceId, claimId, limit);
    case 'evidence':
      return handleEvidenceMode(context.db, claimId, limit);
    default:
      return `Unknown mode: ${mode}. Use "claims", "path_search", or "evidence".`;
  }
};

async function handleClaimsMode(db: D1Database, accountId: string, query: string, limit: number): Promise<string> {
  const claims = await searchClaims(db, accountId, query, limit);
  if (claims.length === 0) return `No claims found for: "${query}"`;

  const lines = claims.map((c, i) => {
    const status = c.status !== 'active' ? ` [${c.status}]` : '';
    return `${i + 1}. [${c.confidence.toFixed(2)}] ${c.subject} ${c.predicate} ${c.object}${status} (id: ${c.id.slice(0, 8)}...)`;
  });

  return `Found ${claims.length} claims:\n\n${lines.join('\n')}`;
}

async function handlePathSearchMode(db: D1Database, accountId: string, claimId: string | undefined, limit: number): Promise<string> {
  if (!claimId) return 'claim_id is required for path_search mode';

  const paths = await getPathsForClaim(db, accountId, claimId, limit);
  if (paths.length === 0) return `No paths found for claim: ${claimId}`;

  const lines = paths.map((p, i) =>
    `${i + 1}. ${p.pathRelations.join(' -> ')} (${p.hopCount} hops, confidence: ${p.minConfidence.toFixed(2)})`
  );

  return `Found ${paths.length} paths:\n\n${lines.join('\n')}`;
}

async function handleEvidenceMode(db: D1Database, claimId: string | undefined, limit: number): Promise<string> {
  if (!claimId) return 'claim_id is required for evidence mode';

  const evidence = await getEvidenceForClaim(db, claimId, limit);
  if (evidence.length === 0) return `No evidence found for claim: ${claimId}`;

  const lines = evidence.map((e, i) => {
    const taintNote = e.taint ? ` [taint: ${e.taint}]` : '';
    const kindIcon = e.kind === 'supports' ? '+' : e.kind === 'contradicts' ? '-' : '~';
    const truncated = e.content.length > 200 ? `${e.content.slice(0, 200)}...` : e.content;
    return `${i + 1}. [${kindIcon}] (trust: ${e.trust.toFixed(2)}) ${truncated}${taintNote}`;
  });

  return `Found ${evidence.length} evidence:\n\n${lines.join('\n')}`;
}

export const MEMORY_GRAPH_TOOLS: ToolDefinition[] = [MEMORY_GRAPH_RECALL];

export const MEMORY_GRAPH_HANDLERS: Record<string, ToolHandler> = {
  memory_graph_recall: memoryGraphRecallHandler,
};
