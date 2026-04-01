import type { Ai, VectorizeIndex, D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Env, SpaceFile } from '../../../shared/types/index.ts';
import { getDb, files as filesTable } from '../../../infra/db/index.ts';
import { eq, and, ne, isNull, inArray, desc } from 'drizzle-orm';
import { flattenTree, getBlob } from '../git-smart/index.ts';

import { EMBEDDING_MODEL } from '../../../shared/config/limits.ts';
const MAX_CHUNK_SIZE = 512;

export interface EmbeddingResult {
  id: string;
  spaceId: string;
  fileId: string;
  chunkIndex: number;
  content: string;
  vector: number[];
}

export interface EmbeddingSearchResult {
  id: string;
  score: number;
  content: string;
  fileId: string;
  filePath: string;
  chunkIndex: number;
}

export interface RepoSearchResult {
  score: number;
  content: string;
  filePath: string;
  chunkIndex: number;
}

export class EmbeddingsService {
  private ai: Ai;
  private vectorize: VectorizeIndex;
  private db: D1Database;

  constructor(ai: Ai, vectorize: VectorizeIndex, db: D1Database) {
    this.ai = ai;
    this.vectorize = vectorize;
    this.db = db;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const result = await this.ai.run(EMBEDDING_MODEL, {
      text: [text],
    }) as { data: number[][] };

    if (!result.data || result.data.length === 0) {
      throw new Error('Failed to generate embedding');
    }

    return result.data[0];
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batchSize = 100;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const result = await this.ai.run(EMBEDDING_MODEL, {
        text: batch,
      }) as { data: number[][] };

      if (result.data) {
        results.push(...result.data);
      }
    }

    return results;
  }

  splitIntoChunks(content: string): string[] {
    const chunks: string[] = [];
    const lines = content.split('\n');
    let currentChunk = '';
    let currentSize = 0;

    for (const line of lines) {
      const lineSize = line.length / 4;

      if (currentSize + lineSize > MAX_CHUNK_SIZE && currentChunk) {
        chunks.push(currentChunk.trim());
        const overlapLines = currentChunk.split('\n').slice(-3);
        currentChunk = overlapLines.join('\n') + '\n';
        currentSize = currentChunk.length / 4;
      }

      currentChunk += line + '\n';
      currentSize += lineSize;
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  async indexFile(
    spaceId: string,
    file: SpaceFile,
    content: string
  ): Promise<number> {
    const chunks = this.splitIntoChunks(content);
    if (chunks.length === 0) return 0;

    const embeddings = await this.generateEmbeddings(chunks);
    const vectors = chunks.map((chunk, index) => ({
      id: `${spaceId}:${file.id}:${index}`,
      values: embeddings[index],
      metadata: {
        spaceId,
        fileId: file.id,
        filePath: file.path,
        chunkIndex: index,
        content: chunk.slice(0, 1000),
      },
    }));

    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      await this.vectorize.upsert(vectors.slice(i, i + batchSize));
    }

    const drizzle = getDb(this.db);
    await drizzle.update(filesTable)
      .set({ indexedAt: new Date().toISOString() })
      .where(eq(filesTable.id, file.id));

    return chunks.length;
  }

  async removeFile(spaceId: string, fileId: string): Promise<void> {
    // Look up the file's size from D1 to derive the actual upper bound
    // on chunk count, instead of the old hardcoded limit of 100.
    const drizzle = getDb(this.db);
    const file = await drizzle
      .select({ size: filesTable.size })
      .from(filesTable)
      .where(eq(filesTable.id, fileId))
      .get();

    // Each chunk is roughly MAX_CHUNK_SIZE tokens (~2KB). Use a generous
    // estimate: 1 chunk per 1 KB of source, plus a margin.  If the file
    // row is already gone we still attempt deletion with a reasonable cap.
    const estimatedChunks = file ? Math.ceil(file.size / 1024) + 2 : 500;

    const prefix = `${spaceId}:${fileId}:`;
    const ids: string[] = [];
    for (let i = 0; i < estimatedChunks; i++) {
      ids.push(`${prefix}${i}`);
    }

    if (ids.length === 0) return;

    const batchSize = 100;
    for (let i = 0; i < ids.length; i += batchSize) {
      await this.vectorize.deleteByIds(ids.slice(i, i + batchSize));
    }
  }

  async search(
    spaceId: string,
    query: string,
    options: {
      limit?: number;
      fileTypes?: string[];
      minScore?: number;
    } = {}
  ): Promise<EmbeddingSearchResult[]> {
    const { limit = 10, minScore = 0.5 } = options;

    const queryEmbedding = await this.generateEmbedding(query);
    const searchResult = await this.vectorize.query(queryEmbedding, {
      topK: limit * 2, // Get more results for filtering
      filter: { spaceId },
      returnMetadata: 'all',
    });

    const _fileIds = [...new Set(searchResult.matches
      .map((m: { metadata?: Record<string, unknown> }) => {
        const metadata = (m.metadata || {}) as Record<string, unknown>;
        return typeof metadata.fileId === 'string' ? metadata.fileId : null;
      })
      .filter((id: string | null): id is string => typeof id === 'string' && id.length > 0)
    )];

    const results: EmbeddingSearchResult[] = [];

    for (const match of searchResult.matches) {
      if (match.score < minScore) continue;

      const metadata = (match.metadata || {}) as Record<string, unknown>;
      if (typeof metadata.fileId !== 'string' || typeof metadata.filePath !== 'string') continue;
      if (typeof metadata.chunkIndex !== 'number' || typeof metadata.content !== 'string') continue;

      if (options.fileTypes && options.fileTypes.length > 0) {
        const ext = metadata.filePath.split('.').pop()?.toLowerCase();
        if (!ext || !options.fileTypes.includes(ext)) continue;
      }

      results.push({
        id: match.id,
        score: match.score,
        content: metadata.content,
        fileId: metadata.fileId,
        filePath: metadata.filePath,
        chunkIndex: metadata.chunkIndex,
      });

      if (results.length >= limit) break;
    }

    return results;
  }

  async findSimilar(
    spaceId: string,
    content: string,
    options: {
      limit?: number;
      excludeFileId?: string;
      minScore?: number;
    } = {}
  ): Promise<EmbeddingSearchResult[]> {
    const { limit = 5, excludeFileId, minScore = 0.7 } = options;

    const embedding = await this.generateEmbedding(content);

    const searchResult = await this.vectorize.query(embedding, {
      topK: limit * 2,
      filter: { spaceId },
      returnMetadata: 'all',
    });

    const results: EmbeddingSearchResult[] = [];

    for (const match of searchResult.matches) {
      if (match.score < minScore) continue;

      const metadata = (match.metadata || {}) as Record<string, unknown>;
      if (typeof metadata.fileId !== 'string' || typeof metadata.filePath !== 'string') continue;
      if (typeof metadata.chunkIndex !== 'number' || typeof metadata.content !== 'string') continue;

      if (excludeFileId && metadata.fileId === excludeFileId) continue;

      results.push({
        id: match.id,
        score: match.score,
        content: metadata.content,
        fileId: metadata.fileId,
        filePath: metadata.filePath,
        chunkIndex: metadata.chunkIndex,
      });

      if (results.length >= limit) break;
    }

    return results;
  }

  async indexWorkspace(
    spaceId: string,
    storage: R2Bucket | undefined,
    options: {
      forceReindex?: boolean;
    } = {}
  ): Promise<{ indexed: number; chunks: number; errors: string[] }> {
    if (!storage) {
      return { indexed: 0, chunks: 0, errors: ['Storage bucket not available'] };
    }

    const { forceReindex = false } = options;
    const drizzle = getDb(this.db);

    const conditions = [
      eq(filesTable.accountId, spaceId),
      ne(filesTable.origin, 'system'),
      inArray(filesTable.kind, ['source', 'config', 'doc']),
    ];

    if (!forceReindex) {
      conditions.push(isNull(filesTable.indexedAt));
    }

    const filesResult = await drizzle.select().from(filesTable)
      .where(and(...conditions))
      .orderBy(desc(filesTable.updatedAt))
      .limit(100)
      .all();

    const filesList: SpaceFile[] = filesResult.map(f => ({
      id: f.id,
      space_id: f.accountId,
      path: f.path,
      kind: f.kind as SpaceFile['kind'],
      visibility: f.visibility as SpaceFile['visibility'],
      size: f.size,
      sha256: f.sha256,
      mime_type: f.mimeType,
      origin: f.origin as SpaceFile['origin'],
      indexed_at: f.indexedAt ?? null,
      created_at: f.createdAt ?? new Date(0).toISOString(),
      updated_at: f.updatedAt ?? new Date(0).toISOString(),
    }));

    let indexed = 0;
    let totalChunks = 0;
    const errors: string[] = [];

    for (const file of filesList) {
      try {
        if (file.size > 500 * 1024) continue;

        const r2Key = `spaces/${spaceId}/files/${file.id}`;
        const object = await storage.get(r2Key);

        if (!object) continue;

        const content = await object.text();
        const chunks = await this.indexFile(spaceId, file, content);

        indexed++;
        totalChunks += chunks;
      } catch (err) {
        errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { indexed, chunks: totalChunks, errors };
  }

  async indexRepoFiles(
    repoId: string,
    bucket: R2Bucket,
    treeOid: string
  ): Promise<{ indexed: number; chunks: number; errors: string[] }> {
    const MAX_FILE_BYTES = 512 * 1024;
    const files = await flattenTree(bucket, treeOid);

    let indexed = 0;
    let totalChunks = 0;
    const errors: string[] = [];

    for (const file of files) {
      try {
        const blobData = await getBlob(bucket, file.sha);
        if (!blobData) continue;
        if (blobData.length > MAX_FILE_BYTES) continue;

        const isBinary = blobData.some((b) => b === 0);
        if (isBinary) continue;

        let text: string;
        try {
          text = new TextDecoder().decode(blobData);
        } catch {
          continue;
        }

        const chunks = this.splitIntoChunks(text);
        if (chunks.length === 0) continue;

        const embeddings = await this.generateEmbeddings(chunks);
        const pathHash = hashString(file.path);
        const vectors = chunks.map((chunk, idx) => ({
          id: `r:${repoId.slice(0, 16)}:${pathHash}:${idx}`,
          values: embeddings[idx],
          metadata: {
            repoId,
            filePath: file.path,
            chunkIndex: idx,
            content: chunk.slice(0, 1000),
          },
        }));

        const batchSize = 100;
        for (let i = 0; i < vectors.length; i += batchSize) {
          await this.vectorize.upsert(vectors.slice(i, i + batchSize));
        }

        indexed++;
        totalChunks += chunks.length;
      } catch (err) {
        errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { indexed, chunks: totalChunks, errors };
  }

  async searchRepo(
    repoId: string,
    query: string,
    options: { limit?: number; minScore?: number; pathPrefix?: string } = {}
  ): Promise<RepoSearchResult[]> {
    const { limit = 10, minScore = 0.5, pathPrefix } = options;

    const queryEmbedding = await this.generateEmbedding(query);

    const searchResult = await this.vectorize.query(queryEmbedding, {
      topK: limit * 2,
      filter: { repoId },
      returnMetadata: 'all',
    });

    const results: RepoSearchResult[] = [];

    for (const match of searchResult.matches) {
      if (match.score < minScore) continue;

      const metadata = (match.metadata || {}) as Record<string, unknown>;
      if (typeof metadata.filePath !== 'string') continue;
      if (typeof metadata.content !== 'string') continue;

      if (pathPrefix && !metadata.filePath.startsWith(pathPrefix)) continue;

      results.push({
        score: match.score,
        content: metadata.content,
        filePath: metadata.filePath,
        chunkIndex: typeof metadata.chunkIndex === 'number' ? metadata.chunkIndex : 0,
      });

      if (results.length >= limit) break;
    }

    return results;
  }
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function createEmbeddingsService(env: Pick<Env, 'AI' | 'VECTORIZE' | 'DB'>): EmbeddingsService | null {
  if (!env.AI || !env.VECTORIZE) {
    return null;
  }

  return new EmbeddingsService(env.AI, env.VECTORIZE, env.DB);
}

export function isEmbeddingsAvailable(env: Pick<Env, 'AI' | 'VECTORIZE'>): boolean {
  return !!(env.AI && env.VECTORIZE);
}
