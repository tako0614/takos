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
import { asc, eq } from "drizzle-orm";
import { EMBEDDING_MODEL } from "../../../shared/config/limits.ts";
import { textDateNullable } from "../../../shared/utils/db-guards.ts";
import { sourceServiceDeps } from "./deps.ts";
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
  if (typeof value === "string") return value;
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
        content: content.slice(0, 1000),
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
        output: runs.output,
        error: runs.error,
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
    // are offloaded. Merge both stores by event id just like the public Run
    // observation path; choosing R2 exclusively would lose atomic completion
    // evidence whenever the post-commit notifier failed.
    const eventsById = new Map<number, RunEventRecord>();
    const sqlEvents = await db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
      .all();
    for (const event of sqlEvents) {
      eventsById.set(event.id, {
        ...event,
        createdAt:
          textDateNullable(event.createdAt) ?? new Date(0).toISOString(),
      });
    }
    if (this.offloadBucket) {
      const offloaded = await sourceServiceDeps.getRunEventsAfterFromR2(
        this.offloadBucket,
        runId,
        0,
        5000,
      );
      for (const event of offloaded) {
        eventsById.set(event.event_id, {
          id: event.event_id,
          type: event.type,
          data: event.data,
          createdAt: event.created_at,
        });
      }
    }
    const events = [...eventsById.values()].sort(
      (left, right) => left.id - right.id,
    );

    const entries = events
      .map(formatEvent)
      .filter((entry): entry is string => Boolean(entry));

    if (run.output && !events.some((event) => event.type === "message")) {
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

    const segments = buildSegments(entries);
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
          .all()
      : [];
    const repoMetadata = sessionRepoResults.map((repo) => ({
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
  }
}

export function createInfoUnitIndexer(
  env: Pick<Env, "AI" | "VECTORIZE" | "DB" | "TAKOS_OFFLOAD">,
): InfoUnitIndexer | null {
  if (!env.DB) return null;
  return new InfoUnitIndexer(env);
}
