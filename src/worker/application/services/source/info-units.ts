import type {
  Ai,
  ObjectStoreBinding,
  SqlDatabaseBinding,
  VectorizeIndex,
} from "../../../shared/types/bindings.ts";
import type { Env } from "../../../shared/types/index.ts";
import {
  infoUnits,
  repositories,
  runEvents,
  runs,
  sessionRepos,
} from "../../../infra/db/index.ts";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { EMBEDDING_MODEL } from "../../../shared/config/limits.ts";
import { textDateNullable } from "../../../shared/utils/db-guards.ts";
import { sourceServiceDeps } from "./deps.ts";
import {
  MAX_PERSISTED_RUN_EVENT_DATA_BYTES,
  RUN_EVENT_TRUNCATED_DATA,
} from "../offload/run-events.ts";
const MAX_INFO_UNIT_TOKENS = 2048;
const MAX_EVENT_TEXT_CHARS = 4000;
const CHARS_PER_TOKEN = 4;
export const MAX_INDEXED_RUN_EVENTS = 500;
export const MAX_INFO_UNIT_SEGMENTS_PER_RUN = 16;
export const MAX_INFO_UNIT_SESSION_REPOS = 100;
const MAX_STALE_INFO_UNIT_CLEANUP_ROWS = 100;
const INFO_UNIT_SOURCE_TRUNCATION_NOTICE =
  "[summary] Earlier Run activity was omitted from this bounded index.";
const sourceTextEncoder = new TextEncoder();

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
  return text.slice(0, maxChars) + "... [truncated]";
}

function boundedEventData(data: string): string {
  if (
    sourceTextEncoder.encode(data).byteLength >
      MAX_PERSISTED_RUN_EVENT_DATA_BYTES
  ) {
    return RUN_EVENT_TRUNCATED_DATA;
  }
  try {
    JSON.parse(data);
    return data;
  } catch {
    return RUN_EVENT_TRUNCATED_DATA;
  }
}

function stringifySafe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatEvent(event: RunEventRecord): string | null {
  if (event.data === RUN_EVENT_TRUNCATED_DATA) {
    return `[event_data_omitted] ${event.type}`;
  }
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(event.data);
  } catch {
    data = {};
  }

  if (event.type === "message") {
    const content = data.content || data.text || data.message;
    if (!content) return null;
    return `[assistant] ${truncateText(String(content), MAX_EVENT_TEXT_CHARS)}`;
  }

  if (event.type === "tool_call") {
    const tool = data.tool || data.name || "unknown";
    const args = data.arguments || data.args || {};
    return `[tool_call] ${tool} ${truncateText(
      stringifySafe(args),
      MAX_EVENT_TEXT_CHARS,
    )}`;
  }

  if (event.type === "tool_result") {
    const tool = data.tool || data.name || "unknown";
    const output = data.output || data.result || data.error || "";
    return `[tool_result] ${tool} ${truncateText(
      stringifySafe(output),
      MAX_EVENT_TEXT_CHARS,
    )}`;
  }

  if (event.type === "error") {
    const error = data.error || data.message || "unknown error";
    return `[error] ${truncateText(String(error), MAX_EVENT_TEXT_CHARS)}`;
  }

  if (event.type === "progress") {
    const message = data.message || data.status;
    if (!message) return null;
    return `[progress] ${truncateText(String(message), MAX_EVENT_TEXT_CHARS)}`;
  }

  return null;
}

function buildSegments(entries: string[]): string[] {
  const segments: string[] = [];
  let current = "";

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

function boundSegments(entries: string[]): {
  segments: string[];
  contentTruncated: boolean;
} {
  const allSegments = buildSegments(entries);
  if (allSegments.length <= MAX_INFO_UNIT_SEGMENTS_PER_RUN) {
    return { segments: allSegments, contentTruncated: false };
  }
  return {
    segments: [
      INFO_UNIT_SOURCE_TRUNCATION_NOTICE,
      ...allSegments.slice(-(MAX_INFO_UNIT_SEGMENTS_PER_RUN - 1)),
    ],
    contentTruncated: true,
  };
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
  repoIds?: string[],
): Promise<string> {
  const result = (await ai.run(EMBEDDING_MODEL, {
    text: [content],
  })) as { data: number[][] };

  if (!result.data || result.data.length === 0) {
    throw new Error(
      `Failed to generate embedding for info unit ${infoUnitId} (space=${spaceId}, segment=${segmentIndex}/${segmentCount}, textLength=${content.length}): AI returned empty data`,
    );
  }

  const vectorId = `info_unit:${spaceId}:${infoUnitId}`;
  await vectorize.upsert([
    {
      id: vectorId,
      values: result.data[0],
      metadata: {
        kind: "info_unit",
        spaceId,
        ...(runId ? { runId } : {}),
        ...(threadId ? { threadId } : {}),
        segmentIndex,
        segmentCount,
        repoIds: repoIds || [],
      },
    },
  ]);

  return vectorId;
}

export class InfoUnitIndexer {
  private ai?: Ai;
  private vectorize?: VectorizeIndex;
  private dbBinding: SqlDatabaseBinding;
  private offloadBucket?: ObjectStoreBinding;

  constructor(env: Pick<Env, "AI" | "VECTORIZE" | "DB" | "TAKOS_OFFLOAD">) {
    this.ai = env.AI;
    this.vectorize = env.VECTORIZE;
    this.dbBinding = env.DB;
    this.offloadBucket = env.TAKOS_OFFLOAD;
  }

  async indexRun(spaceId: string, runId: string): Promise<void> {
    const db = sourceServiceDeps.getDb(this.dbBinding);

    const run = await db
      .select({
        id: runs.id,
        accountId: runs.accountId,
        threadId: runs.threadId,
        sessionId: runs.sessionId,
        status: runs.status,
        output: sql<string | null>`substr(${runs.output}, 1, ${
          MAX_EVENT_TEXT_CHARS + 1
        })`,
        error: sql<string | null>`substr(${runs.error}, 1, ${
          MAX_EVENT_TEXT_CHARS + 1
        })`,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();

    if (!run || run.accountId !== spaceId) {
      return;
    }

    // SQL remains the terminal-event fallback even when intermediate events
    // are offloaded. Read newest-first with one overflow sentinel; an
    // unbounded historical transcript must never become one Worker allocation
    // or an unbounded number of embedding mutations.
    const eventsById = new Map<number, RunEventRecord>();
    const sqlEvents = await db
      .select({
        id: runEvents.id,
        type: runEvents.type,
        data: sql<string>`substr(${runEvents.data}, 1, ${
          MAX_PERSISTED_RUN_EVENT_DATA_BYTES + 1
        })`,
        createdAt: runEvents.createdAt,
      })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.id))
      .limit(MAX_INDEXED_RUN_EVENTS + 1)
      .all();
    let sourceTruncated = sqlEvents.length > MAX_INDEXED_RUN_EVENTS;
    let eventDataTruncated = false;
    for (const event of sqlEvents.slice(0, MAX_INDEXED_RUN_EVENTS)) {
      const data = boundedEventData(event.data);
      eventDataTruncated ||= data === RUN_EVENT_TRUNCATED_DATA;
      eventsById.set(event.id, {
        ...event,
        data,
        createdAt:
          textDateNullable(event.createdAt) ?? new Date(0).toISOString(),
      });
    }
    if (this.offloadBucket) {
      const offloaded = await sourceServiceDeps.getRunEventsAfterPageFromR2(
        this.offloadBucket,
        runId,
        0,
        MAX_INDEXED_RUN_EVENTS,
      );
      sourceTruncated ||= offloaded.hasMore || offloaded.archiveTruncated;
      eventDataTruncated ||= offloaded.dataTruncated;
      for (const event of offloaded.events) {
        eventsById.set(event.event_id, {
          id: event.event_id,
          type: event.type,
          data: event.data,
          createdAt: event.created_at,
        });
      }
    }
    // Committed SQL evidence wins collisions with archive rows. This matters
    // for terminal events whose global SQL id advanced the notifier counter.
    for (const event of sqlEvents.slice(0, MAX_INDEXED_RUN_EVENTS)) {
      const data = boundedEventData(event.data);
      eventsById.set(event.id, {
        ...event,
        data,
        createdAt:
          textDateNullable(event.createdAt) ?? new Date(0).toISOString(),
      });
    }
    const mergedEvents = [...eventsById.values()].sort(
      (left, right) => left.id - right.id,
    );
    sourceTruncated ||= mergedEvents.length > MAX_INDEXED_RUN_EVENTS;
    const events = mergedEvents.slice(-MAX_INDEXED_RUN_EVENTS);

    const entries = events
      .map(formatEvent)
      .filter((entry): entry is string => Boolean(entry));

    sourceTruncated ||= Boolean(
      (run.output && run.output.length > MAX_EVENT_TEXT_CHARS) ||
        (run.error && run.error.length > MAX_EVENT_TEXT_CHARS),
    );
    if (sourceTruncated) entries.unshift(INFO_UNIT_SOURCE_TRUNCATION_NOTICE);

    if (
      run.output &&
      (sourceTruncated || !events.some((event) => event.type === "message"))
    ) {
      entries.push(
        `[assistant] ${truncateText(run.output, MAX_EVENT_TEXT_CHARS)}`,
      );
    }
    if (run.error && !events.some((event) => event.type === "error")) {
      entries.push(`[error] ${truncateText(run.error, MAX_EVENT_TEXT_CHARS)}`);
    }

    const fallback =
      entries.length === 0 ? `[summary] run ${runId} (${run.status})` : null;

    if (fallback) {
      entries.push(fallback);
    }

    const bounded = boundSegments(entries);
    sourceTruncated ||= bounded.contentTruncated;
    const segments = bounded.segments;
    const segmentCount = Math.max(1, segments.length);
    const createdAt = new Date().toISOString();
    const existingSegments = new Map(
      (
        await db
          .select({
            id: infoUnits.id,
            segmentIndex: infoUnits.segmentIndex,
            vectorId: infoUnits.vectorId,
          })
          .from(infoUnits)
          .where(eq(infoUnits.runId, runId))
          .orderBy(asc(infoUnits.segmentIndex))
          .limit(MAX_INFO_UNIT_SEGMENTS_PER_RUN + 1)
          .all()
      ).map((unit) => [unit.segmentIndex, unit]),
    );

    const sessionRepoResults = run.sessionId
      ? await db
          .select({
            repoId: sessionRepos.repoId,
            branch: sessionRepos.branch,
            mountPath: sessionRepos.mountPath,
            isPrimary: sessionRepos.isPrimary,
            repoName: repositories.name,
          })
          .from(sessionRepos)
          .leftJoin(repositories, eq(sessionRepos.repoId, repositories.id))
          .where(eq(sessionRepos.sessionId, run.sessionId))
          .orderBy(asc(sessionRepos.repoId))
          .limit(MAX_INFO_UNIT_SESSION_REPOS + 1)
          .all()
      : [];
    const reposTruncated = sessionRepoResults.length >
      MAX_INFO_UNIT_SESSION_REPOS;
    const repoMetadata = sessionRepoResults.slice(
      0,
      MAX_INFO_UNIT_SESSION_REPOS,
    ).map((repo) => ({
      repo_id: repo.repoId,
      repo_name: repo.repoName,
      branch: repo.branch,
      mount_path: repo.mountPath,
      is_primary: repo.isPrimary,
    }));

    const embeddingFailures: number[] = [];
    for (let index = 0; index < segments.length; index++) {
      const content = segments[index];
      const tokenCount = estimateTokens(content);
      // Stable identity makes a crash after vector upsert or after one segment
      // retryable. Preserve an older random id when migrating an existing
      // partially indexed run; new segments use the deterministic form.
      const existingSegment = existingSegments.get(index);
      const infoUnitId =
        existingSegment?.id ?? `run-info:${spaceId}:${runId}:${index}`;

      let vectorId: string | null = existingSegment?.vectorId ?? null;
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
            repoMetadata.map((repo) => repo.repo_id),
          );
        } catch (err) {
          embeddingFailures.push(index);
          sourceServiceDeps.logWarn(`Embedding failed for run ${runId}`, {
            module: "info_unit",
            detail: err,
          });
        }
      }

      const values = {
        accountId: spaceId,
        threadId: run.threadId,
        runId,
        sessionId: run.sessionId,
        kind: segmentCount > 1 ? "segment" : "session",
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
          source_truncated: sourceTruncated,
          event_data_truncated: eventDataTruncated,
          repos_truncated: reposTruncated,
          repos: repoMetadata,
        }),
        updatedAt: createdAt,
      };
      await db
        .insert(infoUnits)
        .values({ id: infoUnitId, ...values, createdAt })
        .onConflictDoUpdate({
          target: infoUnits.id,
          set: values,
        });
    }
    if (embeddingFailures.length > 0) {
      throw new Error(
        `Info unit embedding incomplete for run ${runId}: segments ${embeddingFailures.join(",")}`,
      );
    }

    // A retry can legitimately produce fewer bounded segments (for example,
    // after a recovered final output replaces noisy progress). Reconcile a
    // finite stale batch so old searchable content cannot survive forever.
    // Additional legacy rows are handled by a later idempotent retry.
    const staleRows = await db.select({
      id: infoUnits.id,
      vectorId: infoUnits.vectorId,
    }).from(infoUnits).where(
      and(
        eq(infoUnits.runId, runId),
        gte(infoUnits.segmentIndex, segmentCount),
      ),
    ).orderBy(asc(infoUnits.segmentIndex), asc(infoUnits.id)).limit(
      MAX_STALE_INFO_UNIT_CLEANUP_ROWS + 1,
    ).all();
    const cleanupBatch = staleRows.slice(0, MAX_STALE_INFO_UNIT_CLEANUP_ROWS);
    const vectorIds = cleanupBatch.flatMap((row) =>
      row.vectorId ? [row.vectorId] : []
    );
    if (vectorIds.length > 0 && this.vectorize) {
      await this.vectorize.deleteByIds(vectorIds);
    }
    const deletableIds = cleanupBatch.flatMap((row) =>
      row.vectorId && !this.vectorize ? [] : [row.id]
    );
    if (deletableIds.length > 0) {
      await db.delete(infoUnits).where(inArray(infoUnits.id, deletableIds));
    }
    if (
      staleRows.length > MAX_STALE_INFO_UNIT_CLEANUP_ROWS ||
      deletableIds.length !== cleanupBatch.length
    ) {
      sourceServiceDeps.logWarn(`Info unit cleanup incomplete for run ${runId}`, {
        module: "info_unit",
        staleRowsObserved: staleRows.length,
        rowsDeleted: deletableIds.length,
        vectorStoreAvailable: Boolean(this.vectorize),
      });
    }
  }
}

export function createInfoUnitIndexer(
  env: Pick<Env, "AI" | "VECTORIZE" | "DB" | "TAKOS_OFFLOAD">,
): InfoUnitIndexer | null {
  if (!env.DB) return null;
  return new InfoUnitIndexer(env);
}
