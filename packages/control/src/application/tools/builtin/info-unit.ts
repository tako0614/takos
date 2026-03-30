import type { ToolDefinition, ToolHandler } from '../tool-definitions';
import { getDb, infoUnits, repositories, edges, nodes } from '../../../infra/db';
import { eq, and, like, desc, inArray, or } from 'drizzle-orm';
import type { Database } from '../../../infra/db';

import { EMBEDDING_MODEL } from '../../../shared/config/limits.ts';

export const INFO_UNIT_SEARCH: ToolDefinition = {
  name: 'info_unit_search',
  description: 'Search session-level agent info units (agent run logs summarized as memory).',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query for relevant info units',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (optional, default: 5, max: 20)',
      },
      min_score: {
        type: 'number',
        description: 'Minimum similarity score for vector search (optional, default: 0.5)',
      },
    },
    required: ['query'],
  },
};

export const REPO_GRAPH_SEARCH: ToolDefinition = {
  name: 'repo_graph_search',
  description: 'Search info units and graph memory, optionally scoped to specific repositories.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query for relevant info units',
      },
      repo_ids: {
        type: 'array',
        items: {
          type: 'string',
          description: 'Repository ID to include in scope.',
        },
        description: 'Optional repository IDs to scope the search.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (optional, default: 5, max: 20)',
      },
      min_score: {
        type: 'number',
        description: 'Minimum similarity score for vector search (optional, default: 0.5)',
      },
    },
    required: ['query'],
  },
};

export const REPO_GRAPH_NEIGHBORS: ToolDefinition = {
  name: 'repo_graph_neighbors',
  description: 'List neighboring graph nodes from a given node or info unit.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      node_id: {
        type: 'string',
        description: 'Graph node ID (preferred).',
      },
      info_unit_id: {
        type: 'string',
        description: 'Info unit ID (will resolve to node).',
      },
      depth: {
        type: 'number',
        description: 'Traversal depth (optional, default: 1, max: 3)',
      },
    },
    required: [],
  },
};

export const REPO_GRAPH_LINEAGE: ToolDefinition = {
  name: 'repo_graph_lineage',
  description: 'Show lineage edges (generated_from/references) for a given info unit.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      info_unit_id: {
        type: 'string',
        description: 'Info unit ID to trace lineage.',
      },
      depth: {
        type: 'number',
        description: 'Traversal depth (optional, default: 2, max: 3)',
      },
    },
    required: ['info_unit_id'],
  },
};

function formatVectorMatch(
  match: { score: number; metadata?: Record<string, unknown> },
  index: number,
  includeRepoInfo: boolean,
): string {
  const meta = (match.metadata || {}) as Record<string, unknown>;
  const snippet = typeof meta.content === 'string' ? meta.content : '';
  const runId = typeof meta.runId === 'string' ? meta.runId : 'unknown';
  const segmentInfo = typeof meta.segmentIndex === 'number' && typeof meta.segmentCount === 'number'
    ? ` (${meta.segmentIndex + 1}/${meta.segmentCount})`
    : '';
  const repoInfo = includeRepoInfo && Array.isArray(meta.repoIds) && meta.repoIds.length > 0
    ? ` repos:${meta.repoIds.join(',')}`
    : '';
  return `${index + 1}. [${match.score.toFixed(3)}] run:${runId}${segmentInfo}${repoInfo}\n${snippet}`;
}

function formatTextSearchResult(
  unit: { run_id: string | null; kind: string; content: string },
  index: number,
): string {
  const snippet = unit.content.length > 200 ? unit.content.slice(0, 200) + '...' : unit.content;
  return `${index + 1}. run:${unit.run_id || 'unknown'} (${unit.kind})\n${snippet}`;
}

async function resolveAccessibleRepoIds(
  db: Database,
  spaceId: string,
  repoIds: string[]
): Promise<string[]> {
  if (repoIds.length === 0) return [];

  const owned = await db.select({ id: repositories.id })
    .from(repositories).where(and(inArray(repositories.id, repoIds), eq(repositories.accountId, spaceId))).all();

  const allowed = new Set<string>();
  owned.forEach((repo) => allowed.add(repo.id));

  const missing = repoIds.filter((id) => !allowed.has(id));
  if (missing.length > 0) {
    throw new Error(`Repository access denied for: ${missing.join(', ')}`);
  }

  return Array.from(allowed);
}

export const infoUnitSearchHandler: ToolHandler = async (args, context) => {
  const query = (args.query as string) || '';
  const limit = Math.min((args.limit as number) || 5, 20);
  const minScore = typeof args.min_score === 'number' ? args.min_score : 0.5;

  if (!query.trim()) {
    throw new Error('Query is required');
  }

  if (context.env.AI && context.env.VECTORIZE) {
    const embeddingResult = await context.env.AI.run(EMBEDDING_MODEL, {
      text: [query],
    }) as { data: number[][] };

    if (!embeddingResult.data || embeddingResult.data.length === 0) {
      return 'No info units found (embedding failed)';
    }

    const searchResult = await context.env.VECTORIZE.query(embeddingResult.data[0], {
      topK: limit * 2,
      filter: {
        accountId: context.spaceId,
        kind: 'info_unit',
      },
      returnMetadata: 'all',
    });

    const matches = searchResult.matches
      .filter((match) => match.score >= minScore)
      .slice(0, limit);

    if (matches.length === 0) {
      return `No info units found for: "${query}"`;
    }

    const lines = matches.map((match, index) => formatVectorMatch(match, index, false));

    return `Found ${matches.length} info units:\n\n${lines.join('\n\n')}`;
  }

  const db = getDb(context.db);
  const results = await db.select({
    id: infoUnits.id, runId: infoUnits.runId, kind: infoUnits.kind, content: infoUnits.content, createdAt: infoUnits.createdAt,
  }).from(infoUnits)
    .where(and(eq(infoUnits.accountId, context.spaceId), like(infoUnits.content, `%${query}%`)))
    .orderBy(desc(infoUnits.createdAt))
    .limit(limit)
    .all();

  if (results.length === 0) {
    return `No info units found for: "${query}"`;
  }

  const lines = results.map((unit, index) => formatTextSearchResult(
    { run_id: unit.runId, kind: unit.kind, content: unit.content },
    index,
  ));

  return `Found ${results.length} info units:\n\n${lines.join('\n\n')}`;
};

export const repoGraphSearchHandler: ToolHandler = async (args, context) => {
  const query = (args.query as string) || '';
  const limit = Math.min((args.limit as number) || 5, 20);
  const minScore = typeof args.min_score === 'number' ? args.min_score : 0.5;
  const repoIds = Array.isArray(args.repo_ids) ? (args.repo_ids as string[]) : [];

  if (!query.trim()) {
    throw new Error('Query is required');
  }

  const db = getDb(context.db);
  const allowedRepoIds = await resolveAccessibleRepoIds(db, context.spaceId, repoIds);

  if (context.env.AI && context.env.VECTORIZE) {
    const embeddingResult = await context.env.AI.run(EMBEDDING_MODEL, {
      text: [query],
    }) as { data: number[][] };

    if (!embeddingResult.data || embeddingResult.data.length === 0) {
      return 'No info units found (embedding failed)';
    }

    const searchResult = await context.env.VECTORIZE.query(embeddingResult.data[0], {
      topK: limit * 4,
      filter: {
        accountId: context.spaceId,
        kind: 'info_unit',
      },
      returnMetadata: 'all',
    });

    let matches = searchResult.matches.filter((match) => match.score >= minScore);
    if (allowedRepoIds.length > 0) {
      matches = matches.filter((match) => {
        const meta = match.metadata as Record<string, unknown>;
        const metaRepoIds = Array.isArray(meta.repoIds) ? meta.repoIds as string[] : [];
        return metaRepoIds.some((id) => allowedRepoIds.includes(id));
      });
    }

    matches = matches.slice(0, limit);

    if (matches.length === 0) {
      return `No info units found for: "${query}"`;
    }

    const lines = matches.map((match, index) => formatVectorMatch(match, index, true));

    return `Found ${matches.length} info units:\n\n${lines.join('\n\n')}`;
  }

  const results = await db.select({
    id: infoUnits.id, runId: infoUnits.runId, kind: infoUnits.kind, content: infoUnits.content, createdAt: infoUnits.createdAt, metadata: infoUnits.metadata,
  }).from(infoUnits)
    .where(and(eq(infoUnits.accountId, context.spaceId), like(infoUnits.content, `%${query}%`)))
    .orderBy(desc(infoUnits.createdAt))
    .limit(limit * 4)
    .all();

  const filtered = allowedRepoIds.length > 0
    ? results.filter((unit) => allowedRepoIds.some((id) => unit.metadata.includes(`"repo_id":"${id}"`)))
    : results;

  if (filtered.length === 0) {
    return `No info units found for: "${query}"`;
  }

  const lines = filtered.slice(0, limit).map((unit, index) => formatTextSearchResult(
    { run_id: unit.runId, kind: unit.kind, content: unit.content },
    index,
  ));

  return `Found ${filtered.length} info units:\n\n${lines.join('\n\n')}`;
};

/**
 * BFS graph traversal that collects edge descriptions up to a given depth.
 * Optionally filters by edge types.
 */
async function traverseGraph(
  db: Database,
  spaceId: string,
  startNodeId: string,
  depth: number,
  edgeTypes?: string[],
): Promise<string[]> {
  const visited = new Set<string>([startNodeId]);
  let frontier = [startNodeId];
  const lines: string[] = [];

  for (let d = 0; d < depth; d += 1) {
    const conditions = [
      eq(edges.accountId, spaceId),
      or(inArray(edges.sourceId, frontier), inArray(edges.targetId, frontier)),
    ];
    if (edgeTypes) {
      conditions.push(inArray(edges.type, edgeTypes));
    }

    const edgeRows = await db.select({
      sourceId: edges.sourceId,
      targetId: edges.targetId,
      type: edges.type,
      sourceLabel: nodes.label,
      sourceType: nodes.type,
      sourceRefId: nodes.refId,
    }).from(edges)
      .innerJoin(nodes, eq(edges.sourceId, nodes.id))
      .where(and(...conditions))
      .all();

    // Fetch target node info separately
    const targetNodeIds = [...new Set(edgeRows.map(e => e.targetId))];
    const targetNodeMap = new Map<string, { label: string | null; type: string; refId: string }>();
    if (targetNodeIds.length > 0) {
      const targetNodeRows = await db.select({ id: nodes.id, label: nodes.label, type: nodes.type, refId: nodes.refId })
        .from(nodes).where(inArray(nodes.id, targetNodeIds)).all();
      for (const n of targetNodeRows) {
        targetNodeMap.set(n.id, { label: n.label, type: n.type, refId: n.refId });
      }
    }

    const nextFrontier: string[] = [];
    for (const edge of edgeRows) {
      const sourceLabel = edge.sourceLabel || `${edge.sourceType}:${edge.sourceRefId}`;
      const targetNode = targetNodeMap.get(edge.targetId);
      const targetLabel = targetNode ? (targetNode.label || `${targetNode.type}:${targetNode.refId}`) : edge.targetId;
      lines.push(`${edge.sourceId} (${sourceLabel}) -[${edge.type}]-> ${edge.targetId} (${targetLabel})`);

      for (const id of [edge.sourceId, edge.targetId]) {
        if (!visited.has(id)) {
          visited.add(id);
          nextFrontier.push(id);
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return lines;
}

export const repoGraphNeighborsHandler: ToolHandler = async (args, context) => {
  const depth = Math.min((args.depth as number) || 1, 3);
  const db = getDb(context.db);

  let nodeId = args.node_id as string | undefined;
  const infoUnitId = args.info_unit_id as string | undefined;

  if (!nodeId && infoUnitId) {
    const node = await db.select({ id: nodes.id })
      .from(nodes).where(and(eq(nodes.accountId, context.spaceId), eq(nodes.type, 'info_unit'), eq(nodes.refId, infoUnitId))).get();
    nodeId = node?.id;
  }

  if (!nodeId) {
    throw new Error('node_id or info_unit_id is required');
  }

  const lines = await traverseGraph(db, context.spaceId, nodeId, depth);
  return lines.length > 0 ? lines.join('\n') : 'No neighboring nodes found.';
};

export const repoGraphLineageHandler: ToolHandler = async (args, context) => {
  const depth = Math.min((args.depth as number) || 2, 3);
  const infoUnitId = args.info_unit_id as string;

  const db = getDb(context.db);
  const node = await db.select({ id: nodes.id })
    .from(nodes).where(and(eq(nodes.accountId, context.spaceId), eq(nodes.type, 'info_unit'), eq(nodes.refId, infoUnitId))).get();

  if (!node) {
    return 'Info unit node not found.';
  }

  const lineageEdgeTypes = ['generated_from', 'references', 'same_project', 'similar_to'];
  const lines = await traverseGraph(db, context.spaceId, node.id, depth, lineageEdgeTypes);
  return lines.length > 0 ? lines.join('\n') : 'No lineage edges found.';
};

export const INFO_UNIT_TOOLS = [INFO_UNIT_SEARCH, REPO_GRAPH_SEARCH, REPO_GRAPH_NEIGHBORS, REPO_GRAPH_LINEAGE];
export const INFO_UNIT_HANDLERS: Record<string, ToolHandler> = {
  info_unit_search: infoUnitSearchHandler,
  repo_graph_search: repoGraphSearchHandler,
  repo_graph_neighbors: repoGraphNeighborsHandler,
  repo_graph_lineage: repoGraphLineageHandler,
};
