export type ControlRpcCapability = 'control';

type ControlRpcTokenSource = {
  tokenForPath(path: string): string;
};

type ServiceScopedPayload = {
  runId: string;
  serviceId?: string;
  workerId?: string;
};

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

type ApiKeysResponse = {
  openai?: string | null;
  anthropic?: string | null;
  google?: string | null;
};

type AgentMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  tool_call_id?: string;
};

type ToolParameter = {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ToolParameter;
  default?: unknown;
  properties?: Record<string, ToolParameter>;
  required?: string[];
};

type ControlRpcToolDefinition = {
  name: string;
  description: string;
  category: string;
  required_roles?: string[];
  required_capabilities?: string[];
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
};

type SkillCatalogEntry = {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  source: string;
  category?: string;
  locale?: string;
  version?: string;
  activation_tags?: string[];
  execution_contract: {
    preferred_tools: string[];
    durable_output_hints: string[];
    output_modes: string[];
    required_mcp_servers: string[];
    template_ids: string[];
  };
  availability: 'available' | 'warning' | 'unavailable';
  availability_reasons: string[];
};

type SkillContext = SkillCatalogEntry & {
  instructions: string;
  priority?: number;
  metadata?: Record<string, unknown>;
};

type SkillSelection = {
  skill: SkillContext;
  score: number;
  reasons: string[];
};

export type ControlRpcSkillPlan = {
  success: boolean;
  error?: string;
  skillLocale: 'ja' | 'en';
  availableSkills: SkillCatalogEntry[];
  selectedSkills: SkillSelection[];
  activatedSkills: SkillContext[];
};

type MemoryClaim = {
  id: string;
  accountId: string;
  claimType: 'fact' | 'preference' | 'decision' | 'observation';
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: 'active' | 'superseded' | 'retracted';
  supersededBy: string | null;
  sourceRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MemoryPath = {
  id: string;
  accountId: string;
  startClaimId: string;
  endClaimId: string;
  hopCount: number;
  pathClaims: string[];
  pathRelations: string[];
  pathSummary: string | null;
  minConfidence: number;
  createdAt: string;
};

type MemoryActivationBundle = {
  claim: MemoryClaim;
  evidenceCount: number;
  paths: MemoryPath[];
};

export type ControlRpcMemoryActivation = {
  bundles: MemoryActivationBundle[];
  segment: string;
  hasContent: boolean;
};

type MemoryEvidence = {
  id: string;
  accountId: string;
  claimId: string;
  kind: 'supports' | 'contradicts' | 'context';
  sourceType: 'tool_result' | 'user_message' | 'agent_inference' | 'memory_recall';
  sourceRef: string | null;
  content: string;
  trust: number;
  taint: string | null;
  createdAt: string;
};

export type ControlRpcRunStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | null;
export type ControlRpcRunContext = {
  status: ControlRpcRunStatus;
  threadId: string | null;
  sessionId: string | null;
  lastUserMessage: string | null;
};
export type ControlRpcRunRecord = {
  status: ControlRpcRunStatus;
  input: string | null;
  parentRunId: string | null;
};

export type ControlRpcRunBootstrap = {
  status: ControlRpcRunStatus;
  spaceId: string;
  sessionId: string | null;
  threadId: string;
  userId: string;
  agentType: string;
};

export type ControlRpcToolCatalog = {
  tools: ControlRpcToolDefinition[];
  mcpFailedServers: string[];
};

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

export function isControlRpcPath(path: string): boolean {
  return path === '/rpc/control/heartbeat'
    || path === '/rpc/control/run-status'
    || path === '/rpc/control/run-record'
    || path === '/rpc/control/run-bootstrap'
    || path === '/rpc/control/run-fail'
    || path === '/rpc/control/run-reset'
    || path === '/rpc/control/api-keys'
    || path === '/rpc/control/billing-run-usage'
    || path === '/rpc/control/run-context'
    || path === '/rpc/control/no-llm-complete'
    || path === '/rpc/control/conversation-history'
    || path === '/rpc/control/skill-plan'
    || path === '/rpc/control/memory-activation'
    || path === '/rpc/control/memory-finalize'
    || path === '/rpc/control/add-message'
    || path === '/rpc/control/update-run-status'
    || path === '/rpc/control/current-session'
    || path === '/rpc/control/is-cancelled'
    || path === '/rpc/control/tool-catalog'
    || path === '/rpc/control/tool-execute'
    || path === '/rpc/control/tool-cleanup'
    || path === '/rpc/control/run-event';
}

export function getRequiredControlRpcCapability(path: string): ControlRpcCapability | null {
  return isControlRpcPath(path) ? 'control' : null;
}
