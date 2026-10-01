import { describe, expect, test } from "bun:test";
import type {
  ObjectStoreBinding,
  ObjectStoreObjectBody,
} from "../../../shared/types/bindings.ts";
import { gzipCompressString } from "../../../shared/utils/gzip.ts";
import {
  getUsageEventsFromR2,
  usageSegmentKey,
  type PersistedUsageEvent,
} from "./usage-events.ts";

type VirtualSegment = {
  key: string;
  body?: ArrayBuffer;
  missing?: boolean;
  getError?: boolean;
};

function event(index: number): PersistedUsageEvent {
  return {
    meter_type: "tokens",
    units: index + 0.5,
    reference_type: "completion",
    metadata: `event-${index}`,
    created_at: `2026-10-01T00:00:${String(index).padStart(2, "0")}.000Z`,
  };
}

async function encodedEvents(events: PersistedUsageEvent[]): Promise<ArrayBuffer> {
  return gzipCompressString(events.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

function malformedGzip(): ArrayBuffer {
  return new TextEncoder().encode("not gzip").buffer as ArrayBuffer;
}

function virtualBucket(
  segments: VirtualSegment[],
  pageSize = 2,
  enforceSingleGet = true,
) {
  const sorted = [...segments].sort((a, b) => a.key.localeCompare(b.key));
  const getKeys: string[] = [];
  let activeGets = 0;
  let maximumActiveGets = 0;
  let activeBodies = 0;
  let maximumActiveBodies = 0;
  let getsWhileBodyActive = 0;
  const bucket = {
    async list(options: Record<string, unknown> = {}) {
      const cursor = options.cursor;
      const offset = typeof cursor === "string" ? Number(cursor) : 0;
      const page = sorted.slice(offset, offset + pageSize);
      const nextOffset = offset + page.length;
      return {
        objects: [...page].reverse().map(({ key }) => ({ key } as never)),
        truncated: nextOffset < sorted.length,
        ...(nextOffset < sorted.length ? { cursor: String(nextOffset) } : {}),
        delimitedPrefixes: [],
      };
    },
    async get(key: string) {
      getKeys.push(key);
      activeGets++;
      maximumActiveGets = Math.max(maximumActiveGets, activeGets);
      try {
        await Promise.resolve();
        if (activeBodies > 0) {
          getsWhileBodyActive++;
          throw new Error("GET while body read active");
        }
        if (enforceSingleGet && activeGets > 1) {
          throw new Error("concurrent GET/body read");
        }
        const segment = segments.find((candidate) => candidate.key === key);
        if (!segment || segment.missing) return null;
        if (segment.getError) throw new Error("required GET failed");
        const bytes = segment.body ?? new ArrayBuffer(0);
        return {
          async arrayBuffer() {
            activeBodies++;
            maximumActiveBodies = Math.max(maximumActiveBodies, activeBodies);
            try {
              await Promise.resolve();
              return bytes.slice(0);
            } finally {
              activeBodies--;
            }
          },
        } as ObjectStoreObjectBody;
      } finally {
        activeGets--;
      }
    },
  } as unknown as ObjectStoreBinding;
  return {
    bucket,
    getKeys,
    get maximumActiveGets() { return maximumActiveGets; },
    get maximumActiveBodies() { return maximumActiveBodies; },
    get getsWhileBodyActive() { return getsWhileBodyActive; },
  };
}

describe("getUsageEventsFromR2", () => {
  test("reads sorted segments sequentially and stops once the cap is reached", async () => {
    const segments: VirtualSegment[] = [
      { key: usageSegmentKey("ordered", 3), body: await encodedEvents([event(3)]) },
      { key: usageSegmentKey("ordered", 0), body: await encodedEvents([event(0), event(1)]) },
      { key: usageSegmentKey("ordered", 2), body: malformedGzip() },
      { key: usageSegmentKey("ordered", 1), body: await encodedEvents([event(2)]) },
      ...Array.from({ length: 100 }, (_, i) => ({
        key: usageSegmentKey("ordered", i + 4),
        body: malformedGzip(),
      })),
    ];
    const fixture = virtualBucket(segments, 3);

    const result = await getUsageEventsFromR2(
      fixture.bucket,
      "ordered",
      { maxEvents: 3 },
    ).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    expect(result).toEqual({ ok: true, value: [event(0), event(1), event(2)] });
    expect(fixture.getKeys).toEqual([
      usageSegmentKey("ordered", 0),
      usageSegmentKey("ordered", 1),
    ]);
    expect(fixture.maximumActiveGets).toBe(1);
    expect(fixture.maximumActiveBodies).toBe(1);
    expect(fixture.getsWhileBodyActive).toBe(0);
  });

  test("continues across missing and empty segments and preserves sorted event order", async () => {
    const segments: VirtualSegment[] = [
      { key: usageSegmentKey("gaps", 4), body: await encodedEvents([event(3)]) },
      { key: usageSegmentKey("gaps", 0), missing: true },
      { key: usageSegmentKey("gaps", 2), body: await encodedEvents([]) },
      { key: usageSegmentKey("gaps", 3), body: await encodedEvents([event(2)]) },
      { key: usageSegmentKey("gaps", 1), body: await encodedEvents([event(0), event(1)]) },
    ];
    const { bucket, getKeys } = virtualBucket(segments, 2);

    await expect(getUsageEventsFromR2(bucket, "gaps"))
      .resolves.toEqual([event(0), event(1), event(2), event(3)]);
    expect(getKeys).toEqual(segments.map(({ key }) => key).sort());
  });

  test("rejects required object and decode failures", async () => {
    const failedGet = virtualBucket([
      { key: usageSegmentKey("bad-get", 0), getError: true },
    ]);
    await expect(getUsageEventsFromR2(failedGet.bucket, "bad-get"))
      .rejects.toThrow("required GET failed");

    const corruptBody = virtualBucket([
      { key: usageSegmentKey("bad-get", 0), body: malformedGzip() },
    ]);
    await expect(getUsageEventsFromR2(corruptBody.bucket, "bad-get"))
      .rejects.toThrow();

    const invalidGzip = virtualBucket([
      { key: usageSegmentKey("bad-decode", 0), body: malformedGzip() },
    ]);
    await expect(getUsageEventsFromR2(invalidGzip.bucket, "bad-decode"))
      .rejects.toThrow();
  });

  test("normalizes NaN maxEvents to the default cap", async () => {
    const segments: VirtualSegment[] = [
      {
        key: usageSegmentKey("nan-cap", 0),
        body: await encodedEvents(Array.from({ length: 10_001 }, (_, i) => event(i))),
      },
      { key: usageSegmentKey("nan-cap", 1), body: malformedGzip() },
    ];
    const fixture = virtualBucket(segments, 2, false);

    const result = await getUsageEventsFromR2(
      fixture.bucket,
      "nan-cap",
      { maxEvents: Number.NaN },
    );
    expect(result).toHaveLength(10_000);
    expect(result[9_999]).toEqual(event(9_999));
    expect(fixture.getKeys).toEqual([usageSegmentKey("nan-cap", 0)]);
  });

  test("preserves lower, upper, and fractional maxEvents behavior", async () => {
    const lowFixture = virtualBucket([
      { key: usageSegmentKey("low-cap", 0), body: await encodedEvents([event(0), event(1)]) },
      { key: usageSegmentKey("low-cap", 1), body: malformedGzip() },
    ]);
    await expect(getUsageEventsFromR2(lowFixture.bucket, "low-cap", { maxEvents: 0 }))
      .resolves.toEqual([event(0)]);
    expect(lowFixture.getKeys).toEqual([usageSegmentKey("low-cap", 0)]);

    const fractionalFixture = virtualBucket([
      { key: usageSegmentKey("fraction-cap", 0), body: await encodedEvents([event(0), event(1), event(2)]) },
    ]);
    await expect(getUsageEventsFromR2(
      fractionalFixture.bucket,
      "fraction-cap",
      { maxEvents: 1.2 },
    )).resolves.toEqual([event(0), event(1)]);

    const upperFixture = virtualBucket([
      {
        key: usageSegmentKey("upper-cap", 0),
        body: await encodedEvents(Array.from({ length: 100_001 }, (_, i) => event(i))),
      },
    ]);
    const upperResult = await getUsageEventsFromR2(
      upperFixture.bucket,
      "upper-cap",
      { maxEvents: 200_000 },
    );
    expect(upperResult).toHaveLength(100_000);
    expect(upperResult[99_999]).toEqual(event(99_999));
  });

  test("rejects a truncated listing without a usable next cursor", async () => {
    const brokenListing = {
      async list() {
        return {
          objects: [],
          truncated: true,
          delimitedPrefixes: [],
        };
      },
    } as unknown as ObjectStoreBinding;
    await expect(getUsageEventsFromR2(brokenListing, "bad-cursor"))
      .rejects.toThrow("invalid pagination cursor");

    const repeatedCursor = {
      async list() {
        return {
          objects: [],
          truncated: true,
          cursor: "repeated",
          delimitedPrefixes: [],
        };
      },
    } as unknown as ObjectStoreBinding;
    await expect(getUsageEventsFromR2(repeatedCursor, "repeated-cursor"))
      .rejects.toThrow("invalid pagination cursor");
  });
});
