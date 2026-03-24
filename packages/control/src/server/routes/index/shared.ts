import type { ExecutionContext } from 'hono';
import type { AppContext, BaseVariables } from '../shared/helpers';

export type IndexContext = AppContext<BaseVariables>;

export type VectorizeIndexBody = {
  force_reindex?: boolean;
};

export type IndexFileBody = {
  path: string;
};

export function scheduleBackground(c: IndexContext, task: Promise<unknown>): void {
  const ctx = c.executionCtx;
  if (ctx && 'waitUntil' in ctx) {
    (ctx as ExecutionContext).waitUntil(task);
  }
}

export function getR2Key(spaceId: string, fileId: string): string {
  return `spaces/${spaceId}/files/${fileId}`;
}

export function chunkContent(
  content: string,
  maxChunkSize: number = 1000
): Array<{ startLine: number; endLine: number; content: string }> {
  const lines = content.split('\n');
  const chunks: Array<{ startLine: number; endLine: number; content: string }> = [];
  let currentChunk: string[] = [];
  let startLine = 1;
  let currentSize = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineSize = line.length + 1;

    if (currentSize + lineSize > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        startLine,
        endLine: startLine + currentChunk.length - 1,
        content: currentChunk.join('\n'),
      });
      currentChunk = [line];
      startLine = i + 1;
      currentSize = lineSize;
      continue;
    }

    currentChunk.push(line);
    currentSize += lineSize;
  }

  if (currentChunk.length > 0) {
    chunks.push({
      startLine,
      endLine: startLine + currentChunk.length - 1,
      content: currentChunk.join('\n'),
    });
  }

  return chunks;
}

export function resolvePath(from: string, to: string): string {
  const fromParts = from.split('/').slice(0, -1);
  const toParts = to.split('/');

  for (const part of toParts) {
    if (part === '.') continue;
    if (part === '..') {
      fromParts.pop();
      continue;
    }
    fromParts.push(part);
  }

  return fromParts.join('/');
}
