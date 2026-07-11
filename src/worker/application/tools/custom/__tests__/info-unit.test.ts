import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { ToolContext } from "../../tool-definitions.ts";
import { infoUnitSearchHandler } from "../info-unit.ts";

test("info_unit_search filters Vectorize with the writer's Workspace metadata key", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE info_units (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      thread_id TEXT,
      run_id TEXT,
      session_id TEXT,
      kind TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      segment_index INTEGER NOT NULL DEFAULT 0,
      segment_count INTEGER NOT NULL DEFAULT 1,
      vector_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO info_units
      (id, account_id, run_id, kind, content)
      VALUES ('unit_a', 'space_a', 'run_a', 'session', 'durable answer');
  `);
  const db = drizzle(client, { schema });
  let observedFilter: Record<string, unknown> | undefined;
  try {
    const output = await infoUnitSearchHandler({ query: "durable answer" }, {
      spaceId: "space_a",
      db,
      env: {
        AI: {
          run: async () => ({ data: [[0.1, 0.2]] }),
        },
        VECTORIZE: {
          query: async (
            _vector: number[],
            options: Record<string, unknown>,
          ) => {
            observedFilter = options.filter as Record<string, unknown>;
            return {
              matches: [
                {
                  score: 0.9,
                  metadata: {
                    kind: "info_unit",
                    spaceId: "space_a",
                    runId: "run_a",
                    content: "durable answer",
                  },
                },
              ],
            };
          },
        },
      },
    } as unknown as ToolContext);

    expect(observedFilter).toEqual({
      spaceId: "space_a",
      kind: "info_unit",
    });
    expect(output).toContain("durable answer");
    expect(output.match(/durable answer/g)).toHaveLength(1);
  } finally {
    client.close();
  }
});
