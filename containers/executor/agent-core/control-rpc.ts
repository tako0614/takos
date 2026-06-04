import type {
  AgentMessage,
  ApiKeysResponse,
  ControlRpcCapability,
  ControlRpcMemoryActivation,
  ControlRpcRunBootstrap,
  ControlRpcRunContext,
  ControlRpcRunRecord,
  ControlRpcRunStatus,
  ControlRpcSkillPlan,
  ControlRpcTokenSource,
  ControlRpcToolCatalog,
  MemoryClaim,
  MemoryEvidence,
  ServiceScopedPayload,
} from "./control-rpc-types.ts";

export type {
  ControlRpcCapability,
  ControlRpcMemoryActivation,
  ControlRpcRunBootstrap,
  ControlRpcRunContext,
  ControlRpcRunRecord,
  ControlRpcRunStatus,
  ControlRpcSkillPlan,
  ControlRpcToolCatalog,
} from "./control-rpc-types.ts";

function normalizeServiceScopedPayload<T extends ServiceScopedPayload>(
  payload: T,
): T {
  if (!payload.serviceId) {
    throw new Error("Missing serviceId");
  }
  if (!payload.workerId) {
    throw new Error("Missing workerId");
  }
  return payload;
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function parseJson<T>(response: Response, path: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Control RPC ${path} returned malformed JSON (${response.status})`,
    );
  }
}

const CONTROL_RPC_CANONICAL_BASE_PATH = "/api/internal/v1/agent-control";

const CONTROL_RPC_ENDPOINTS = [
  "/heartbeat",
  "/run-status",
  "/run-record",
  "/run-bootstrap",
  "/run-fail",
  "/run-reset",
  "/api-keys",
  "/billing-run-usage",
  "/run-context",
  "/no-llm-complete",
  "/conversation-history",
  "/skill-plan",
  "/memory-activation",
  "/memory-finalize",
  "/add-message",
  "/update-run-status",
  "/current-session",
  "/is-cancelled",
  "/tool-catalog",
  "/tool-execute",
  "/tool-cleanup",
  "/run-event",
] as const;

type ControlRpcEndpoint = typeof CONTROL_RPC_ENDPOINTS[number];

function controlRpcPath(endpoint: ControlRpcEndpoint): string {
  return `${CONTROL_RPC_CANONICAL_BASE_PATH}${endpoint}`;
}

export class ControlRpcClient {
  private readonly baseUrl: string;
  private readonly runId: string;
  private readonly tokenSource: ControlRpcTokenSource;
  private readonly executorTier?: 1 | 2 | 3;
  private readonly executorContainerId?: string;

  constructor(
    baseUrl: string,
    runId: string,
    tokenSource: ControlRpcTokenSource,
    options: { executorTier?: 1 | 2 | 3; executorContainerId?: string } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.runId = runId;
    this.tokenSource = tokenSource;
    this.executorTier = options.executorTier;
    this.executorContainerId = options.executorContainerId;
  }

  private authHeaders(path: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.tokenSource.tokenForPath(path)}`,
      "X-Takos-Run-Id": this.runId,
      "Content-Type": "application/json",
    };
    if (this.executorTier) {
      headers["X-Takos-Executor-Tier"] = String(this.executorTier);
    }
    if (this.executorContainerId) {
      headers["X-Takos-Executor-Container-Id"] = this.executorContainerId;
    }
    return headers;
  }

  private async post<T>(
    path: string,
    body: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.authHeaders(path),
      body: JSON.stringify(body),
      signal: timeoutSignal(timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Control RPC ${path} failed with ${response.status}: ${
          text.slice(0, 300)
        }`,
      );
    }

    return parseJson<T>(response, path);
  }

  async heartbeat(
    payload: {
      runId: string;
      serviceId: string;
      workerId: string;
      leaseVersion?: number;
    },
    timeoutMs?: number,
  ): Promise<void> {
    await this.post(
      controlRpcPath("/heartbeat"),
      normalizeServiceScopedPayload(payload),
      timeoutMs,
    );
  }

  async getRunStatus(runId: string): Promise<ControlRpcRunStatus> {
    const result = await this.post<{ status: ControlRpcRunStatus }>(
      controlRpcPath("/run-status"),
      { runId },
    );
    return result.status ?? null;
  }

  async failRun(
    payload: {
      runId: string;
      serviceId: string;
      workerId: string;
      leaseVersion?: number;
      error: string;
    },
  ): Promise<void> {
    await this.post(
      controlRpcPath("/run-fail"),
      normalizeServiceScopedPayload(payload),
    );
  }

  async resetRun(
    payload: { runId: string; serviceId: string; workerId: string },
  ): Promise<void> {
    await this.post(
      controlRpcPath("/run-reset"),
      normalizeServiceScopedPayload(payload),
    );
  }

  async fetchApiKeys(): Promise<
    { openai?: string; anthropic?: string; google?: string }
  > {
    const result = await this.post<ApiKeysResponse>(
      controlRpcPath("/api-keys"),
      {},
    );
    return {
      openai: result.openai ?? undefined,
      anthropic: result.anthropic ?? undefined,
      google: result.google ?? undefined,
    };
  }

  async recordRunUsage(runId: string): Promise<void> {
    // Billing ownership is Takosumi Accounts / Cloud; the executor only
    // forwards run usage metering through the current agent-control route.
    await this.post(controlRpcPath("/billing-run-usage"), { runId });
  }

  getRunContext(runId: string): Promise<ControlRpcRunContext> {
    return this.post<ControlRpcRunContext>(controlRpcPath("/run-context"), {
      runId,
    });
  }

  getRunRecord(runId: string): Promise<ControlRpcRunRecord> {
    return this.post<ControlRpcRunRecord>(controlRpcPath("/run-record"), {
      runId,
    });
  }

  getRunBootstrap(runId: string): Promise<ControlRpcRunBootstrap> {
    return this.post<ControlRpcRunBootstrap>(
      controlRpcPath("/run-bootstrap"),
      {
        runId,
      },
    );
  }

  async completeNoLlmRun(
    payload: {
      runId: string;
      serviceId: string;
      workerId: string;
      response: string;
    },
  ): Promise<void> {
    await this.post(
      controlRpcPath("/no-llm-complete"),
      normalizeServiceScopedPayload(payload),
    );
  }

  async getConversationHistory(payload: {
    runId: string;
    threadId: string;
    spaceId: string;
    aiModel: string;
  }): Promise<AgentMessage[]> {
    const result = await this.post<{ history: AgentMessage[] }>(
      controlRpcPath("/conversation-history"),
      payload,
    );
    return Array.isArray(result.history) ? result.history : [];
  }

  resolveSkillPlan(payload: {
    runId: string;
    threadId: string;
    spaceId: string;
    agentType: string;
    history: AgentMessage[];
    availableToolNames: string[];
  }): Promise<ControlRpcSkillPlan> {
    return this.post<ControlRpcSkillPlan>(
      controlRpcPath("/skill-plan"),
      payload,
    );
  }

  getMemoryActivation(
    payload: { spaceId: string },
  ): Promise<ControlRpcMemoryActivation> {
    return this.post<ControlRpcMemoryActivation>(
      controlRpcPath("/memory-activation"),
      payload,
    );
  }

  async finalizeMemoryOverlay(payload: {
    runId: string;
    spaceId: string;
    claims: MemoryClaim[];
    evidence: MemoryEvidence[];
  }): Promise<void> {
    await this.post(controlRpcPath("/memory-finalize"), payload);
  }

  async addMessage(payload: {
    runId: string;
    threadId: string;
    message: AgentMessage;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.post(controlRpcPath("/add-message"), payload);
  }

  async updateRunStatus(payload: {
    runId: string;
    status: string;
    usage: { inputTokens: number; outputTokens: number };
    output?: string;
    error?: string;
  }): Promise<void> {
    await this.post(controlRpcPath("/update-run-status"), payload);
  }

  async getCurrentSessionId(
    payload: { runId: string; spaceId: string },
  ): Promise<string | null> {
    const result = await this.post<{ sessionId: string | null }>(
      controlRpcPath("/current-session"),
      payload,
    );
    return result.sessionId ?? null;
  }

  async isCancelled(runId: string): Promise<boolean> {
    const result = await this.post<{ cancelled: boolean }>(
      controlRpcPath("/is-cancelled"),
      { runId },
    );
    return result.cancelled === true;
  }

  getToolCatalog(runId: string): Promise<ControlRpcToolCatalog> {
    return this.post<ControlRpcToolCatalog>(controlRpcPath("/tool-catalog"), {
      runId,
    });
  }

  executeTool(payload: {
    runId: string;
    toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
  }): Promise<{
    tool_call_id: string;
    output: string;
    error?: string;
  }> {
    return this.post(controlRpcPath("/tool-execute"), payload, 5 * 60_000);
  }

  async cleanupToolExecutor(runId: string): Promise<void> {
    await this.post(controlRpcPath("/tool-cleanup"), { runId });
  }

  async emitRunEvent(payload: {
    runId: string;
    type:
      | "started"
      | "thinking"
      | "tool_call"
      | "tool_result"
      | "message"
      | "artifact"
      | "completed"
      | "error"
      | "cancelled"
      | "progress";
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
  }): Promise<void> {
    await this.post(controlRpcPath("/run-event"), payload);
  }
}

export function createStaticControlRpcTokenSource(
  token: string,
): ControlRpcTokenSource {
  return {
    tokenForPath(_path: string) {
      return token;
    },
  };
}

const CONTROL_RPC_PATHS = new Set(
  CONTROL_RPC_ENDPOINTS.map((endpoint) =>
    `${CONTROL_RPC_CANONICAL_BASE_PATH}${endpoint}`
  ),
);

export function normalizeControlRpcPath(path: string): string | null {
  if (CONTROL_RPC_PATHS.has(path)) {
    return path;
  }
  return null;
}

export function isControlRpcPath(path: string): boolean {
  return normalizeControlRpcPath(path) !== null;
}

export function getRequiredControlRpcCapability(
  path: string,
): ControlRpcCapability | null {
  return isControlRpcPath(path) ? "control" : null;
}
