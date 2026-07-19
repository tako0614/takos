import { afterEach, test } from "bun:test";
import { assert, assertEquals, assertRejects } from "@takos/test/assert";
import { stub } from "@takos/test/mock";

import { mcpServers, publications } from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import { McpClient } from "../mcp-client.ts";
import { loadMcpTools } from "../mcp-tools.ts";
import { OPERATOR_CONTROL_MCP_FIXTURE } from "./fixtures/operator-control-mcp.ts";

const stubs: Array<{ restore(): void }> = [];

afterEach(() => {
  while (stubs.length > 0) stubs.pop()!.restore();
});

function rowTable(rows: readonly Record<string, unknown>[]) {
  return {
    where: () => ({
      orderBy: () => ({ all: async () => rows }),
      all: async () => rows,
      get: async () => rows[0] ?? null,
    }),
    orderBy: () => ({ all: async () => rows }),
    all: async () => rows,
    get: async () => rows[0] ?? null,
  };
}

function readOnlyMcpDb() {
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === mcpServers || table === publications) return rowTable([]);
        return rowTable([]);
      },
    }),
    insert: () => {
      throw new Error("Interface-backed MCP discovery must not persist tokens");
    },
    update: () => {
      throw new Error("Interface-backed MCP discovery must not persist tokens");
    },
    delete: () => {
      throw new Error("Interface-backed MCP discovery must not persist tokens");
    },
  } as never;
}

function runtimeInterface(
  id: string,
  name: string,
  endpoint: string,
  materializedFrom: "capsule_blueprint" | "capsule_resource",
  spec: typeof OPERATOR_CONTROL_MCP_FIXTURE.interfaceBlueprint.spec,
) {
  const timestamp = "2026-07-19T00:00:00.000Z";
  return {
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "Interface",
    metadata: {
      id,
      workspaceId: "workspace-1",
      name,
      ownerRef: { kind: "Capsule", id: "capsule-1" },
      generation: 1,
      labels: {},
      materializedFrom:
        materializedFrom === "capsule_blueprint"
          ? { source: materializedFrom, key: "operator-control-mcp-v1" }
          : { source: materializedFrom },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    spec: {
      ...spec,
      inputs: {
        endpoint: {
          ...spec.inputs.endpoint,
          capsuleId: "capsule-1",
        },
      },
    },
    status: {
      phase: "Resolved",
      observedGeneration: 1,
      resolvedRevision: 2,
      resolvedInputs: { endpoint },
      provenance: {},
      conditions: [],
    },
  };
}

function runtimeBinding(
  interfaceId: string,
  bindingId: string,
  observedInterfaceRevision = 2,
) {
  const proposal = OPERATOR_CONTROL_MCP_FIXTURE.interfaceBlueprint.bindings[0];
  const timestamp = "2026-07-19T00:00:00.000Z";
  return {
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "InterfaceBinding",
    metadata: {
      id: bindingId,
      workspaceId: "workspace-1",
      generation: 1,
      materializedFrom: {
        source: "capsule_blueprint",
        interfaceKey: OPERATOR_CONTROL_MCP_FIXTURE.interfaceBlueprint.key,
        key: proposal.key,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    spec: {
      interfaceId,
      subjectRef: { kind: "Principal", id: "pairwise-user" },
      permissions: proposal.permissions,
      delivery: proposal.delivery,
    },
    status: {
      phase: "Ready",
      observedInterfaceRevision,
      conditions: [],
    },
  };
}

function controlFetch(input: {
  interfaces: readonly ReturnType<typeof runtimeInterface>[];
  revoked?: () => boolean;
  issuedTokens: string[];
}) {
  return async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(request.toString());
    const authorization = new Headers(init?.headers).get("authorization");
    assertEquals(authorization, "Bearer delegated-accounts-token");
    if (url.pathname.endsWith("/token")) {
      const token = `interface-token-${input.issuedTokens.length + 1}`;
      input.issuedTokens.push(token);
      return Response.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 60,
        expires_at: new Date(Date.now() + 55_000).toISOString(),
        scope: "mcp.invoke",
        resource: input.interfaces.find((iface) =>
          url.pathname.includes(iface.metadata.id),
        )?.status.resolvedInputs.endpoint,
      });
    }
    if (url.pathname.endsWith("/bindings")) {
      const iface = input.interfaces.find((candidate) =>
        url.pathname.includes(candidate.metadata.id),
      );
      return Response.json({
        bindings:
          !iface || input.revoked?.()
            ? []
            : [
                runtimeBinding(
                  iface.metadata.id,
                  `ifb-${iface.metadata.id}`,
                  iface.status.resolvedRevision,
                ),
              ],
      });
    }
    if (url.pathname.endsWith("/v1/interfaces")) {
      return Response.json({
        interfaces: input.revoked?.() ? [] : input.interfaces,
      });
    }
    return new Response(null, { status: 404 });
  };
}

function stubMcp(toolName = OPERATOR_CONTROL_MCP_FIXTURE.toolsList[0].name) {
  stubs.push(stub(McpClient.prototype as never, "connect", async () => {}));
  stubs.push(
    stub(McpClient.prototype as never, "listTools", async () => [
      {
        sdkTool: {
          name: toolName,
          description: "Operate through the declared Interface",
          inputSchema: { type: "object", properties: {} },
        },
        definition: {
          name: toolName,
          description: "Operate through the declared Interface",
          category: "mcp",
          parameters: { type: "object", properties: {} },
        },
      },
    ]),
  );
  stubs.push(
    stub(
      McpClient.prototype as never,
      "callTool",
      async () => "interface-call-ok",
    ),
  );
  stubs.push(stub(McpClient.prototype as never, "close", async () => {}));
}

function toolContext(env: Env) {
  return {
    spaceId: "local-space",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    role: "owner" as const,
    capabilities: [],
    env,
    db: env.DB,
  };
}

test("operator control MCP blueprint and capsule_resource declarations reach the agent catalog", async () => {
  stubMcp();
  assertEquals(
    OPERATOR_CONTROL_MCP_FIXTURE.interfaceBlueprint.spec,
    OPERATOR_CONTROL_MCP_FIXTURE.moduleInterface.spec,
  );
  assertEquals(
    OPERATOR_CONTROL_MCP_FIXTURE.interfaceBlueprint.bindings[0].permissions,
    ["mcp.invoke"],
  );
  const interfaces = [
    runtimeInterface(
      "if-blueprint",
      OPERATOR_CONTROL_MCP_FIXTURE.interfaceBlueprint.name,
      OPERATOR_CONTROL_MCP_FIXTURE.output.value,
      "capsule_blueprint",
      OPERATOR_CONTROL_MCP_FIXTURE.interfaceBlueprint.spec,
    ),
    runtimeInterface(
      "if-resource",
      OPERATOR_CONTROL_MCP_FIXTURE.moduleInterface.name,
      "https://control-resource.example/mcp",
      "capsule_resource",
      OPERATOR_CONTROL_MCP_FIXTURE.moduleInterface.spec,
    ),
  ];
  const issuedTokens: string[] = [];
  const db = readOnlyMcpDb();
  const env = {
    DB: db,
    ENCRYPTION_KEY: "test-key",
    ENVIRONMENT: "development",
  } as unknown as Env;
  const result = await loadMcpTools(
    db,
    "local-space",
    env,
    new Set(),
    { role: "owner", capabilities: [] },
    {
      workspaceId: "workspace-1",
      request: {
        baseUrl: "https://app.takosumi.test",
        token: "delegated-accounts-token",
        subjectId: "pairwise-user",
        fetch: controlFetch({ interfaces, issuedTokens }),
      },
    },
  );

  assertEquals(result.failedServers, []);
  assertEquals(result.tools.size, 2);
  assertEquals(
    Array.from(result.tools.values()).every((tool) =>
      tool.definition.name.includes("capsule_plan"),
    ),
    true,
  );
  assertEquals(issuedTokens.length, 2);
  const tool = result.tools.values().next().value;
  assert(tool);
  assertEquals(await tool.handler({}, toolContext(env)), "interface-call-ok");
  // Catalog discovery and invocation each receive fresh, call-local tokens.
  assertEquals(issuedTokens.length, 3);
});

test("Interface revocation after tools/list fails closed before tools/call", async () => {
  stubMcp();
  const interfaces = [
    runtimeInterface(
      "if-control",
      "control-mcp",
      "https://control.example/mcp",
      "capsule_resource",
      OPERATOR_CONTROL_MCP_FIXTURE.moduleInterface.spec,
    ),
  ];
  let revoked = false;
  const issuedTokens: string[] = [];
  const db = readOnlyMcpDb();
  const env = {
    DB: db,
    ENCRYPTION_KEY: "test-key",
    ENVIRONMENT: "development",
  } as unknown as Env;
  const result = await loadMcpTools(
    db,
    "local-space",
    env,
    new Set(),
    { role: "owner", capabilities: [] },
    {
      workspaceId: "workspace-1",
      request: {
        baseUrl: "https://app.takosumi.test",
        token: "delegated-accounts-token",
        subjectId: "pairwise-user",
        fetch: controlFetch({
          interfaces,
          revoked: () => revoked,
          issuedTokens,
        }),
      },
    },
  );
  assertEquals(result.failedServers, []);
  assertEquals(issuedTokens.length, 1);
  assertEquals(result.tools.size, 1);
  const tool = result.tools.values().next().value;
  assert(tool);
  revoked = true;
  await assertRejects(
    () => tool.handler({}, toolContext(env)),
    Error,
    "is no longer authorized at its catalog revision",
  );
  assertEquals(issuedTokens.length, 1);
});

test("Interface revision change after tools/list fails closed with a current Ready binding", async () => {
  stubMcp();
  const interfaces = [
    runtimeInterface(
      "if-control",
      "control-mcp",
      "https://control.example/mcp",
      "capsule_resource",
      OPERATOR_CONTROL_MCP_FIXTURE.moduleInterface.spec,
    ),
  ];
  const issuedTokens: string[] = [];
  const db = readOnlyMcpDb();
  const env = {
    DB: db,
    ENCRYPTION_KEY: "test-key",
    ENVIRONMENT: "development",
  } as unknown as Env;
  const result = await loadMcpTools(
    db,
    "local-space",
    env,
    new Set(),
    { role: "owner", capabilities: [] },
    {
      workspaceId: "workspace-1",
      request: {
        baseUrl: "https://app.takosumi.test",
        token: "delegated-accounts-token",
        subjectId: "pairwise-user",
        fetch: controlFetch({ interfaces, issuedTokens }),
      },
    },
  );
  assertEquals(result.failedServers, []);
  assertEquals(issuedTokens.length, 1);
  const tool = result.tools.values().next().value;
  assert(tool);

  // The live Binding is still Ready and observes revision 3, but the tool
  // catalog was reviewed at revision 2 and therefore cannot be invoked.
  interfaces[0]!.status.resolvedRevision = 3;
  await assertRejects(
    () => tool.handler({}, toolContext(env)),
    Error,
    "is no longer authorized at its catalog revision",
  );
  assertEquals(issuedTokens.length, 1);
});
