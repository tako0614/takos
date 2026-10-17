import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { gzipCompressString } from "../../shared/utils/gzip.ts";
import {
  addUsageEvents, decodeUsageSegment, newUsageLedgerBuild,
  parseUsageLedgerState, usageSegmentIndex,
} from "./run-usage-ledger.ts";

const RUN_ID = "usage-ledger-test";
const event = (meter_type: string, units: number) => ({
  meter_type, units, created_at: "2026-10-01T00:00:00.000Z",
});

test("ledger parser constrains phase, totals, revision and bounded cursor", () => {
  const building = newUsageLedgerBuild(2, 1, null, null);
  expect(parseUsageLedgerState(building)).toEqual(building);
  expect(() => parseUsageLedgerState({ ...building, totals: { unknown: 1 } })).toThrow();
  expect(() => parseUsageLedgerState({ ...building,
    build: { ...building.build!, cursor: "x".repeat(2049) } })).toThrow();
  expect(() => parseUsageLedgerState({ ...building,
    phase: "ready", build: null, revision: 1, projectedRevision: 2 })).toThrow();
});

test("archived usage accepts future meter tokens but rejects malformed events and overflow", async () => {
  const encoded = await gzipCompressString(`${JSON.stringify(event("exec_seconds", 4))}\n${
    JSON.stringify(event("future_meter", 999))}\n`);
  expect(addUsageEvents({}, await decodeUsageSegment(encoded))).toEqual({ exec_seconds: 4 });
  expect(() => addUsageEvents({ exec_seconds: Number.MAX_VALUE }, [event("exec_seconds", Number.MAX_VALUE)])).toThrow();
  expect(() => addUsageEvents({ exec_seconds: 1e15 }, [event("exec_seconds", 0.001)])).toThrow();
  expect(() => addUsageEvents({ exec_seconds: 0.001 }, [event("exec_seconds", 1e15)])).toThrow();
  expect(() => addUsageEvents({}, [{ ...event("exec_seconds", 1), extra: true } as never])).toThrow();
  await expect(decodeUsageSegment(await gzipCompressString("{}\n"))).rejects.toThrow();
  await expect(decodeUsageSegment(new TextEncoder().encode("not gzip").buffer)).rejects.toThrow();
  const invalidUtf8 = gzipSync(new Uint8Array([
    ...new TextEncoder().encode('{"meter_type":"exec_seconds","units":1,"created_at":"2026-10-01T00:00:00.000Z","metadata":"'),
    0x80,
    ...new TextEncoder().encode('"}\n'),
  ]));
  await expect(decodeUsageSegment(invalidUtf8.buffer.slice(
    invalidUtf8.byteOffset, invalidUtf8.byteOffset + invalidUtf8.byteLength,
  ))).rejects.toThrow();
});

test("canonical segment decoder supports the six-digit rollover", () => {
  expect(usageSegmentIndex(`runs/${RUN_ID}/usage/1000000.jsonl.gz`, RUN_ID)).toBe(1_000_000);
  expect(() => usageSegmentIndex(`runs/${RUN_ID}/usage/000000.jsonl.gz`, RUN_ID)).toThrow();
  expect(() => usageSegmentIndex(`runs/${RUN_ID}/usage/01.jsonl.gz`, RUN_ID)).toThrow();
  expect(() => usageSegmentIndex(`runs/${RUN_ID}/usage/000001.jsonl.gz.backup`, RUN_ID)).toThrow();
});
