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
} from './control-rpc-types.js';

export type {
  ControlRpcCapability,
  ControlRpcMemoryActivation,
  ControlRpcRunBootstrap,
  ControlRpcRunContext,
  ControlRpcRunRecord,
  ControlRpcRunStatus,
  ControlRpcSkillPlan,
  ControlRpcToolCatalog,
} from './control-rpc-types.js';

function normalizeServiceScopedPayload<T extends ServiceScopedPayload>(payload: T): T & { serviceId: string; workerId: string } {
  const serviceId = payload.serviceId ?? payload.workerId;
  if (!serviceId) {
    throw new Error('Missing serviceId or workerId');
  }
  return {
    ...payload,
    serviceId,
    workerId: payload.workerId ?? serviceId,
  };
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function parseJson<T>(response: Response, path: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Control RPC ${path} returned malformed JSON (${response.status})`);
  }
}

export class ControlRpcClient {
  private readonly baseUrl: string;
  private readonly runId: string;
  private readonly tokenSource: ControlRpcTokenSource;

  constructor(baseUrl: string, runId: string, tokenSource: ControlRpcTokenSource) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.runId = runId;
    this.tokenSource = tokenSource;
  }

  private authHeaders(path: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.tokenSource.tokenForPath(path)}`,
      'X-Takos-Run-Id': this.runId,
      'Content-Type': 'application/json',
    };
  }

  private async post<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.authHeaders(path),
      body: JSON.stringify(body),
      signal: timeoutSignal(timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Control RPC ${path} failed with ${response.status}: ${text.slice(0, 300)}`);
    }

    return parseJson<T>(response, path);
  }

  async heartbeat(payload: { runId: string; serviceId?: string; workerId?: string; leaseVersion?: number }, timeoutMs?: number): Promise<void> {
    await this.post('/rpc/control/heartbeat', normalizeServiceScopedPayload(payload), timeoutMs);
  }

  async getRunStatus(runId: string): Promise<ControlRpcRunStatus> {
    const result = await this.post<{ status: ControlRpcRunStatus }>('/rpc/control/run-status', { runId });
    return result.status ?? null;
  }

  async failRun(payload: { runId: string; serviceId?: string; workerId?: string; leaseVersion?: number; error: string }): Promise<void> {
    await this.post('/rpc/control/run-fail', normalizeServiceScopedPayload(payload));
  }

  async resetRun(payload: { runId: string; serviceId?: string; workerId?: string }): Promise<void> {
    await this.post('/rpc/control/run-reset', normalizeServiceScopedPayload(payload));
  }

  async fetchApiKeys(): Promise<{ openai?: string; anthropic?: string; google?: string }> {
    const result = await this.post<ApiKeysResponse>('/rpc/control/api-keys', {});
    return {
      openai: result.openai ?? undefined,
      anthropic: result.anthropic ?? undefined,
      google: result.google ?? undefined,
    };
  }

  async recordBillingUsage(runId: string): Promise<void> {
    await this.post('/rpc/control/billing-run-usage', { runId });
  }

  async getRunContext(runId: string): Promise<ControlRpcRunContext> {
    return this.post<ControlRpcRunContext>('/rpc/control/run-context', { runId });
  }

  async getRunRecord(runId: string): Promise<ControlRpcRunRecord> {
    return this.post<ControlRpcRunRecord>('/rpc/control/run-record', { runId });
  }

  async getRunBootstrap(runId: string): Promise<ControlRpcRunBootstrap> {
    return this.post<ControlRpcRunBootstrap>('/rpc/control/run-bootstrap', { runId });
  }

  async completeNoLlmRun(payload: { runId: string; serviceId?: string; workerId?: string; response: string }): Promise<void> {
    await this.post('/rpc/control/no-llm-complete', normalizeServiceScopedPayload(payload));
  }

  async getConversationHistory(payload: {
    runId: string;
    threadId: string;
    spaceId: string;
    aiModel: string;
  }): Promise<AgentMessage[]> {
    const result = await this.post<{ history: AgentMessage[] }>('/rpc/control/conversation-history', payload);
    return Array.isArray(result.history) ? result.history : [];
  }

  async resolveSkillPlan(payload: {
    runId: string;
    threadId: string;
    spaceId: string;
    agentType: string;
    history: AgentMessage[];
    availableToolNames: string[];
  }): Promise<ControlRpcSkillPlan> {
    return this.post<ControlRpcSkillPlan>('/rpc/control/skill-plan', payload);
  }

  async getMemoryActivation(payload: { spaceId: string }): Promise<ControlRpcMemoryActivation> {
    return this.post<ControlRpcMemoryActivation>('/rpc/control/memory-activation', payload);
  }

  async finalizeMemoryOverlay(payload: {
    runId: string;
    spaceId: string;
    claims: MemoryClaim[];
    evidence: MemoryEvidence[];
  }): Promise<void> {
    await this.post('/rpc/control/memory-finalize', payload);
  }

  async addMessage(payload: {
    runId: string;
    threadId: string;
    message: AgentMessage;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.post('/rpc/control/add-message', payload);
  }

  async updateRunStatus(payload: {
    runId: string;
    status: string;
    usage: { inputTokens: number; outputTokens: number };
    output?: string;
    error?: string;
  }): Promise<void> {
    await this.post('/rpc/control/update-run-status', payload);
  }

  async getCurrentSessionId(payload: { runId: string; spaceId: string }): Promise<string | null> {
    const result = await this.post<{ sessionId: string | null }>('/rpc/control/current-session', payload);
    return result.sessionId ?? null;
  }

  async isCancelled(runId: string): Promise<boolean> {
    const result = await this.post<{ cancelled: boolean }>('/rpc/control/is-cancelled', { runId });
    return result.cancelled === true;
  }

  async getToolCatalog(runId: string): Promise<ControlRpcToolCatalog> {
    return this.post<ControlRpcToolCatalog>('/rpc/control/tool-catalog', { runId });
  }

  async executeTool(payload: {
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
    return this.post('/rpc/control/tool-execute', payload, 5 * 60_000);
  }

  async cleanupToolExecutor(runId: string): Promise<void> {
    await this.post('/rpc/control/tool-cleanup', { runId });
  }

  async emitRunEvent(payload: {
    runId: string;
    type: 'started' | 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'artifact' | 'completed' | 'error' | 'cancelled' | 'progress';
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
  }): Promise<void> {
    await this.post('/rpc/control/run-event', payload);
  }
}

export function createStaticControlRpcTokenSource(token: string): ControlRpcTokenSource {
  return {
    tokenForPath(_path: string) {
      return token;
    },
  };
}

const CONTROL_RPC_PATHS = new Set([
  '/rpc/control/heartbeat',
  '/rpc/control/run-status',
  '/rpc/control/run-record',
  '/rpc/control/run-bootstrap',
  '/rpc/control/run-fail',
  '/rpc/control/run-reset',
  '/rpc/control/api-keys',
  '/rpc/control/billing-run-usage',
  '/rpc/control/run-context',
  '/rpc/control/no-llm-complete',
  '/rpc/control/conversation-history',
  '/rpc/control/skill-plan',
  '/rpc/control/memory-activation',
  '/rpc/control/memory-finalize',
  '/rpc/control/add-message',
  '/rpc/control/update-run-status',
  '/rpc/control/current-session',
  '/rpc/control/is-cancelled',
  '/rpc/control/tool-catalog',
  '/rpc/control/tool-execute',
  '/rpc/control/tool-cleanup',
  '/rpc/control/run-event',
]);

export function isControlRpcPath(path: string): boolean {
  return CONTROL_RPC_PATHS.has(path);
}

export function getRequiredControlRpcCapability(path: string): ControlRpcCapability | null {
  return isControlRpcPath(path) ? 'control' : null;
}
