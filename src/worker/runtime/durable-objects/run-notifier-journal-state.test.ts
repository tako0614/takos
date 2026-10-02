import { expect, test } from "bun:test";
import { newRunArchiveState } from "./run-archive-maintenance.ts";
import { parseRunNotifierJournalState } from "./run-notifier-journal-state.ts";

function snapshot(version: number): Record<string, unknown> {
  return {
    schemaVersion: version,
    eventBuffer: [], eventIdCounter: 0, runId: "usage-state-run",
    r2SegmentIndex: 1, r2SegmentBuffer: [], r2LastFlushedSegmentIndex: 0,
    usageSegmentIndex: 1, usageSegmentBuffer: [], usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: [], flushIntents: [], emitReceipts: [], usageReceipts: [],
    legacyPendingRunCount: 0, legacyPendingUsageCount: 0,
    ...(version >= 3 ? { archive: version === 4 ? null : newRunArchiveState() } : {}),
    ...(version === 4 ? { usageLedger: null } : {}),
  };
}

const readyLedger = () => ({ phase: "ready" as const, totals: { embedding_count: 9 },
  revision: 4, projectedRevision: 2, build: null, error: null });

const buildingLedger = () => ({ phase: "building" as const, totals: {}, revision: 0,
  projectedRevision: 0, error: null, build: {
    frontier: 0, pendingCount: 0, intentKey: null, intentDigest: null,
    stage: "inventory" as const, cursor: null, lastKey: null, scanned: 0, nextIndex: 1,
  } });

test("legacy journals do not manufacture an accepted usage baseline", () => {
  for (const version of [2, 3]) {
    expect(parseRunNotifierJournalState(snapshot(version))?.usageLedger).toBeNull();
  }
  const legacy = snapshot(2);
  for (const key of ["schemaVersion", "flushIntents", "emitReceipts", "usageReceipts",
    "legacyPendingRunCount", "legacyPendingUsageCount"]) delete legacy[key];
  expect(parseRunNotifierJournalState(legacy)?.usageLedger).toBeNull();
});

test("schema4 explicitly represents an unqualified ledger and optional archive", () => {
  const current = snapshot(4);
  expect(parseRunNotifierJournalState(current)).toMatchObject({
    runId: "usage-state-run", archive: null, usageLedger: null,
  });
  expect(parseRunNotifierJournalState({ ...current, archive: newRunArchiveState() })?.archive)
    .toEqual(newRunArchiveState());
});

test("schema4 cannot omit a ledger or archive field or add an unknown field", () => {
  for (const key of ["usageLedger", "archive"]) {
    const current = snapshot(4);
    delete current[key];
    expect(() => parseRunNotifierJournalState(current)).toThrow(/snapshot.fields/);
  }
  expect(() => parseRunNotifierJournalState({ ...snapshot(4), tenantOwners: [] }))
    .toThrow(/snapshot.fields/);
});

test("old logical schemas cannot carry or silently drop a newer ledger", () => {
  for (const version of [2, 3]) {
    expect(() => parseRunNotifierJournalState({ ...snapshot(version), usageLedger: null }))
      .toThrow(/snapshot.fields/);
  }
  expect(() => parseRunNotifierJournalState({ ...snapshot(4), schemaVersion: 5 }))
    .toThrow();
});

test("malformed schema4 ledger rejects the whole snapshot", () => {
  for (const usageLedger of [undefined, [], {}, "ready", { phase: "ready", totals: {} }]) {
    expect(() => parseRunNotifierJournalState({ ...snapshot(4), usageLedger }))
      .toThrow();
  }
});

test("accepted ledger requires its bound Run and a revision ACK cannot exceed acceptance", () => {
  expect(parseRunNotifierJournalState({ ...snapshot(4), usageLedger: readyLedger() })?.usageLedger)
    .toEqual(readyLedger());
  expect(() => parseRunNotifierJournalState({ ...snapshot(4), runId: null,
    usageLedger: readyLedger() })).toThrow(/usageLedger.runId/);
  for (const projectedRevision of [5, -1, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => parseRunNotifierJournalState({ ...snapshot(4), usageLedger: {
      ...readyLedger(), projectedRevision,
    } })).toThrow();
  }
});

test("building frontier and pending count must match the same journal head", () => {
  expect(parseRunNotifierJournalState({ ...snapshot(4), usageLedger: buildingLedger() })?.usageLedger)
    .toEqual(buildingLedger());
  for (const build of [
    { ...buildingLedger().build, frontier: 1 },
    { ...buildingLedger().build, pendingCount: 1 },
    { ...buildingLedger().build, lastKey: "runs/foreign/usage/000001.jsonl.gz" },
  ]) {
    expect(() => parseRunNotifierJournalState({ ...snapshot(4), usageLedger: {
      ...buildingLedger(), build,
    } })).toThrow();
  }
});

test("ready totals cannot omit accepted canonical pending usage", () => {
  const current = { ...snapshot(4), usageSegmentBuffer: [{
    meter_type: "embedding_count", units: 10, created_at: "2026-10-01T00:00:00.000Z",
  }] };
  expect(() => parseRunNotifierJournalState({ ...current, usageLedger: readyLedger() }))
    .toThrow(/usageLedger.pending total/);
  expect(parseRunNotifierJournalState({ ...current, usageLedger: {
    ...readyLedger(), totals: { embedding_count: 10 },
  } })?.usageLedger?.totals.embedding_count).toBe(10);
});
