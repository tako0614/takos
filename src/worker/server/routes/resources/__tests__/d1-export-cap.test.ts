import { test } from "bun:test";
import { assertEquals, assertStringIncludes } from "@takos/test/assert";
import { isAppError } from "@takos/worker-platform-utils/errors";

import {
  D1_EXPORT_AGGREGATE_ROW_LIMIT,
  D1_EXPORT_ROW_LIMIT,
  enforceExportAggregateRowLimit,
  enforceExportRowLimit,
} from "../d1.ts";

test("enforceExportRowLimit returns rows within the export cap", () => {
  const rows = [{ id: 1 }, { id: 2 }];
  assertEquals(enforceExportRowLimit("items", rows, 2), rows);
});

test("enforceExportRowLimit throws HTTP 413 above the export cap", () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  try {
    enforceExportRowLimit("items", rows, 2);
    throw new Error("expected enforceExportRowLimit to throw");
  } catch (error) {
    if (!isAppError(error)) throw error;
    assertEquals(error.statusCode, 413);
    assertEquals(error.code, "PAYLOAD_TOO_LARGE");
    assertEquals(error.details, { table: "items", limit: 2 });
    assertStringIncludes(error.message, "cursor pagination");
  }
});

test("D1_EXPORT_ROW_LIMIT is capped at 100k rows per table", () => {
  assertEquals(D1_EXPORT_ROW_LIMIT, 100_000);
});

test(
  "D1_EXPORT_AGGREGATE_ROW_LIMIT bounds total rows across tables",
  () => {
    assertEquals(D1_EXPORT_AGGREGATE_ROW_LIMIT, 500_000);
  },
);

test(
  "enforceExportAggregateRowLimit is a no-op at or below the aggregate cap",
  () => {
    // running totals within the cap should not throw
    enforceExportAggregateRowLimit(0, 10);
    enforceExportAggregateRowLimit(5, 10);
    enforceExportAggregateRowLimit(10, 10);
  },
);

test(
  "enforceExportAggregateRowLimit throws HTTP 413 above the aggregate cap",
  () => {
    try {
      enforceExportAggregateRowLimit(11, 10);
      throw new Error("expected enforceExportAggregateRowLimit to throw");
    } catch (error) {
      if (!isAppError(error)) throw error;
      assertEquals(error.statusCode, 413);
      assertEquals(error.code, "PAYLOAD_TOO_LARGE");
      assertEquals(error.details, { aggregateLimit: 10, aggregateRows: 11 });
      assertStringIncludes(error.message, "export aggregate rows exceeded");
      assertStringIncludes(error.message, "paginate per-table");
    }
  },
);

test(
  "enforceExportAggregateRowLimit fails fast when summing across tables",
  () => {
    // Simulate the running-count loop in exportHandler: per-table caps are
    // each respected (4 rows per table, cap 5), but the running aggregate
    // (12) crosses the cross-table cap (10) on the third table — the loop
    // should abort before materializing additional results.
    const perTable = [4, 4, 4];
    const aggregateLimit = 10;
    let aggregate = 0;
    let processed = 0;
    try {
      for (const n of perTable) {
        aggregate += n;
        enforceExportAggregateRowLimit(aggregate, aggregateLimit);
        processed += 1;
      }
      throw new Error("expected aggregate cap to trip");
    } catch (error) {
      if (!isAppError(error)) throw error;
      assertEquals(error.statusCode, 413);
      assertEquals(error.code, "PAYLOAD_TOO_LARGE");
      // First two tables passed; the third tripped the cap before being
      // counted as processed.
      assertEquals(processed, 2);
    }
  },
);
