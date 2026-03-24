import type { R2Bucket } from '../../../shared/types/bindings.ts';
import { gzipCompressString, gzipDecompressToString } from '../../../shared/utils/gzip';

export interface PersistedRunEvent {
  event_id: number;
  type: string;
  data: string; // JSON string
  created_at: string;
}

export const RUN_EVENT_SEGMENT_SIZE = 100;

function pad6(n: number): string {
  return String(n).padStart(6, '0');
}

export function segmentIndexForEventId(eventId: number): number {
  if (!Number.isFinite(eventId) || eventId <= 0) return 1;
  return Math.floor((eventId - 1) / RUN_EVENT_SEGMENT_SIZE) + 1;
}

export function buildRunEventSegmentKey(runId: string, segmentIndex: number): string {
  return `runs/${runId}/events/${pad6(segmentIndex)}.jsonl.gz`;
}

export async function writeRunEventSegmentToR2(
  bucket: R2Bucket,
  runId: string,
  segmentIndex: number,
  events: PersistedRunEvent[],
): Promise<void> {
  const key = buildRunEventSegmentKey(runId, segmentIndex);
  const jsonl = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const compressed = await gzipCompressString(jsonl);
  await bucket.put(key, compressed, {
    httpMetadata: {
      contentType: 'application/x-ndjson; charset=utf-8',
      contentEncoding: 'gzip',
    },
  });
}

function parseSegmentIndexFromKey(key: string, prefix: string): number | null {
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const m = rest.match(/^(\d+)\.jsonl\.gz$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export async function listRunEventSegmentIndexes(bucket: R2Bucket, runId: string): Promise<number[]> {
  const prefix = `runs/${runId}/events/`;
  const indexes = new Set<number>();

  let cursor: string | undefined;
  while (true) {
    const res = await bucket.list({ prefix, cursor });
    for (const obj of res.objects) {
      const idx = parseSegmentIndexFromKey(obj.key, prefix);
      if (idx) indexes.add(idx);
    }
    if (res.truncated) {
      cursor = res.cursor;
      continue;
    }
    break;
  }

  return Array.from(indexes).sort((a, b) => a - b);
}

export async function readRunEventSegmentFromR2(
  bucket: R2Bucket,
  runId: string,
  segmentIndex: number,
): Promise<PersistedRunEvent[] | null> {
  const key = buildRunEventSegmentKey(runId, segmentIndex);
  const obj = await bucket.get(key);
  if (!obj) return null;
  const compressed = await obj.arrayBuffer();
  const jsonl = await gzipDecompressToString(compressed, { maxDecompressedBytes: 200 * 1024 * 1024 });

  const events: PersistedRunEvent[] = [];
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as PersistedRunEvent;
      if (!parsed || typeof parsed !== 'object') continue;
      if (typeof parsed.event_id !== 'number' || !Number.isFinite(parsed.event_id)) continue;
      if (typeof parsed.type !== 'string') continue;
      if (typeof parsed.data !== 'string') continue;
      if (typeof parsed.created_at !== 'string') continue;
      events.push(parsed);
    } catch { /* ignored - skip malformed lines */ }
  }

  events.sort((a, b) => a.event_id - b.event_id);
  return events;
}

export async function getRunEventsAfterFromR2(
  bucket: R2Bucket,
  runId: string,
  afterEventId: number,
  limit: number = 500,
): Promise<PersistedRunEvent[]> {
  const startSegment = Math.floor(Math.max(0, afterEventId) / RUN_EVENT_SEGMENT_SIZE) + 1;
  const segmentIndexes = (await listRunEventSegmentIndexes(bucket, runId)).filter((n) => n >= startSegment);

  const segments = await Promise.all(
    segmentIndexes.map((idx) => readRunEventSegmentFromR2(bucket, runId, idx)),
  );

  const out: PersistedRunEvent[] = [];
  for (const segment of segments) {
    if (!segment) continue;
    for (const e of segment) {
      if (e.event_id <= afterEventId) continue;
      out.push(e);
      if (out.length >= limit) return out;
    }
  }

  return out;
}
