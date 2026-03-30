import type { Ai, VectorizeIndex, D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Env } from '../../../shared/types';
import { getDb, runs, runEvents, infoUnits, nodes, edges, sessionRepos, repositories } from '../../../infra/db';
import { eq, and, asc } from 'drizzle-orm';
import { generateId } from '../../../shared/utils';
import { getRunEventsAfterFromR2 } from '../offload/run-events';
import { logWarn } from '../../../shared/utils/logger';

import { EMBEDDING_MODEL } from '../../../shared/config/limits.ts';
import { textDateNullable } from '../../../shared/utils/db-guards';
const MAX_INFO_UNIT_TOKENS = 2048;
const MAX_EVENT_TEXT_CHARS = 4000;
const CHARS_PER_TOKEN = 4;

type RunEventRecord = {
  id: number;
  type: string;
  data: string;
  createdAt: string;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `... [truncated:${text.length} chars]`;
}

function stringifySafe(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatEvent(event: RunEventRecord): string | null {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(event.data);
  } catch {
    data = {};
  }

  if (event.type === 'message') {
    const content = data.content || data.text || data.message;
    if (!content) return null;
    return `[assistant] ${truncateText(String(content), MAX_EVENT_TEXT_CHARS)}`;
  }

  if (event.type === 'tool_call') {
    const tool = data.tool || data.name || 'unknown';
    const args = data.arguments || data.args || {};
    return `[tool_call] ${tool} ${truncateText(stringifySafe(args), MAX_EVENT_TEXT_CHARS)}`;
  }

  if (event.type === 'tool_result') {
    const tool = data.tool || data.name || 'unknown';
    const output = data.output || data.result || data.error || '';
    return `[tool_result] ${tool} ${truncateText(stringifySafe(output), MAX_EVENT_TEXT_CHARS)}`;
  }

  if (event.type === 'error') {
    const error = data.error || data.message || 'unknown error';
    return `[error] ${truncateText(String(error), MAX_EVENT_TEXT_CHARS)}`;
  }

  if (event.type === 'progress') {
    const message = data.message || data.status;
    if (!message) return null;
    return `[progress] ${truncateText(String(message), MAX_EVENT_TEXT_CHARS)}`;
  }

  return null;
}

function buildSegments(entries: string[]): string[] {
  const segments: string[] = [];
  let current = '';

  for (const entry of entries) {
    const next = current ? `${current}\n${entry}` : entry;
    if (estimateTokens(next) > MAX_INFO_UNIT_TOKENS && current) {
      segments.push(current);
      current = entry;
      continue;
    }
    current = next;
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}

async function upsertVector(
  ai: Ai,
  vectorize: VectorizeIndex,
  infoUnitId: string,
  spaceId: string,
  runId: string | null,
  threadId: string | null,
  content: string,
  segmentIndex: number,
  segmentCount: number,
  repoIds?: string[]
): Promise<string> {
  const result = await ai.run(EMBEDDING_MODEL, {
    text: [content],
  }) as { data: number[][] };

  if (!result.data || result.data.length === 0) {
    throw new Error('Failed to generate embedding');
  }

  const vectorId = `info_unit:${spaceId}:${infoUnitId}`;
  await vectorize.upsert([{
    id: vectorId,
    values: result.data[0],
    metadata: {
      kind: 'info_unit',
      spaceId,
      ...(runId ? { runId } : {}),
      ...(threadId ? { threadId } : {}),
      segmentIndex,
      segmentCount,
      repoIds: repoIds || [],
      content: content.slice(0, 1000),
    },
  }]);

  return vectorId;
}

async function ensureNode(
  dbBinding: D1Database,
  spaceId: string,
  type: string,
  refId: string,
  label?: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  const db = getDb(dbBinding);
  const existing = await db.select({ id: nodes.id })
    .from(nodes)
    .where(and(
      eq(nodes.accountId, spaceId),
      eq(nodes.type, type),
      eq(nodes.refId, refId),
    ))
    .get();

  if (existing) {
    return existing.id;
  }

  const id = generateId();
  await db.insert(nodes).values({
    id,
    accountId: spaceId,
    type,
    refId,
    label: label || null,
    metadata: JSON.stringify(metadata || {}),
    createdAt: new Date().toISOString(),
  });

  return id;
}

async function ensureEdge(
  dbBinding: D1Database,
  spaceId: string,
  sourceId: string,
  targetId: string,
  type: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const db = getDb(dbBinding);
  const existing = await db.select({ id: edges.id })
    .from(edges)
    .where(and(
      eq(edges.accountId, spaceId),
      eq(edges.sourceId, sourceId),
      eq(edges.targetId, targetId),
      eq(edges.type, type),
    ))
    .get();

  if (existing) return;

  await db.insert(edges).values({
    id: generateId(),
    accountId: spaceId,
    sourceId,
    targetId,
    type,
    weight: 1.0,
    metadata: JSON.stringify(metadata || {}),
    createdAt: new Date().toISOString(),
  });
}

export class InfoUnitIndexer {
  private ai?: Ai;
  private vectorize?: VectorizeIndex;
  private dbBinding: D1Database;
  private offloadBucket?: R2Bucket;

  constructor(env: Pick<Env, 'AI' | 'VECTORIZE' | 'DB' | 'TAKOS_OFFLOAD'>) {
    this.ai = env.AI;
    this.vectorize = env.VECTORIZE;
    this.dbBinding = env.DB;
    this.offloadBucket = env.TAKOS_OFFLOAD;
  }

  async indexRun(spaceId: string, runId: string): Promise<void> {
    const db = getDb(this.dbBinding);

    const run = await db.select({
      id: runs.id,
      accountId: runs.accountId,
      threadId: runs.threadId,
      sessionId: runs.sessionId,
      status: runs.status,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
    }).from(runs)
      .where(eq(runs.id, runId))
      .get();

    if (!run || run.accountId !== spaceId) {
      return;
    }

    const existing = await db.select({ id: infoUnits.id })
      .from(infoUnits)
      .where(eq(infoUnits.runId, runId))
      .get();
    if (existing) return;

    const events = this.offloadBucket
      ? (await getRunEventsAfterFromR2(this.offloadBucket, runId, 0, 5000)).map((e) => ({
          id: e.event_id,
          type: e.type,
          data: e.data,
          createdAt: e.created_at,
        }))
      : (await db.select().from(runEvents)
          .where(eq(runEvents.runId, runId))
          .orderBy(asc(runEvents.id))
          .all()
        ).map((event) => ({
          ...event,
          createdAt: textDateNullable(event.createdAt) ?? new Date(0).toISOString(),
        }));

    const entries = events
      .map(formatEvent)
      .filter((entry): entry is string => Boolean(entry));

    const fallback = entries.length === 0
      ? `[summary] run ${runId} (${run.status})`
      : null;

    if (fallback) {
      entries.push(fallback);
    }

    const segments = buildSegments(entries);
    const segmentCount = Math.max(1, segments.length);
    const createdAt = new Date().toISOString();

    const sessionRepoResults = run.sessionId
      ? await db.select({
          repoId: sessionRepos.repoId,
          branch: sessionRepos.branch,
          mountPath: sessionRepos.mountPath,
          isPrimary: sessionRepos.isPrimary,
          repoName: repositories.name,
        }).from(sessionRepos)
          .leftJoin(repositories, eq(sessionRepos.repoId, repositories.id))
          .where(eq(sessionRepos.sessionId, run.sessionId))
          .all()
      : [];
    const repoMetadata = sessionRepoResults.map((repo) => ({
      repo_id: repo.repoId,
      repo_name: repo.repoName,
      branch: repo.branch,
      mount_path: repo.mountPath,
      is_primary: repo.isPrimary,
    }));

    for (let index = 0; index < segments.length; index++) {
      const content = segments[index];
      const tokenCount = estimateTokens(content);
      const infoUnitId = generateId();

      let vectorId: string | null = null;
      if (this.ai && this.vectorize) {
        try {
          vectorId = await upsertVector(
            this.ai,
            this.vectorize,
            infoUnitId,
            spaceId,
            runId,
            run.threadId,
            content,
            index,
            segmentCount,
            repoMetadata.map((repo) => repo.repo_id)
          );
        } catch (err) {
          logWarn(`Embedding failed for run ${runId}`, { module: 'info_unit', detail: err });
        }
      }

      await db.insert(infoUnits).values({
        id: infoUnitId,
        accountId: spaceId,
        threadId: run.threadId,
        runId,
        sessionId: run.sessionId,
        kind: segmentCount > 1 ? 'segment' : 'session',
        title: `Run ${runId} (${run.status})`,
        content,
        tokenCount,
        segmentIndex: index,
        segmentCount,
        vectorId,
        metadata: JSON.stringify({
          run_status: run.status,
          started_at: run.startedAt,
          completed_at: run.completedAt,
          segment_index: index,
          segment_count: segmentCount,
          repos: repoMetadata,
        }),
        createdAt,
        updatedAt: createdAt,
      });

      const infoNodeId = await ensureNode(
        this.dbBinding,
        spaceId,
        'info_unit',
        infoUnitId,
        `Run ${runId} (${index + 1}/${segmentCount})`,
        { runId, segmentIndex: index, segmentCount, repos: repoMetadata }
      );

      if (run.threadId) {
        const threadNodeId = await ensureNode(
          this.dbBinding,
          spaceId,
          'thread',
          run.threadId,
          `Thread ${run.threadId}`,
          {}
        );
        await ensureEdge(
          this.dbBinding,
          spaceId,
          infoNodeId,
          threadNodeId,
          'generated_from',
          { runId }
        );
      }
    }
  }
}

export function createInfoUnitIndexer(env: Pick<Env, 'AI' | 'VECTORIZE' | 'DB' | 'TAKOS_OFFLOAD'>): InfoUnitIndexer | null {
  if (!env.DB) return null;
  return new InfoUnitIndexer(env);
}
