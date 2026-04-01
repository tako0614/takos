import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

import { assertEquals } from "jsr:@std/assert";

import { loadMcpTools } from "@/tools/mcp-tools";

type McpRow = {
  id: string;
  name: string;
  url: string;
  sourceType: string;
  authMode: string;
  serviceId: string | null;
  bundleDeploymentId: string | null;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthIssuerUrl: string | null;
  oauthTokenExpiresAt: string | Date | null;
};

function createFakeD1(rows: McpRow[], shouldThrow = false) {
  return {
    prepare() {
      if (shouldThrow) {
        throw new Error("db failed");
      }

      return {
        bind() {
          return {
            all: async () => ({ results: rows }),
            first: async () => rows[0] ?? null,
            run: async () => ({
              success: true,
              meta: { changes: 0, last_row_id: 0, duration: 0 },
            }),
            raw: async () => rows.map((row) => Object.values(row)),
          };
        },
      };
    },
  } as unknown as D1Database;
}

const MANAGED_SERVER: McpRow = {
  id: "managed-1",
  name: "managed",
  url: "https://managed.example.com/mcp",
  sourceType: "managed",
  authMode: "none",
  serviceId: "worker-1",
  bundleDeploymentId: null,
  oauthAccessToken: null,
  oauthRefreshToken: null,
  oauthIssuerUrl: null,
  oauthTokenExpiresAt: null,
};

const EXTERNAL_SERVER: McpRow = {
  id: "external-1",
  name: "external",
  url: "https://external.example.com/mcp",
  sourceType: "external",
  authMode: "oauth",
  serviceId: null,
  bundleDeploymentId: null,
  oauthAccessToken: "encrypted-token",
  oauthRefreshToken: "encrypted-refresh",
  oauthIssuerUrl: "https://issuer.example.com",
  oauthTokenExpiresAt: null,
};

Deno.test("loadMcpTools exposure filtering - does not connect to MCP servers for viewer runs", async () => {
  const db = createFakeD1([MANAGED_SERVER, EXTERNAL_SERVER]);
  const result = await loadMcpTools(
    db,
    "ws-1",
    {} as Env,
    new Set(),
    { role: "viewer", capabilities: ["repo.read", "storage.read"] },
  );

  assertEquals(result.tools.size, 0);
  assertEquals(result.clients.size, 0);
  assertEquals(result.failedServers, []);
});

Deno.test("loadMcpTools exposure filtering - skips external MCP servers when the run lacks egress capability", async () => {
  const db = createFakeD1([EXTERNAL_SERVER]);
  const result = await loadMcpTools(
    db,
    "ws-1",
    {} as Env,
    new Set(),
    {
      role: "editor",
      capabilities: [
        "repo.read",
        "repo.write",
        "storage.read",
        "storage.write",
      ],
    },
  );

  assertEquals(result.tools.size, 0);
  assertEquals(result.clients.size, 0);
  assertEquals(result.failedServers, []);
});
