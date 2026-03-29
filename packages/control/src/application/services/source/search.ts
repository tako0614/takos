import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Env, SpaceFile, FileKind, FileOrigin } from '../../../shared/types';
import { createEmbeddingsService, isEmbeddingsAvailable } from '../execution/embeddings';
import { getDb, files } from '../../../infra/db';
import { eq, and, ne, like, desc, sql } from 'drizzle-orm';
import { logError, logWarn } from '../../../shared/utils/logger';

export type SearchType = 'filename' | 'content' | 'semantic' | 'all';

export interface SearchRequestBody {
  query: string;
  type?: SearchType;
  file_types?: string[];
  limit?: number;
}

export interface ContentMatch {
  line: number;
  content: string;
  highlight: { start: number; end: number }[];
}

export interface CodeSearchResult {
  type: 'file' | 'content' | 'semantic';
  file: SpaceFile;
  matches?: ContentMatch[];
  score?: number;
  semanticContent?: string;
}

interface SemanticResultRow {
  fileId: string;
  score: number;
  content: string;
}

function getR2Key(spaceId: string, fileId: string): string {
  return `spaces/${spaceId}/files/${fileId}`;
}

function toSpaceFile(f: {
  id: string;
  accountId: string;
  path: string;
  kind: string;
  mimeType: string | null;
  size: number;
  sha256: string | null;
  origin: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}): SpaceFile {
  return {
    id: f.id,
    space_id: f.accountId,
    path: f.path,
    kind: f.kind as FileKind,
    mime_type: f.mimeType,
    size: f.size,
    sha256: f.sha256,
    origin: f.origin as FileOrigin,
    created_at: (f.createdAt == null ? null : typeof f.createdAt === 'string' ? f.createdAt : f.createdAt.toISOString()),
    updated_at: (f.updatedAt == null ? null : typeof f.updatedAt === 'string' ? f.updatedAt : f.updatedAt.toISOString()),
  };
}

export async function searchWorkspace(params: {
  env: Env;
  spaceId: string;
  query: string;
  searchType?: SearchType;
  fileTypes?: string[];
  limit?: number;
}): Promise<{ results: CodeSearchResult[]; total: number; semanticAvailable: boolean }> {
  const { env, spaceId, query, fileTypes } = params;
  const searchType = params.searchType || 'all';
  const limit = Math.min(params.limit || 20, 100);
  const results: CodeSearchResult[] = [];
  const semanticAvailable = isEmbeddingsAvailable(env);
  const db = getDb(env.DB);

  if ((searchType === 'semantic' || searchType === 'all') && semanticAvailable) {
    const embeddingsService = createEmbeddingsService(env);
    if (embeddingsService) {
      try {
        const semanticResults = await embeddingsService.search(spaceId, query, {
          limit: searchType === 'semantic' ? limit : Math.floor(limit / 2),
          fileTypes,
          minScore: 0.5,
        });

        const semanticResultsTyped = semanticResults as SemanticResultRow[];

        if (semanticResultsTyped.length > 0) {
          const fileIds = semanticResultsTyped.map(sr => sr.fileId);
          const fileRows = await db.select().from(files)
            .where(sql`${files.id} IN (${sql.join(fileIds.map(id => sql`${id}`), sql`, `)})`)
            .all();

          const fileMap = new Map(fileRows.map(f => [f.id, f]));

          for (const sr of semanticResultsTyped) {
            const file = fileMap.get(sr.fileId);
            if (file) {
              results.push({
                type: 'semantic',
                file: toSpaceFile(file),
                score: sr.score * 100,
                semanticContent: sr.content,
              });
            }
          }
        }
      } catch (err) {
        logError('Semantic search failed', err, { module: 'services/source/search' });
      }
    }
  }

  if (searchType === 'filename' || searchType === 'all') {
    const filenameResults = await searchFilenames(env.DB, spaceId, query, fileTypes, limit);
    results.push(...filenameResults);
  }

  if (searchType === 'content' || (searchType === 'all' && results.length < limit)) {
    const contentResults = await searchContent(env.DB, env.TENANT_SOURCE, spaceId, query, fileTypes, limit - results.length);
    results.push(...contentResults);
  }

  results.sort((a, b) => {
    if (a.score && b.score) return b.score - a.score;
    const typePriority = { semantic: 3, content: 2, file: 1 };
    return (typePriority[b.type] || 0) - (typePriority[a.type] || 0);
  });

  const seen = new Set<string>();
  const deduped = results.filter(r => {
    if (seen.has(r.file.id)) return false;
    seen.add(r.file.id);
    return true;
  });

  return { results: deduped.slice(0, limit), total: deduped.length, semanticAvailable };
}

export async function quickSearchPaths(d1: D1Database, spaceId: string, query: string): Promise<string[]> {
  const db = getDb(d1);
  const fileRows = await db.select({ path: files.path }).from(files)
    .where(and(eq(files.accountId, spaceId), ne(files.origin, 'system'), like(files.path, `%${query}%`)))
    .orderBy(desc(files.updatedAt))
    .limit(10)
    .all();
  return fileRows.map(f => f.path);
}

export async function searchFilenames(d1: D1Database, spaceId: string, query: string, fileTypes?: string[], limit: number = 20): Promise<CodeSearchResult[]> {
  const db = getDb(d1);
  const conditions = [eq(files.accountId, spaceId), ne(files.origin, 'system'), like(files.path, `%${query}%`)];

  if (fileTypes && fileTypes.length > 0) {
    conditions.push(sql`(${sql.join(fileTypes.map(t => like(files.path, `%.${t}`)), sql` OR `)})`);
  }

  const fileRows = await db.select().from(files).where(and(...conditions)).orderBy(desc(files.updatedAt)).limit(limit).all();

  return fileRows.map(file => ({
    type: 'file' as const,
    file: toSpaceFile(file),
    score: calculateFilenameScore(file.path, query),
  }));
}

export async function searchContent(d1: D1Database, storage: R2Bucket | undefined, spaceId: string, query: string, fileTypes?: string[], limit: number = 20): Promise<CodeSearchResult[]> {
  if (!storage) return [];
  const db = getDb(d1);
  const fileRows = await db.select().from(files)
    .where(and(eq(files.accountId, spaceId), ne(files.origin, 'system'), sql`${files.kind} IN ('source', 'config', 'doc')`))
    .orderBy(desc(files.updatedAt))
    .limit(100)
    .all();

  const results: CodeSearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const file of fileRows) {
    if (results.length >= limit) break;
    if (file.size > 1024 * 1024) continue;
    if (fileTypes && fileTypes.length > 0) {
      const ext = file.path.split('.').pop()?.toLowerCase();
      if (!ext || !fileTypes.includes(ext)) continue;
    }
    try {
      const r2Key = getR2Key(spaceId, file.id);
      const object = await storage.get(r2Key);
      if (!object) continue;
      const content = await object.text();
      const matches = findContentMatches(content, queryLower);
      if (matches.length > 0) {
        results.push({ type: 'content', file: toSpaceFile(file), matches: matches.slice(0, 5), score: matches.length * 10 + calculateFilenameScore(file.path, query) });
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('not found')) {
        logWarn(`Error reading file ${file.path}`, { module: 'search', detail: err.message });
      }
      continue;
    }
  }

  return results;
}

function calculateFilenameScore(path: string, query: string): number {
  const filename = path.split('/').pop() || path;
  const queryLower = query.toLowerCase();
  const filenameLower = filename.toLowerCase();
  const pathLower = path.toLowerCase();
  let score = 0;
  if (filenameLower === queryLower) score += 100;
  else if (filenameLower.startsWith(queryLower)) score += 80;
  else if (filenameLower.includes(queryLower)) score += 60;
  else if (pathLower.includes(queryLower)) score += 40;
  score += Math.max(0, 20 - path.split('/').length * 2);
  return score;
}

function findContentMatches(content: string, query: string): ContentMatch[] {
  const lines = content.split('\n');
  const matches: ContentMatch[] = [];
  const queryLower = query.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();
    let startIdx = 0;
    const highlights: { start: number; end: number }[] = [];
    while (true) {
      const idx = lineLower.indexOf(queryLower, startIdx);
      if (idx === -1) break;
      highlights.push({ start: idx, end: idx + query.length });
      startIdx = idx + 1;
    }
    if (highlights.length > 0) {
      matches.push({ line: i + 1, content: line.slice(0, 200), highlight: highlights });
    }
  }
  return matches;
}
