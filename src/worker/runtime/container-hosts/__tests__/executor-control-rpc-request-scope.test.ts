import { afterEach, test } from "bun:test";
import { assertEquals, assertFalse, assertStringIncludes } from "@takos/test/assert";
import { stub } from "@takos/test/mock";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as z from "zod/v4";
import { McpClient } from "../../../application/tools/mcp-client.ts";
import { workspaceSourceToolDeps } from "../../../application/tools/custom/space-source.ts";
import {
  buildPerRunCapabilityRegistry,
} from "../../../application/tools/executor-utils.ts";
import { ToolExecutor } from "../../../application/tools/executor.ts";
import {
  createToolResolver,
  type ToolResolverOptions,
} from "../../../application/tools/resolver.ts";
import type {
  ToolContext,
} from "../../../application/tools/tool-definitions.ts";
import type { Env } from "../../../shared/types/index.ts";
import { OPERATOR_CONTROL_MCP_FIXTURE } from "../../../application/tools/__tests__/fixtures/operator-control-mcp.ts";
import {
  accountMemberships,
  accounts,
} from "../../../infra/db/index.ts";
import {
  createRemoteToolExecutorDependencies,
  handleToolCatalog,
  handleToolCleanup,
  handleToolExecute,
  type RemoteToolExecutorDependencies,
} from "../executor-control-rpc.ts";

const stubs: Array<{ restore(): void }> = [];
const liveServers: Array<{ stop(closeActiveConnections?: boolean): void }> = [];

afterEach(() => {
  while (stubs.length > 0) stubs.pop()!.restore();
  while (liveServers.length > 0) liveServers.pop()!.stop(true);
});

async function createLiveOperatorControlMcpServer() {
  const calls: string[] = [];
  const installInputs: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.headers.get("authorization") !== "Bearer fresh-interface-token") {
        return Response.json({ error: "unauthenticated" }, { status: 401 });
      }
      const transport = new WebStandardStreamableHTTPServerTransport();
      const mcp = new McpServer({
        name: "takosumi-operator-control-live-proof",
        version: "1.0.0",
      });
      mcp.registerTool(
        "takosumi_install_plan_create",
        {
          description: "Create a durable Git install plan",
          inputSchema: {
            idempotencyKey: z.string(),
            source: z.object({
              name: z.string(),
              url: z.string(),
              ref: z.string().optional(),
              path: z.string().optional(),
            }),
            capsule: z.object({
              name: z.string(),
              environment: z.string(),
            }),
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
          },
        },
        async (input) => {
          calls.push("takosumi_install_plan_create");
          installInputs.push(input);
          return {
            content: [{ type: "text", text: "production-interface-call-ok" }],
          };
        },
      );
      await mcp.connect(transport);
      return await transport.handleRequest(request);
    },
  });
  liveServers.push(server);
  const directUrl = `http://${server.hostname}:${server.port}/mcp`;
  return {
    calls,
    installInputs,
    url: "https://operator-control.example.test/mcp",
    egress: {
      fetch(input: RequestInfo | URL, init?: RequestInit) {
        const incoming = new Request(input, init);
        return server.fetch(new Request(directUrl, incoming));
      },
    },
  };
}

function envWithBrokenDb(): Record<string, unknown> {
  return {
    DB: {
      prepare() {
        throw new Error("db unavailable");
      },
      batch() {
        throw new Error("db unavailable");
      },
      exec() {
        throw new Error("db unavailable");
      },
      dump() {
        throw new Error("db unavailable");
      },
    },
    TAKOS_OFFLOAD: undefined,
  };
}

type RowTable = {
  where(): RowTable;
  innerJoin(): RowTable;
  limit(): RowTable;
  orderBy(): RowTable;
  all(): Promise<readonly Record<string, unknown>[]>;
  get(): Promise<Record<string, unknown> | null>;
};

function rowTable(rows: readonly Record<string, unknown>[]): RowTable {
  const table: RowTable = {
    where: () => table,
    innerJoin: () => table,
    limit: () => table,
    orderBy: () => table,
    all: async () => rows,
    get: async () => rows[0] ?? null,
  };
  return table;
}

function readOnlyMcpDb() {
  return {
    select: () => ({
      from: () => rowTable([]),
    }),
    insert: () => {
      throw new Error("runtime Interface discovery must not persist state");
    },
    update: () => {
      throw new Error("runtime Interface discovery must not persist state");
    },
    delete: () => {
      throw new Error("runtime Interface discovery must not persist state");
    },
  } as never;
}

function productionFactoryMcpDb(userId: string) {
  const empty = rowTable([]);
  const account = rowTable([
    {
      id: userId,
      type: "user",
      status: "active",
      name: "Production owner",
      slug: userId,
      description: null,
      ownerAccountId: userId,
      securityPosture: "standard",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  ]);
  return {
    select: () => ({
      from: (table: unknown) =>
        table === accounts || table === accountMemberships ? account : empty,
    }),
    insert: () => {
      throw new Error("production MCP discovery must not insert domain rows");
    },
    update: () => ({
      set: () => ({
        where: async () => ({ meta: { changes: 1 } }),
      }),
    }),
    delete: () => ({
      where: async () => ({ meta: { changes: 1 } }),
    }),
    run: async () => ({ meta: { changes: 1 } }),
  } as never;
}

function runtimeInterface(
  revision: number,
  endpoint = OPERATOR_CONTROL_MCP_FIXTURE.output.value,
) {
  const timestamp = "2026-07-19T00:00:00.000Z";
  const spec = OPERATOR_CONTROL_MCP_FIXTURE.interfaceBlueprint.spec;
  return {
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "Interface",
    metadata: {
      id: "if-control",
      workspaceId: "workspace-1",
      name: "operator-control-mcp",
      ownerRef: { kind: "Capsule", id: "capsule-1" },
      generation: 1,
      labels: {},
      materializedFrom: {
        source: "capsule_blueprint",
        key: OPERATOR_CONTROL_MCP_FIXTURE.interfaceBlueprint.key,
      },
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
      resolvedRevision: revision,
      resolvedInputs: { endpoint },
      provenance: {},
      conditions: [],
    },
  };
}

function runtimeBinding(observedInterfaceRevision: number) {
  const proposal = OPERATOR_CONTROL_MCP_FIXTURE.interfaceBlueprint.bindings[0];
  const timestamp = "2026-07-19T00:00:00.000Z";
  return {
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "InterfaceBinding",
    metadata: {
      id: "ifb-control",
      workspaceId: "workspace-1",
      generation: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    spec: {
      interfaceId: "if-control",
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

test("tool catalog bootstrap failures do not leak request state", async () => {
  const runId = `run-broken-${crypto.randomUUID()}`;
  const env = envWithBrokenDb();

  const first = await handleToolCatalog({ runId }, env as never);
  const second = await handleToolCatalog({ runId }, env as never);

  assertFalse(first.ok, "expected error response from broken DB");
  assertFalse(second.ok, "a later request must fail independently");
});

test("tool catalog and execution use separate request-local executors", async () => {
  const signals: Array<AbortSignal | undefined> = [];
  const cleaned: string[] = [];
  let sequence = 0;
  const dependencies: RemoteToolExecutorDependencies = {
    async createExecutor(_runId, _env, signal) {
      sequence += 1;
      const id = `executor-${sequence}`;
      signals.push(signal);
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [{ name: id }] as never,
        execute: async (toolCall) => ({
          tool_call_id: toolCall.id,
          output: id,
        }),
        cleanup: () => {
          cleaned.push(id);
        },
      };
    },
  };

  const catalog = await handleToolCatalog(
    { runId: "run-request-local" },
    {} as never,
    dependencies,
  );
  const execution = await handleToolExecute(
    {
      runId: "run-request-local",
      toolCall: { id: "call-1", name: "example", arguments: {} },
    },
    {} as never,
    dependencies,
  );

  assertEquals(catalog.status, 200);
  assertEquals(execution.status, 200);
  assertEquals(await execution.json(), {
    tool_call_id: "call-1",
    output: "executor-2",
  });
  assertEquals(sequence, 2);
  assertEquals(signals[0], undefined);
  assertEquals(signals[1]?.aborted, true);
  assertEquals(cleaned, ["executor-1", "executor-2"]);
});

test("the same Run refreshes toolbox through a newly resolved MCP Interface", async () => {
  const db = readOnlyMcpDb();
  const state = { available: false, revision: 2 };
  const resolverSnapshots: Array<number | null> = [];
  const issuedTokens: string[] = [];
  const mcpCalls: string[] = [];
  let invalidateAfterBuild = false;

  const controlFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    assertEquals(
      new Headers(init?.headers).get("authorization"),
      "Bearer delegated-accounts-token",
    );
    if (url.pathname.endsWith("/token")) {
      const token = `interface-token-${issuedTokens.length + 1}`;
      issuedTokens.push(token);
      return Response.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 60,
        expires_at: new Date(Date.now() + 55_000).toISOString(),
        scope: "mcp.invoke",
        resource: OPERATOR_CONTROL_MCP_FIXTURE.output.value,
      });
    }
    if (url.pathname.endsWith("/bindings")) {
      return Response.json({
        bindings: state.available ? [runtimeBinding(state.revision)] : [],
      });
    }
    if (url.pathname.endsWith("/api/v1/interfaces")) {
      return Response.json({
        interfaces: state.available ? [runtimeInterface(state.revision)] : [],
      });
    }
    return new Response(null, { status: 404 });
  };

  stubs.push(stub(McpClient.prototype as never, "connect", async () => {}));
  stubs.push(
    stub(McpClient.prototype as never, "listTools", async () => [
      {
        sdkTool: OPERATOR_CONTROL_MCP_FIXTURE.toolsList[0],
        definition: {
          name: OPERATOR_CONTROL_MCP_FIXTURE.toolsList[0].name,
          description: OPERATOR_CONTROL_MCP_FIXTURE.toolsList[0].description,
          category: "mcp",
          parameters: OPERATOR_CONTROL_MCP_FIXTURE.toolsList[0].inputSchema,
        },
      },
    ]),
  );
  stubs.push(
    stub(
      McpClient.prototype as never,
      "callTool",
      async (name: string) => {
        mcpCalls.push(name);
        return "interface-call-ok";
      },
    ),
  );
  stubs.push(stub(McpClient.prototype as never, "close", async () => {}));

  const env = {
    DB: db,
    ENVIRONMENT: "development",
  } as unknown as Env;
  const resolverOptions: ToolResolverOptions = {
    runtimeMcpInterfaces: {
      workspaceId: "workspace-1",
      request: {
        baseUrl: "https://app.takosumi.test",
        token: "delegated-accounts-token",
        subjectId: "pairwise-user",
        fetch: controlFetch,
      },
    },
  };
  const dependencies: RemoteToolExecutorDependencies = {
    async createExecutor(_runId, workerEnv, signal) {
      resolverSnapshots.push(state.available ? state.revision : null);
      const resolver = await createToolResolver(
        db,
        "local-space",
        workerEnv,
        resolverOptions,
      );
      if (invalidateAfterBuild) {
        // The executor must retain the revision it catalogued and reject a
        // changed Interface rather than silently invoking a different server.
        state.revision += 1;
        invalidateAfterBuild = false;
      }
      const context: ToolContext = {
        spaceId: "local-space",
        threadId: "thread-1",
        runId: _runId,
        userId: "user-1",
        toolPolicyTier: "owner",
        capabilities: [],
        env: workerEnv,
        db,
        abortSignal: signal,
      };
      const executor = new ToolExecutor(resolver, context);
      context.capabilityRegistry = buildPerRunCapabilityRegistry(executor);
      (context as ToolContext & { _toolExecutor?: ToolExecutor })._toolExecutor =
        executor;
      return executor;
    },
  };
  const runId = "run-interface-refresh";
  const executeToolbox = async (
    id: string,
    arguments_: Record<string, unknown>,
  ) => {
    const response = await handleToolExecute(
      {
        runId,
        toolCall: { id, name: "toolbox", arguments: arguments_ },
      },
      env,
      dependencies,
    );
    assertEquals(response.status, 200);
    return (await response.json()) as {
      tool_call_id: string;
      output: string;
      error?: string;
    };
  };

  const initialCatalog = await handleToolCatalog(
    { runId },
    env,
    dependencies,
  );
  assertEquals(initialCatalog.status, 200);
  const initialCatalogBody = (await initialCatalog.json()) as {
    tools: Array<{ name: string }>;
  };
  assertEquals(
    initialCatalogBody.tools.some((tool) => tool.name === "capsule_plan"),
    false,
  );

  const beforeInterface = await executeToolbox("tool-before-interface", {
    action: "call",
    tool_name: "capsule_plan",
  });
  assertStringIncludes(
    beforeInterface.error ?? "",
    "not in the available tool catalog",
  );

  // The same Run now sees the newly materialized Interface on its next
  // request. Discovery remains progressive: the model still calls toolbox,
  // while the Worker refreshes the request-local resolver behind it.
  state.available = true;
  const search = await executeToolbox("tool-search-interface", {
    action: "search",
    query: "capsule_plan",
  });
  const searchPayload = JSON.parse(search.output) as {
    results: Array<{ name: string; id: string }>;
  };
  assertEquals(searchPayload.results.map((result) => result.name), [
    "capsule_plan",
  ]);
  assertEquals(searchPayload.results[0]?.id, "tool:capsule_plan");

  const describe = await executeToolbox("tool-describe-interface", {
    action: "describe",
    tool_name: "capsule_plan",
  });
  const describePayload = JSON.parse(describe.output) as {
    tools: Array<{ name: string; available: boolean }>;
  };
  assertEquals(describePayload.tools[0]?.name, "capsule_plan");
  assertEquals(describePayload.tools[0]?.available, true);
  assertEquals(
    (describePayload.tools[0] as Record<string, unknown>).family,
    "mcp.Takosumi_Control",
  );
  assertEquals(
    (describePayload.tools[0] as Record<string, unknown>).risk_level,
    "low",
  );
  assertEquals(
    (describePayload.tools[0] as Record<string, unknown>).parameters,
    { type: "object", properties: {} },
  );

  // A resolver may not carry a stale descriptor across the request boundary:
  // force a revision change after catalog construction and require the pinned
  // handler to fence before it reaches MCP.
  invalidateAfterBuild = true;
  const staleCall = await executeToolbox("tool-call-stale-interface", {
    action: "call",
    tool_name: "capsule_plan",
  });
  assertStringIncludes(
    staleCall.error ?? "",
    "no longer authorized at its catalog revision",
  );
  assertEquals(mcpCalls, []);

  const call = await executeToolbox("tool-call-current-interface", {
    action: "call",
    tool_name: "capsule_plan",
    arguments: {},
  });
  assertEquals(call.output, "interface-call-ok");
  assertEquals(mcpCalls, ["capsule_plan"]);
  assertEquals(resolverSnapshots, [null, null, 2, 2, 2, 3]);
  assertEquals(issuedTokens.length > 0, true);
});

test("production Run authority refreshes a newly resolved MCP Interface in the same Run", async () => {
  const liveMcp = await createLiveOperatorControlMcpServer();
  const state = { available: false, revision: 7 };
  const installTool = {
    name: "takosumi_install_plan_create",
    description: "Create a durable Git install plan",
    inputSchema: {
      type: "object",
      properties: {
        idempotencyKey: { type: "string" },
        source: { type: "object" },
        capsule: { type: "object" },
      },
      required: ["idempotencyKey", "source", "capsule"],
    },
  };
  const authorizationUsers: string[] = [];
  const controlRequests: string[] = [];
  const userId = "user-production-bridge";
  const runId = "run-production-interface-refresh";
  const db = productionFactoryMcpDb(userId);
  const originalCatalogList = workspaceSourceToolDeps.listCatalogItems;
  const originalTcsList = workspaceSourceToolDeps.listTcsStoreListings;
  workspaceSourceToolDeps.listCatalogItems = async () => ({
    items: [],
    total: 0,
    has_more: false,
  });
  workspaceSourceToolDeps.listTcsStoreListings = async () => ({
    warnings: [],
    items: [
      {
        id: "listing-takos-git",
        scope: "tako",
        slug: "takos-git",
        source: { git: "https://github.com/tako0614/takos-git" },
        suggestedName: "git",
        name: { ja: "Takos Git", en: "Takos Git" },
        description: { ja: "Git hosting", en: "Git hosting" },
        badge: { ja: "追加候補", en: "Installable" },
        category: "developer",
        tags: ["git", "source"],
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
        storeOrigin: "https://store.takosumi.com",
      },
    ],
  });
  stubs.push({
    restore() {
      workspaceSourceToolDeps.listCatalogItems = originalCatalogList;
      workspaceSourceToolDeps.listTcsStoreListings = originalTcsList;
    },
  });

  const controlFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    controlRequests.push(url.pathname);
    assertEquals(
      request.headers.get("authorization"),
      "Bearer delegated-production-token",
    );
    if (url.pathname.endsWith("/token")) {
      return Response.json({
        access_token: "fresh-interface-token",
        token_type: "Bearer",
        expires_in: 60,
        expires_at: new Date(Date.now() + 55_000).toISOString(),
        scope: "mcp.invoke",
        resource: liveMcp.url,
      });
    }
    if (url.pathname.endsWith("/bindings")) {
      return Response.json({
        bindings: state.available ? [runtimeBinding(state.revision)] : [],
      });
    }
    if (url.pathname.endsWith("/api/v1/interfaces")) {
      return Response.json({
        interfaces: state.available
          ? [runtimeInterface(state.revision, liveMcp.url)]
          : [],
      });
    }
    return new Response(null, { status: 404 });
  };

  const dependencies = createRemoteToolExecutorDependencies({
    getRunBootstrap: async (_env, requestedRunId) => {
      assertEquals(requestedRunId, runId);
      return {
        status: "running",
        spaceId: userId,
        threadId: "thread-production-bridge",
        userId,
        agentType: "default",
      };
    },
    accountsDelegatedAuthorization: async (input) => {
      authorizationUsers.push(input.userId);
      assertEquals(input.access, "read");
      return {
        accessToken: "delegated-production-token",
        workspaceId: "workspace-1",
        subjectId: "pairwise-user",
      };
    },
    fetch: controlFetch,
  });
  const env = {
    DB: db,
    ENVIRONMENT: "development",
    OIDC_ISSUER_URL: "https://app.takosumi.test",
    OIDC_CLIENT_ID: "toc_takos",
    ENCRYPTION_KEY: "test-encryption-key",
    TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://internal-app.takosumi.test",
    TAKOS_EGRESS: liveMcp.egress,
  } as unknown as Env;

  const initial = await handleToolCatalog({ runId }, env, dependencies);
  assertEquals(initial.status, 200);
  const discovery = await handleToolExecute(
    {
      runId,
      toolCall: {
        id: "production-store-search",
        name: "store_search",
        arguments: { query: "takos git", type: "deployable-app" },
      },
    },
    env,
    dependencies,
  );
  assertEquals(discovery.status, 200);
  const discoveryPayload = JSON.parse(
    (await discovery.json() as { output: string }).output,
  ) as {
    items: Array<{
      git_address: { url: string };
      install_defaults: { ref: string; path: string; suggested_name: string };
    }>;
  };
  const candidate = discoveryPayload.items[0]!;
  assertEquals(candidate.git_address.url, "https://github.com/tako0614/takos-git");
  state.available = true;

  const search = await handleToolExecute(
    {
      runId,
      idempotencyKey: "same-run-search",
      toolCall: {
        id: "production-search",
        name: "toolbox",
        arguments: { action: "search", query: installTool.name },
      },
    },
    env,
    dependencies,
  );
  assertEquals(search.status, 200);
  const searchResult = await search.json() as { output: string };
  assertStringIncludes(searchResult.output, installTool.name);

  const call = await handleToolExecute(
    {
      runId,
      idempotencyKey: "same-run-call",
      toolCall: {
        id: "production-call",
        name: "toolbox",
        arguments: {
          action: "call",
          tool_name: installTool.name,
          arguments: {
            idempotencyKey: "run-production-interface-refresh:takos-git",
            source: {
              name: `${candidate.install_defaults.suggested_name}-source`,
              url: candidate.git_address.url,
              ref: candidate.install_defaults.ref,
              path: candidate.install_defaults.path,
            },
            capsule: { name: "takos-git", environment: "production" },
          },
        },
      },
    },
    env,
    dependencies,
  );
  assertEquals(call.status, 200);
  assertEquals((await call.json() as { output: string }).output, "production-interface-call-ok");
  assertEquals(liveMcp.calls, [installTool.name]);
  assertEquals(liveMcp.installInputs, [
    {
      idempotencyKey: "run-production-interface-refresh:takos-git",
      source: {
        name: "git-source",
        url: "https://github.com/tako0614/takos-git",
        ref: "HEAD",
        path: ".",
      },
      capsule: { name: "takos-git", environment: "production" },
    },
  ]);
  assertEquals(authorizationUsers, [userId, userId, userId, userId]);
  assertEquals(controlRequests.includes("/api/v1/interfaces"), true);
  assertEquals(controlRequests.some((path) => path.endsWith("/token")), true);

  state.available = false;
  const revoked = await handleToolExecute(
    {
      runId,
      idempotencyKey: "same-run-revoked-call",
      toolCall: {
        id: "production-revoked-call",
        name: "toolbox",
        arguments: {
          action: "call",
          tool_name: installTool.name,
          arguments: {
            idempotencyKey: "run-production-interface-refresh:takos-git",
            source: {
              name: `${candidate.install_defaults.suggested_name}-source`,
              url: candidate.git_address.url,
              ref: candidate.install_defaults.ref,
              path: candidate.install_defaults.path,
            },
            capsule: { name: "takos-git", environment: "production" },
          },
        },
      },
    },
    env,
    dependencies,
  );
  assertEquals(revoked.status, 200);
  assertStringIncludes(
    (await revoked.json() as { error?: string }).error ?? "",
    "not in the available tool catalog",
  );
  assertEquals(liveMcp.calls, [installTool.name]);
});

test("tool catalog attests which side effects take the durable operation fence", async () => {
  const dependencies: RemoteToolExecutorDependencies = {
    async createExecutor() {
      return {
        mcpFailedServers: [],
        getAvailableTools: () =>
          [
            { name: "publish", side_effects: true },
            { name: "read", side_effects: false },
          ] as never,
        execute: async () => {
          throw new Error("not used");
        },
        cleanup() {},
      };
    },
  };

  const response = await handleToolCatalog(
    { runId: "run-catalog-fence" },
    {} as never,
    dependencies,
  );

  assertEquals(response.status, 200);
  const payload = await response.json() as {
    tools: Array<{ name: string; durable_idempotency: boolean }>;
  };
  assertEquals(payload.tools, [
    { name: "publish", side_effects: true, durable_idempotency: true },
    { name: "read", side_effects: false, durable_idempotency: false },
  ]);
});

test("every tool execution request gets an independent abort signal", async () => {
  const signals: AbortSignal[] = [];
  const dependencies: RemoteToolExecutorDependencies = {
    async createExecutor(_runId, _env, signal) {
      if (!signal) throw new Error("execution signal is required");
      signals.push(signal);
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [],
        execute: async (toolCall) => ({
          tool_call_id: toolCall.id,
          output: "ok",
        }),
        cleanup() {},
      };
    },
  };

  for (const id of ["call-1", "call-2"]) {
    const response = await handleToolExecute(
      {
        runId: "run-request-local",
        toolCall: { id, name: "example", arguments: {} },
      },
      {} as never,
      dependencies,
    );
    assertEquals(response.status, 200);
  }

  assertEquals(signals.length, 2);
  assertFalse(signals[0] === signals[1]);
  assertEquals(signals.every((signal) => signal.aborted), true);
});

test("tool execution forwards the engine idempotency key to the durable executor", async () => {
  let receivedKey: string | undefined;
  const dependencies: RemoteToolExecutorDependencies = {
    async createExecutor() {
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [],
        execute: async (toolCall, options) => {
          receivedKey = options?.idempotencyKey;
          return {
            tool_call_id: toolCall.id,
            output: "ok",
          };
        },
        cleanup() {},
      };
    },
  };

  const response = await handleToolExecute(
    {
      runId: "run-idempotent",
      idempotencyKey: "loop:loop-1:tool:1:0:publish",
      toolCall: { id: "call-1", name: "publish", arguments: { ref: "v1" } },
    },
    {} as never,
    dependencies,
  );

  assertEquals(response.status, 200);
  assertEquals(receivedKey, "loop:loop-1:tool:1:0:publish");
});

test("tool cleanup is an idempotent no-op for request-local executors", async () => {
  const response = await handleToolCleanup({ runId: "run-request-local" });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { success: true });
});

test("in-flight tool polling aborts the request-local executor after lease loss", async () => {
  const lease = {
    runId: `run-poll-${crypto.randomUUID()}`,
    serviceId: "service-current",
    leaseVersion: 5,
  };
  let leaseReads = 0;
  let cleanupCalls = 0;
  let executionSignal: AbortSignal | undefined;
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get() {
                  leaseReads += 1;
                  return Promise.resolve({
                    serviceId: lease.serviceId,
                    leaseVersion: lease.leaseVersion,
                    status: leaseReads >= 2 ? "cancelled" : "running",
                  });
                },
              };
            },
          };
        },
      };
    },
    insert() {},
    update() {},
    delete() {},
  };
  const dependencies: RemoteToolExecutorDependencies = {
    async createExecutor(_runId, _env, signal) {
      executionSignal = signal;
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [],
        execute: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
        cleanup: () => {
          cleanupCalls += 1;
        },
      } as never;
    },
  };

  const response = await Promise.race([
    handleToolExecute(
      {
        ...lease,
        toolCall: { id: "tool-1", name: "slow_mcp", arguments: {} },
      },
      {
        DB: db,
        TAKOS_AGENT_RUN_LEASE_POLL_INTERVAL_MS: "10",
      } as never,
      dependencies,
    ),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("lease polling timed out")), 500),
    ),
  ]);

  assertEquals(response.status, 409);
  assertEquals(leaseReads >= 2, true);
  assertEquals(executionSignal?.aborted, true);
  assertEquals(cleanupCalls, 1);
});
