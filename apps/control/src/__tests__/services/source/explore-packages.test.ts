import { assertEquals } from "jsr:@std/assert";

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  getPackageRatingStats,
  getPackageRatingSummary,
} from "@/services/source/explore-packages";

Deno.test("getPackageRatingStats - returns default stats for all repo IDs", async () => {
  const result = await getPackageRatingStats({} as any, ["repo-1", "repo-2"]);

  assertEquals(result.size, 2);
  assertEquals(result.get("repo-1"), { rating_avg: null, rating_count: 0 });
  assertEquals(result.get("repo-2"), { rating_avg: null, rating_count: 0 });
});
Deno.test("getPackageRatingStats - returns empty map for empty input", async () => {
  const result = await getPackageRatingStats({} as any, []);
  assertEquals(result.size, 0);
});

Deno.test("getPackageRatingSummary - returns default summary", async () => {
  const result = await getPackageRatingSummary({} as any, "repo-1");
  assertEquals(result, { rating_avg: null, rating_count: 0 });
});
