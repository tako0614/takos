import type { R2Bucket } from "../../../../shared/types/bindings.ts";
import {
  DEFAULT_LOG_CHUNK_BYTES,
  MAX_LOG_CHUNK_BYTES,
} from "../../../../shared/config/limits.ts";

export class LogsNotFoundError extends Error {
  constructor() {
    super("Logs not found");
    this.name = "LogsNotFoundError";
  }
}

export function parseLogRange(offsetParam?: string, limitParam?: string) {
  const hasRange = offsetParam !== undefined || limitParam !== undefined;
  if (!hasRange) {
    return { hasRange: false, offset: 0, limit: 0 };
  }

  const offset = Math.max(0, parseInt(offsetParam || "0", 10) || 0);
  let limit = parseInt(limitParam || "", 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = DEFAULT_LOG_CHUNK_BYTES;
  }
  limit = Math.min(limit, MAX_LOG_CHUNK_BYTES);

  return { hasRange: true, offset, limit };
}

export async function readJobLogs(
  bucket: R2Bucket,
  key: string,
  range: { hasRange: boolean; offset: number; limit: number },
): Promise<
  {
    logs: string;
    offset: number;
    next_offset: number;
    has_more: boolean;
    total_size: number | null;
  }
> {
  if (!range.hasRange) {
    const logsObject = await bucket.get(key);
    if (!logsObject) {
      throw new LogsNotFoundError();
    }

    const buffer = await logsObject.arrayBuffer();
    const logs = new TextDecoder().decode(buffer);
    const totalSize = logsObject.size ?? buffer.byteLength;

    return {
      logs,
      offset: 0,
      next_offset: totalSize,
      has_more: false,
      total_size: totalSize,
    };
  }

  const rangedObject = await bucket.get(key, {
    range: { offset: range.offset, length: range.limit },
  });

  if (!rangedObject) {
    throw new LogsNotFoundError();
  }

  const buffer = await rangedObject.arrayBuffer();
  const logs = new TextDecoder().decode(buffer);
  const totalSize = rangedObject.size ?? null;
  const nextOffset = range.offset + buffer.byteLength;
  const hasMore = totalSize !== null
    ? nextOffset < totalSize
    : buffer.byteLength === range.limit;

  return {
    logs,
    offset: range.offset,
    next_offset: nextOffset,
    has_more: hasMore,
    total_size: totalSize,
  };
}
