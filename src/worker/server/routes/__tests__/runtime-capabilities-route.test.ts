import { describe, expect, test } from "bun:test";

import type { Env } from "../../../shared/types/index.ts";
import runtime from "../runtime.ts";

function envWith(overrides: Partial<Env>): Env {
  return overrides as Env;
}

describe("GET /api/runtime/capabilities", () => {
  test("reports the full mode when the index and executor are bound", async () => {
    const response = await runtime.request(
      "/capabilities",
      {},
      envWith({
        AI: { run: async () => undefined },
        VECTORIZE: {
          query: async () => ({ matches: [] }),
          insert: async () => undefined,
          upsert: async () => undefined,
          deleteByIds: async () => undefined,
        },
        EXECUTOR_CONTAINER: {
          idFromName: () => ({}),
          get: () => ({ fetch: async () => new Response("ok") }),
        },
      } as Partial<Env>),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      capabilities: {
        vectorSearch: "vectorize",
        agentContainers: "cloudflare-containers",
      },
    });
  });

  test("reports the reduced mode an ordinary production apply leaves behind", async () => {
    // No Vectorize index and no Container application: exactly what the
    // Cloudflare provider can express today.
    const response = await runtime.request("/capabilities", {}, envWith({}));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      capabilities: { vectorSearch: "disabled", agentContainers: "disabled" },
    });
  });
});
