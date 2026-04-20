import type { D1Database, R2Bucket } from "../../../shared/types/bindings.ts";
import type { SpaceFile } from "../../../shared/types/index.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import { getDb } from "../../../infra/db/index.ts";
import { chunks, files, indexJobs, nodes } from "../../../infra/db/schema.ts";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { EmbeddingsService } from "../../../application/services/execution/embeddings.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { extractAndCreateEdges } from "./graph.ts";
import { chunkContent, getR2Key } from "./index-context.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

type FileRow = SelectOf<typeof files>;

function toSpaceFile(row: FileRow): SpaceFile {
  return {
    id: row.id,
    space_id: row.accountId,
    path: row.path,
    sha256: row.sha256 ?? null,
    mime_type: row.mimeType ?? null,
    size: row.size,
    origin: row.origin === "ai" || row.origin === "system"
      ? row.origin
      : "user",
    kind: row.kind === "config" || row.kind === "doc" || row.kind === "asset" ||
        row.kind === "artifact" || row.kind === "temp"
      ? row.kind
      : "source",
    visibility: row.visibility === "workspace" || row.visibility === "public"
      ? row.visibility
      : "private",
    indexed_at: row.indexedAt ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function runIndexJob(
  db: D1Database,
  storage: R2Bucket | undefined,
  jobId: string,
  embeddingsService?: EmbeddingsService | null,
): Promise<void> {
  const drizzle = getDb(db);
  const job = await drizzle.select().from(indexJobs).where(
    eq(indexJobs.id, jobId),
  ).get();
  if (!job || job.status !== "queued") {
    return;
  }

  const timestamp = new Date().toISOString();
  await drizzle.update(indexJobs).set({
    status: "running",
    startedAt: timestamp,
  }).where(eq(indexJobs.id, jobId));

  try {
    const fileRows = await drizzle.select().from(files).where(
      and(
        eq(files.accountId, job.accountId),
        ne(files.origin, "system"),
        inArray(files.kind, ["source", "config", "doc"]),
      ),
    ).orderBy(asc(files.path)).all();

    let processed = 0;
    for (const file of fileRows) {
      await indexFileContent(
        db,
        storage,
        job.accountId,
        toSpaceFile(file),
        embeddingsService,
      );
      processed++;
      await drizzle.update(indexJobs).set({ processedFiles: processed }).where(
        eq(indexJobs.id, jobId),
      );
    }

    await drizzle.update(indexJobs).set({
      status: "completed",
      completedAt: new Date().toISOString(),
    }).where(eq(indexJobs.id, jobId));
  } catch (error) {
    await drizzle.update(indexJobs).set({
      status: "failed",
      error: String(error),
      completedAt: new Date().toISOString(),
    }).where(eq(indexJobs.id, jobId));
    throw error;
  }
}

export async function indexFile(
  db: D1Database,
  storage: R2Bucket | undefined,
  spaceId: string,
  fileId: string,
  jobId: string,
  embeddingsService?: EmbeddingsService | null,
): Promise<void> {
  const drizzle = getDb(db);
  const timestamp = new Date().toISOString();
  await drizzle.update(indexJobs).set({
    status: "running",
    startedAt: timestamp,
  }).where(eq(indexJobs.id, jobId));

  try {
    const file = await drizzle.select().from(files).where(eq(files.id, fileId))
      .get();
    if (!file) {
      throw new Error("File not found");
    }

    await indexFileContent(
      db,
      storage,
      spaceId,
      toSpaceFile(file),
      embeddingsService,
    );
    await drizzle.update(indexJobs).set({
      status: "completed",
      processedFiles: 1,
      completedAt: new Date().toISOString(),
    }).where(eq(indexJobs.id, jobId));
  } catch (error) {
    await drizzle.update(indexJobs).set({
      status: "failed",
      error: String(error),
      completedAt: new Date().toISOString(),
    }).where(eq(indexJobs.id, jobId));
    throw error;
  }
}

async function indexFileContent(
  db: D1Database,
  storage: R2Bucket | undefined,
  spaceId: string,
  file: SpaceFile,
  embeddingsService?: EmbeddingsService | null,
): Promise<void> {
  if (!storage) {
    throw new Error("Storage not configured");
  }

  const drizzle = getDb(db);
  const r2Key = getR2Key(spaceId, file.id);
  const object = await storage.get(r2Key);
  if (!object) {
    throw new Error(`File content not found: ${file.path}`);
  }

  const content = await object.text();
  await drizzle.delete(chunks).where(eq(chunks.fileId, file.id));
  await drizzle.delete(nodes).where(
    and(
      eq(nodes.accountId, spaceId),
      eq(nodes.type, "file"),
      eq(nodes.refId, file.id),
    ),
  );

  const contentChunks = chunkContent(content);
  const timestamp = new Date().toISOString();
  for (const chunk of contentChunks) {
    const chunkId = generateId();
    await drizzle.insert(chunks).values({
      id: chunkId,
      fileId: file.id,
      accountId: spaceId,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      content: chunk.content,
      createdAt: new Date().toISOString(),
    });
  }

  if (embeddingsService) {
    try {
      await embeddingsService.removeFile(spaceId, file.id);
      await embeddingsService.indexFile(spaceId, file, content);
    } catch (err) {
      logWarn("Vectorize indexing failed", {
        module: "routes/index/jobs",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const nodeId = generateId();
  await drizzle.insert(nodes).values({
    id: nodeId,
    accountId: spaceId,
    type: "file",
    refId: file.id,
    label: file.path,
    metadata: "{}",
    createdAt: timestamp,
  });

  await drizzle.update(files).set({
    indexedAt: timestamp,
    updatedAt: timestamp,
  }).where(eq(files.id, file.id));

  await extractAndCreateEdges(db, spaceId, file, content, nodeId);
}
