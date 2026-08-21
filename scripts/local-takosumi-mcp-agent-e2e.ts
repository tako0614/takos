import { buildPerRunCapabilityRegistry } from "../src/worker/application/tools/executor-utils.ts";
import { ToolExecutor } from "../src/worker/application/tools/executor.ts";
import {
  createToolResolver,
  type ToolResolverOptions,
} from "../src/worker/application/tools/resolver.ts";
import type { ToolContext } from "../src/worker/application/tools/tool-definitions.ts";
import type { Env } from "../src/worker/shared/types/index.ts";
import {
  handleToolCatalog,
  handleToolExecute,
  type RemoteToolExecutorDependencies,
} from "../src/worker/runtime/container-hosts/executor-control-rpc.ts";

type JsonRecord = Record<string, unknown>;

const TERMINAL_RUN_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "waiting_approval",
]);
const DEFAULT_BASE_URL = "https://app.takosumi.test";
const OPERATOR_CONTROL_INSTALL_CONFIG_ID = "takosumi-operator-control-mcp-v1";
const OPERATOR_CONTROL_MODULE_PATH = "opentofu-modules/operator-control-mcp";
const OPERATOR_CONTROL_SOURCE_REF = "fdfc33a862beb587f84227fe9c87b50a99240ac0";
const LOCAL_PLATFORM_CLIENT_ID = "takosumi-platform-local";
const LOCAL_PLATFORM_REDIRECT_URI =
  "https://app.takosumi.test/__platform-introspection";
const TOOL_NAME = "takosumi_capsules_list";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as JsonRecord;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "TAKOSUMI_E2E_BASE_URL must be a credential-free HTTPS origin",
    );
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

async function responseJson(
  response: Response,
  label: string,
): Promise<JsonRecord> {
  const text = await response.text();
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON (${response.status})`);
  }
  const body = record(value, `${label} response`);
  if (!response.ok) {
    throw new Error(
      `${label} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function createControlClient(origin: string, sessionId: string) {
  return async function control(
    label: string,
    path: string,
    init: RequestInit = {},
  ): Promise<JsonRecord> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("authorization", `Bearer ${sessionId}`);
    if (init.body !== undefined)
      headers.set("content-type", "application/json");
    const response = await fetch(new URL(path, origin), {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    return await responseJson(response, label);
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function localPlatformClientSecret(): string {
  return requiredEnv("TAKOSUMI_E2E_PLATFORM_CLIENT_SECRET");
}

async function issueLocalRuntimePrincipalToken(
  origin: string,
  sessionId: string,
  workspaceId: string,
): Promise<string> {
  const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
    "-",
    "",
  );
  const challenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const authorize = new URL("/oauth/authorize", origin);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: LOCAL_PLATFORM_CLIENT_ID,
    redirect_uri: LOCAL_PLATFORM_REDIRECT_URI,
    scope: "openid capsules:read",
    workspace_id: workspaceId,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const authorization = await fetch(authorize, {
    headers: {
      authorization: `Bearer ${sessionId}`,
      "sec-fetch-dest": "document",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const location = authorization.headers.get("location");
  if (authorization.status !== 302 || !location) {
    throw new Error(
      `runtime Principal authorization failed (${authorization.status})`,
    );
  }
  const redirect = new URL(location);
  if (
    `${redirect.origin}${redirect.pathname}` !== LOCAL_PLATFORM_REDIRECT_URI
  ) {
    throw new Error(
      "runtime Principal authorization returned an unexpected redirect",
    );
  }
  const code = redirect.searchParams.get("code");
  if (!code)
    throw new Error("runtime Principal authorization returned no code");
  const tokenResponse = await fetch(new URL("/oauth/token", origin), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: LOCAL_PLATFORM_REDIRECT_URI,
      client_id: LOCAL_PLATFORM_CLIENT_ID,
      client_secret: localPlatformClientSecret(),
      code_verifier: verifier,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const tokenBody = await responseJson(
    tokenResponse,
    "runtime Principal token",
  );
  const accessToken = stringField(
    tokenBody.access_token,
    "runtime Principal access_token",
  );
  if (accessToken === sessionId) {
    throw new Error(
      "runtime Principal token reused the account session bearer",
    );
  }
  return accessToken;
}

async function revokeLocalRuntimePrincipalToken(
  origin: string,
  accessToken: string,
): Promise<void> {
  const response = await fetch(new URL("/oauth/revoke", origin), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: accessToken,
      client_id: LOCAL_PLATFORM_CLIENT_ID,
      client_secret: localPlatformClientSecret(),
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `runtime Principal token revocation failed (${response.status})`,
    );
  }
}

async function waitForRun(
  control: ReturnType<typeof createControlClient>,
  runId: string,
  label: string,
): Promise<JsonRecord> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const body = await control(
      `read ${label}`,
      `/api/v1/runs/${encodeURIComponent(runId)}`,
    );
    const run = record(body.run, `${label}.run`);
    const status = stringField(run.status, `${label}.run.status`);
    if (TERMINAL_RUN_STATUSES.has(status)) {
      if (status === "failed" || status === "canceled") {
        throw new Error(`${label} reached ${status}`);
      }
      return run;
    }
    await Bun.sleep(Math.min(250 + attempt * 25, 1_000));
  }
  throw new Error(`${label} did not reach a terminal status`);
}

function rowTable(rows: readonly JsonRecord[]) {
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
    select: () => ({ from: () => rowTable([]) }),
    insert: () => {
      throw new Error(
        "live runtime Interface proof must not persist Takos rows",
      );
    },
    update: () => {
      throw new Error(
        "live runtime Interface proof must not persist Takos rows",
      );
    },
    delete: () => {
      throw new Error(
        "live runtime Interface proof must not persist Takos rows",
      );
    },
  } as never;
}

function createToolboxRuntime(input: {
  readonly origin: string;
  readonly sessionId: string;
  readonly subjectId: string;
  readonly workspaceId: string;
  readonly runId: string;
}) {
  const db = readOnlyMcpDb();
  const resolverDiagnostics: Array<{
    readonly availableTools: readonly string[];
    readonly failedServers: readonly string[];
  }> = [];
  const dispatch = async (request: Request): Promise<Response> => {
    const response = await fetch(request);
    const optionalSseUnsupported =
      request.method === "GET" && response.status === 405;
    if (!response.ok && !optionalSseUnsupported) {
      const target = new URL(request.url);
      console.error(
        JSON.stringify({
          event: "local_mcp_egress_rejected",
          method: request.method,
          path: target.pathname,
          status: response.status,
        }),
      );
    }
    return response;
  };
  const egress = {
    async fetch(resource: RequestInfo | URL, init?: RequestInit) {
      const request = new Request(resource, init);
      const target = new URL(request.url);
      const canonical = new URL(DEFAULT_BASE_URL);
      const headers = new Headers(request.headers);
      headers.delete("x-takos-space-id");
      headers.delete("x-takos-egress-mode");
      headers.delete("x-takos-run-id");
      const body =
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer();
      const destination =
        target.origin === canonical.origin
          ? new URL(`${target.pathname}${target.search}`, input.origin)
          : target;
      return dispatch(
        new Request(destination, {
          method: request.method,
          headers,
          body,
          redirect: "manual",
          signal: request.signal,
        }),
      );
    },
  };
  const env = {
    DB: db,
    ENVIRONMENT: "development",
    TAKOS_EGRESS: egress,
  } as unknown as Env;
  const resolverOptions: ToolResolverOptions = {
    runtimeMcpInterfaces: {
      workspaceId: input.workspaceId,
      request: {
        baseUrl: input.origin,
        token: input.sessionId,
        subjectId: input.subjectId,
        fetch(request, init = {}) {
          const headers = new Headers(init.headers);
          if (init.method === "POST") headers.set("origin", DEFAULT_BASE_URL);
          return fetch(request, { ...init, headers });
        },
      },
    },
  };
  const dependencies: RemoteToolExecutorDependencies = {
    async createExecutor(_runId, workerEnv, signal) {
      if (_runId !== input.runId) throw new Error("Run identity changed");
      const resolver = await createToolResolver(
        db,
        input.workspaceId,
        workerEnv,
        resolverOptions,
      );
      resolverDiagnostics.push({
        availableTools: resolver.getAvailableTools().map((tool) => tool.name),
        failedServers: resolver.mcpFailedServers,
      });
      const context: ToolContext = {
        spaceId: input.workspaceId,
        threadId: "local-takosumi-mcp-agent-e2e",
        runId: input.runId,
        userId: input.subjectId,
        role: "owner",
        capabilities: [],
        env: workerEnv,
        db,
        abortSignal: signal,
      };
      const executor = new ToolExecutor(resolver, context);
      context.capabilityRegistry = buildPerRunCapabilityRegistry(executor);
      (
        context as ToolContext & { _toolExecutor?: ToolExecutor }
      )._toolExecutor = executor;
      return executor;
    },
  };
  return {
    async catalog() {
      const response = await handleToolCatalog(
        { runId: input.runId },
        env,
        dependencies,
      );
      return await responseJson(response, "Takos tool catalog");
    },
    async toolbox(id: string, arguments_: JsonRecord) {
      const response = await handleToolExecute(
        {
          runId: input.runId,
          idempotencyKey: `${input.runId}:${id}`,
          toolCall: { id, name: "toolbox", arguments: arguments_ },
        },
        env,
        dependencies,
      );
      return await responseJson(response, `Takos toolbox ${id}`);
    },
    diagnostics() {
      return resolverDiagnostics.slice(-3);
    },
  };
}

function toolboxOutput(body: JsonRecord, label: string): string {
  const error = typeof body.error === "string" ? body.error : null;
  if (error) throw new Error(`${label}: ${error}`);
  return stringField(body.output, `${label}.output`);
}

async function main() {
  const origin = normalizedOrigin(
    process.env.TAKOSUMI_E2E_BASE_URL?.trim() || DEFAULT_BASE_URL,
  );
  const sessionId = requiredEnv("TAKOSUMI_E2E_SESSION_ID");
  const control = createControlClient(origin, sessionId);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const runId = `local-takosumi-mcp-agent-e2e-${suffix}`;

  const me = await control(
    "session introspection",
    "/api/v1/account/session/me",
  );
  const subjectId = stringField(me.subject, "session subject");
  const workspaceBody = await control(
    "Workspace create",
    "/api/v1/workspaces",
    {
      method: "POST",
      body: JSON.stringify({
        handle: `agent-mcp-${suffix}`.slice(0, 63),
        displayName: `Agent MCP E2E ${suffix}`,
        type: "personal",
      }),
    },
  );
  const workspaceId = stringField(
    record(workspaceBody.workspace, "Workspace").id,
    "Workspace.id",
  );
  const runtimePrincipalToken = await issueLocalRuntimePrincipalToken(
    origin,
    sessionId,
    workspaceId,
  );

  let evidence: JsonRecord | undefined;
  try {
    const runtime = createToolboxRuntime({
      origin,
      sessionId: runtimePrincipalToken,
      subjectId,
      workspaceId,
      runId,
    });

    const initialCatalog = await runtime.catalog();
    const initialSearch = JSON.parse(
      toolboxOutput(
        await runtime.toolbox("before-deploy", {
          action: "search",
          query: TOOL_NAME,
        }),
        "toolbox before deploy",
      ),
    ) as { results?: unknown[] };
    if ((initialSearch.results ?? []).length !== 0) {
      throw new Error("operator MCP tool existed before the Capsule apply");
    }

    const sourceBody = await control("Source create", "/api/v1/sources", {
      method: "POST",
      body: JSON.stringify({
        workspaceId,
        name: `operator-control-${suffix}`,
        url:
          process.env.TAKOSUMI_E2E_SOURCE_GIT?.trim() ||
          "https://github.com/tako0614/takosumi.git",
        defaultRef:
          process.env.TAKOSUMI_E2E_SOURCE_REF?.trim() ||
          OPERATOR_CONTROL_SOURCE_REF,
        defaultPath: OPERATOR_CONTROL_MODULE_PATH,
        autoSync: false,
      }),
    });
    const sourceId = stringField(
      record(sourceBody.source, "Source").id,
      "Source.id",
    );
    const syncBody = await control(
      "Source sync",
      `/api/v1/sources/${encodeURIComponent(sourceId)}/sync`,
      { method: "POST", body: "{}" },
    );
    const syncRunId = stringField(
      record(syncBody.run, "Source sync Run").id,
      "Source sync Run.id",
    );
    await waitForRun(control, syncRunId, "Source sync Run");

    const capsuleBody = await control(
      "Capsule create",
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/capsules`,
      {
        method: "POST",
        body: JSON.stringify({
          name: `operator-control-${suffix}`.slice(0, 128),
          environment: "test",
          sourceId,
          installConfigId: OPERATOR_CONTROL_INSTALL_CONFIG_ID,
          runnerProfileId: "opentofu-default",
          modulePath: OPERATOR_CONTROL_MODULE_PATH,
          vars: { takosumi_origin: DEFAULT_BASE_URL },
        }),
      },
    );
    const capsuleId = stringField(
      record(capsuleBody.capsule, "Capsule").id,
      "Capsule.id",
    );
    const planBody = await control(
      "Capsule plan",
      `/api/v1/capsules/${encodeURIComponent(capsuleId)}/plan`,
      { method: "POST", body: "{}" },
    );
    const planRunId = stringField(
      record(planBody.run, "Plan Run").id,
      "Plan Run.id",
    );
    let planRun = await waitForRun(control, planRunId, "Plan Run");
    if (planRun.status === "waiting_approval") {
      await control(
        "Plan Run approve",
        `/api/v1/runs/${encodeURIComponent(planRunId)}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ reason: "local MCP agent E2E" }),
        },
      );
      planRun = record(
        (
          await control(
            "approved Plan Run readback",
            `/api/v1/runs/${encodeURIComponent(planRunId)}`,
          )
        ).run,
        "approved Plan Run",
      );
    }
    if (planRun.status !== "succeeded") {
      throw new Error(`Plan Run is ${String(planRun.status)} after approval`);
    }
    const applyBody = await control(
      "Plan Run apply",
      `/api/v1/runs/${encodeURIComponent(planRunId)}/apply`,
      { method: "POST", body: "{}" },
    );
    const applyRun = record(applyBody.run, "Apply Run");
    const applyRunId = stringField(applyRun.id, "Apply Run.id");
    const completedApply = await waitForRun(control, applyRunId, "Apply Run");
    if (completedApply.status !== "succeeded") {
      throw new Error(`Apply Run is ${String(completedApply.status)}`);
    }

    let searchPayload: { results?: Array<{ name?: string }> } | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const search = await runtime.toolbox(`after-deploy-search-${attempt}`, {
        action: "search",
        query: TOOL_NAME,
      });
      searchPayload = JSON.parse(
        toolboxOutput(search, "toolbox after deploy search"),
      ) as { results?: Array<{ name?: string }> };
      if (searchPayload.results?.some((item) => item.name === TOOL_NAME)) break;
      await Bun.sleep(500);
    }
    if (!searchPayload?.results?.some((item) => item.name === TOOL_NAME)) {
      throw new Error(
        `same Run did not discover the applied Capsule MCP tool: ${JSON.stringify({ searchPayload, resolver: runtime.diagnostics() })}`,
      );
    }
    const described = JSON.parse(
      toolboxOutput(
        await runtime.toolbox("after-deploy-describe", {
          action: "describe",
          tool_name: TOOL_NAME,
        }),
        "toolbox describe",
      ),
    ) as { tools?: Array<{ name?: string; available?: boolean }> };
    if (
      described.tools?.[0]?.name !== TOOL_NAME ||
      described.tools[0].available !== true
    ) {
      throw new Error("toolbox did not activate the live MCP descriptor");
    }
    const called = toolboxOutput(
      await runtime.toolbox("after-deploy-call", {
        action: "call",
        tool_name: TOOL_NAME,
        arguments: {},
      }),
      "toolbox call",
    );
    if (!called.toLowerCase().includes("capsule")) {
      throw new Error("live MCP tools/call returned no Capsule list evidence");
    }

    evidence = {
      kind: "takos.local-takosumi-mcp-agent-e2e@v1",
      workspaceId,
      sourceId,
      capsuleId,
      planRunId,
      applyRunId,
      takosRunId: runId,
      initialModelToolCount: Array.isArray(initialCatalog.tools)
        ? initialCatalog.tools.length
        : 0,
      interfaceDiscoveredAfterApply: true,
      mcpInitializeListCall: true,
      sameRunToolboxRefresh: true,
      tool: TOOL_NAME,
    };
  } finally {
    await revokeLocalRuntimePrincipalToken(origin, runtimePrincipalToken);
  }
  if (!evidence) throw new Error("local MCP agent E2E produced no evidence");
  console.log(JSON.stringify(evidence));
}

await main();
