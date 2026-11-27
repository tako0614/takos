import { strictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";
import {
  formatImportanceStars,
  formatLocalizedDate,
} from "../../lib/memory-format.ts";

test("formatImportanceStars - clamps out-of-range and non-finite importance values", () => {
  assertEquals(formatImportanceStars(0), "☆☆☆☆☆");
  assertEquals(formatImportanceStars(0.6), "★★★☆☆");
  assertEquals(formatImportanceStars(1), "★★★★★");
  assertEquals(formatImportanceStars(1.4), "★★★★★");
  assertEquals(formatImportanceStars(-0.5), "☆☆☆☆☆");
  assertEquals(formatImportanceStars(Number.NaN), "☆☆☆☆☆");
  assertEquals(formatImportanceStars(Number.POSITIVE_INFINITY), "☆☆☆☆☆");
});

test("formatLocalizedDate - formats using active language and rejects invalid dates", () => {
  const iso = "2026-11-26T12:00:00.000Z";
  assertEquals(
    formatLocalizedDate(iso, "ja"),
    new Date(iso).toLocaleDateString("ja-JP"),
  );
  assertEquals(
    formatLocalizedDate(iso, "en"),
    new Date(iso).toLocaleDateString("en-US"),
  );
  assertEquals(formatLocalizedDate("not-a-date", "ja"), "");
});
