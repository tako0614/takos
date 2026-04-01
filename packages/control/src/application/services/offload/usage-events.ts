import type { R2Bucket, R2ObjectBody } from '../../../shared/types/bindings.ts';
import { gzipCompressString, gzipDecompressToString } from '../../../shared/utils/gzip.ts';

export type PersistedUsageEvent = {
  meter_type: string;
  units: number;
  reference_type?: string | null;
  metadata?: string | null;
  created_at: string;
};

export const USAGE_EVENT_SEGMENT_SIZE = 200;
const USAGE_PREFIX_SUFFIX = '/usage/';

export const usageEventsDeps = {
  gzipCompressString,
  gzipDecompressToString,
};

export function usageSegmentKey(runId: string, segmentIndex: number): string {
  return `runs/${runId}/usage/${String(segmentIndex).padStart(6, '0')}.jsonl.gz`;
}

export async function writeUsageEventSegmentToR2(
  bucket: R2Bucket,
  runId: string,
  segmentIndex: number,
  events: PersistedUsageEvent[]
): Promise<void> {
  if (!events.length) return;
  const jsonl = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const gz = await usageEventsDeps.gzipCompressString(jsonl);
  const key = usageSegmentKey(runId, segmentIndex);
  await bucket.put(key, gz, {
    httpMetadata: {
      contentType: 'application/jsonl',
      contentEncoding: 'gzip',
    },
    customMetadata: {
      kind: 'usage_events',
      run_id: runId,
      segment: String(segmentIndex),
    },
  });
}

async function listUsageSegments(bucket: R2Bucket, runId: string): Promise<string[]> {
  const prefix = `runs/${runId}${USAGE_PREFIX_SUFFIX}`;
  const keys: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const listed = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const obj of listed.objects) {
      keys.push(obj.key);
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }

  keys.sort();
  return keys;
}

async function readSegmentObject(obj: R2ObjectBody): Promise<PersistedUsageEvent[]> {
  const ab = await obj.arrayBuffer();
  const jsonl = await usageEventsDeps.gzipDecompressToString(ab, { maxDecompressedBytes: 50 * 1024 * 1024 });
  const lines = jsonl.split('\n').filter(Boolean);
  const out: PersistedUsageEvent[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as PersistedUsageEvent;
      if (!parsed || typeof parsed !== 'object') continue;
      if (typeof parsed.meter_type !== 'string') continue;
      if (typeof parsed.units !== 'number' || !Number.isFinite(parsed.units)) continue;
      if (typeof parsed.created_at !== 'string') continue;
      out.push(parsed);
    } catch (_err) { /* ignored - skip malformed lines */ }
  }
  return out;
}

export async function getUsageEventsFromR2(
  bucket: R2Bucket,
  runId: string,
  options: { maxEvents?: number } = {}
): Promise<PersistedUsageEvent[]> {
  const maxEvents = Math.max(1, Math.min(options.maxEvents ?? 10_000, 100_000));
  const keys = await listUsageSegments(bucket, runId);
  const objects = await Promise.all(keys.map((key) => bucket.get(key)));
  const segments = await Promise.all(
    objects.map((obj: R2ObjectBody | null) => (obj ? readSegmentObject(obj) : Promise.resolve([] as PersistedUsageEvent[]))),
  );

  const out: PersistedUsageEvent[] = [];
  for (const events of segments) {
    for (const ev of events) {
      out.push(ev);
      if (out.length >= maxEvents) return out;
    }
  }

  return out;
}

