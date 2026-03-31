/**
 * Session Files Manager
 *
 * Manages file operations within a session context.
 * Files are tracked in session_files table until merged.
 */

import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import { generateId } from '../../../shared/utils/index.ts';
import { computeSHA256 } from '../../../shared/utils/hash.ts';
import { getDb, sessionFiles, files } from '../../../infra/db/index.ts';
import { eq, and, ne, asc } from 'drizzle-orm';
import { textDateNullable } from '../../../shared/utils/db-guards.ts';

export interface SessionFile {
  id: string;
  session_id: string;
  path: string;
  hash: string;
  size: number;
  operation: 'create' | 'update' | 'delete';
  created_at: string;
}

export interface FileContent {
  path: string;
  content: string;
  hash: string;
  size: number;
}

function getSpaceR2Key(spaceId: string, fileId: string): string {
  return `spaces/${spaceId}/files/${fileId}`;
}

function getSessionBlobKey(spaceId: string, hash: string): string {
  return `blobs/${spaceId}/${hash}`;
}

export class SessionFilesManager {
  constructor(
    private db: D1Database,
    private storage: R2Bucket | undefined,
    private spaceId: string,
    private sessionId: string
  ) {}

  /** Read a file - checks session_files first, then falls back to workspace. */
  async readFile(path: string): Promise<FileContent | null> {
    const drizzle = getDb(this.db);

    const sessionFile = await drizzle.select()
      .from(sessionFiles)
      .where(
        and(
          eq(sessionFiles.sessionId, this.sessionId),
          eq(sessionFiles.path, path),
        )
      )
      .get();

    if (sessionFile) {
      if (sessionFile.operation === 'delete') {
        return null;
      }

      if (this.storage) {
        const blobKey = getSessionBlobKey(this.spaceId, sessionFile.hash);
        const blob = await this.storage.get(blobKey);
        if (blob) {
          const content = await blob.text();
          return {
            path,
            content,
            hash: sessionFile.hash,
            size: sessionFile.size,
          };
        }
      }
    }

    const spaceFile = await drizzle.select({
      id: files.id,
      path: files.path,
      sha256: files.sha256,
      size: files.size,
    })
      .from(files)
      .where(
        and(
          eq(files.accountId, this.spaceId),
          eq(files.path, path),
        )
      )
      .get();

    if (!spaceFile) {
      return null;
    }

    if (this.storage) {
      const r2Key = getSpaceR2Key(this.spaceId, spaceFile.id);
      const obj = await this.storage.get(r2Key);
      if (obj) {
        const content = await obj.text();
        return {
          path,
          content,
          hash: spaceFile.sha256 || '',
          size: spaceFile.size,
        };
      }
    }

    return null;
  }

  /** Write a file - stores in session_files (assumes UTF-8 encoding). */
  async writeFile(path: string, content: string): Promise<{ hash: string; size: number }> {
    const drizzle = getDb(this.db);

    const hash = await computeSHA256(content);
    const size = new TextEncoder().encode(content).length;
    const id = generateId();
    const now = new Date().toISOString();

    const existingSession = await drizzle.select({ operation: sessionFiles.operation })
      .from(sessionFiles)
      .where(
        and(
          eq(sessionFiles.sessionId, this.sessionId),
          eq(sessionFiles.path, path),
        )
      )
      .get();

    const existingWorkspace = await drizzle.select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.accountId, this.spaceId),
          eq(files.path, path),
        )
      )
      .get();

    let operation: 'create' | 'update';
    if (existingSession) {
      operation = existingSession.operation === 'delete' ? 'create' : 'update';
    } else {
      operation = existingWorkspace ? 'update' : 'create';
    }

    if (this.storage) {
      const blobKey = getSessionBlobKey(this.spaceId, hash);
      const existing = await this.storage.head(blobKey);
      if (!existing) {
        await this.storage.put(blobKey, content, {
          customMetadata: {
            'workspace-id': this.spaceId,
            'session-id': this.sessionId,
          },
        });
      }
    }

    const existingFile = await drizzle.select()
      .from(sessionFiles)
      .where(
        and(
          eq(sessionFiles.sessionId, this.sessionId),
          eq(sessionFiles.path, path),
        )
      )
      .get();
    if (existingFile) {
      await drizzle.update(sessionFiles)
        .set({
          hash: hash,
          size: size,
          operation: operation,
        })
        .where(
          and(
            eq(sessionFiles.sessionId, this.sessionId),
            eq(sessionFiles.path, path),
          )
        )
        .run();
    } else {
      try {
        await drizzle.insert(sessionFiles)
          .values({
            id: id,
            sessionId: this.sessionId,
            path: path,
            hash: hash,
            size: size,
            operation: operation,
            createdAt: now,
          })
          .run();
      } catch {
        await drizzle.update(sessionFiles)
          .set({
            hash: hash,
            size: size,
            operation: operation,
          })
          .where(
            and(
              eq(sessionFiles.sessionId, this.sessionId),
              eq(sessionFiles.path, path),
            )
          )
          .run();
      }
    }

    return { hash, size };
  }

  /** Delete a file - records deletion in session_files. */
  async deleteFile(path: string): Promise<boolean> {
    const drizzle = getDb(this.db);
    const id = generateId();
    const now = new Date().toISOString();

    const file = await this.readFile(path);
    if (!file) {
      return false;
    }

    const existingDelFile = await drizzle.select()
      .from(sessionFiles)
      .where(
        and(
          eq(sessionFiles.sessionId, this.sessionId),
          eq(sessionFiles.path, path),
        )
      )
      .get();
    if (existingDelFile) {
      await drizzle.update(sessionFiles)
        .set({
          hash: '',
          size: 0,
          operation: 'delete',
        })
        .where(
          and(
            eq(sessionFiles.sessionId, this.sessionId),
            eq(sessionFiles.path, path),
          )
        )
        .run();
    } else {
      try {
        await drizzle.insert(sessionFiles)
          .values({
            id: id,
            sessionId: this.sessionId,
            path: path,
            hash: '',
            size: 0,
            operation: 'delete',
            createdAt: now,
          })
          .run();
      } catch {
        await drizzle.update(sessionFiles)
          .set({
            hash: '',
            size: 0,
            operation: 'delete',
          })
          .where(
            and(
              eq(sessionFiles.sessionId, this.sessionId),
              eq(sessionFiles.path, path),
            )
          )
          .run();
      }
    }

    return true;
  }

  /** List files - combines workspace files with session modifications. */
  async listFiles(directory?: string): Promise<Array<{ path: string; size: number }>> {
    const drizzle = getDb(this.db);

    const whereConditions = [
      eq(files.accountId, this.spaceId),
      ne(files.origin, 'system'),
    ];

    const spaceFiles = await drizzle.select({
      path: files.path,
      size: files.size,
    })
      .from(files)
      .where(and(...whereConditions))
      .all();

    const filesMap = new Map<string, number>();
    for (const f of spaceFiles) {
      if (directory && !f.path.startsWith(directory + '/')) continue;
      filesMap.set(f.path, f.size);
    }

    const sessionFileRows = await drizzle.select({
      path: sessionFiles.path,
      size: sessionFiles.size,
      operation: sessionFiles.operation,
    })
      .from(sessionFiles)
      .where(eq(sessionFiles.sessionId, this.sessionId))
      .all();

    for (const sf of sessionFileRows) {
      if (directory && !sf.path.startsWith(directory + '/')) {
        continue;
      }
      if (sf.operation === 'delete') {
        filesMap.delete(sf.path);
      } else {
        filesMap.set(sf.path, sf.size);
      }
    }

    return Array.from(filesMap.entries()).map(([path, size]) => ({ path, size }));
  }

  /** Get all session file changes. */
  async getChanges(): Promise<SessionFile[]> {
    const drizzle = getDb(this.db);

    const results = await drizzle.select()
      .from(sessionFiles)
      .where(eq(sessionFiles.sessionId, this.sessionId))
      .orderBy(asc(sessionFiles.createdAt))
      .all();

    return results.map(sf => ({
      id: sf.id,
      session_id: sf.sessionId,
      path: sf.path,
      hash: sf.hash,
      size: sf.size,
      operation: sf.operation as 'create' | 'update' | 'delete',
      created_at: textDateNullable(sf.createdAt) ?? new Date().toISOString(),
    }));
  }

  /** Get all files for runtime execution. */
  async getAllFilesForRuntime(): Promise<Array<{ path: string; content: string }>> {
    const files = await this.listFiles();
    const result: Array<{ path: string; content: string }> = [];

    for (const file of files) {
      const content = await this.readFile(file.path);
      if (content) {
        result.push({ path: file.path, content: content.content });
      }
    }

    return result;
  }
}
