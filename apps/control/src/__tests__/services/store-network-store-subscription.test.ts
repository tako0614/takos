import { assertEquals } from "jsr:@std/assert";
import { fetchRemoteFeedActivities } from "@/application/services/store-network/store-subscription.ts";
import type { RemoteFeedResult } from "@/application/services/store-network/remote-store-client.ts";

Deno.test("store subscription - fetches feed pages until total is covered", async () => {
  const requestedPages: number[] = [];

  const activities = await fetchRemoteFeedActivities(
    "https://store.example.com/api/public/stores/curated/feed",
    async (_feedUrl, options): Promise<RemoteFeedResult> => {
      requestedPages.push(options.page);
      const start = (options.page - 1) * options.limit;
      const remaining = Math.max(0, 75 - start);
      const count = Math.min(options.limit, remaining);
      return {
        id: `page-${options.page}`,
        type: "StoreFeed",
        totalItems: 75,
        activities: Array.from({ length: count }, (_, index) => ({
          activityId: `event-${start + index + 1}`,
          activityType: "repo.push",
          published: "2026-03-03T00:00:00.000Z",
          object: {
            id: `ref-${start + index + 1}`,
            name: "demo",
            summary: "",
            url: "https://repo.example.com/@alice/demo",
            repositoryUrl: "https://repo.example.com/@alice/demo",
            published: "2026-03-01T00:00:00.000Z",
            updated: "2026-03-02T00:00:00.000Z",
          },
        })),
      };
    },
  );

  assertEquals(requestedPages, [1, 2]);
  assertEquals(activities.length, 75);
  assertEquals(activities[0].activityId, "event-1");
  assertEquals(activities[74].activityId, "event-75");
});

Deno.test("store subscription - stops when a feed page is empty", async () => {
  const requestedPages: number[] = [];

  const activities = await fetchRemoteFeedActivities(
    "https://store.example.com/api/public/stores/curated/feed",
    async (_feedUrl, options): Promise<RemoteFeedResult> => {
      requestedPages.push(options.page);
      return {
        id: `page-${options.page}`,
        type: "StoreFeed",
        totalItems: 100,
        activities: options.page === 1
          ? [{
            activityId: "event-1",
            activityType: "inventory.add",
            published: "2026-03-03T00:00:00.000Z",
            object: {
              id: "ref-1",
              name: "demo",
              summary: "",
              url: "https://repo.example.com/@alice/demo",
              repositoryUrl: "https://repo.example.com/@alice/demo",
              published: "2026-03-01T00:00:00.000Z",
              updated: "2026-03-02T00:00:00.000Z",
            },
          }]
          : [],
      };
    },
  );

  assertEquals(requestedPages, [1, 2]);
  assertEquals(activities.map((activity) => activity.activityId), ["event-1"]);
});
