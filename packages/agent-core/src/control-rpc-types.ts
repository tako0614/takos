export type ControlRpcCapability = 'control';

export type ControlRpcTokenSource = {
  tokenForPath(path: string): string;
};

export type ServiceScopedPayload = {
  runId: string;
  serviceId?: string;
  workerId?: string;
};

export type ApiKeysResponse = {
  openai?: string | null;
  anthropic?: string | null;
  google?: string | null;
};

export type AgentMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  tool_call_id?: string;
};

export type ToolParameter = {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ToolParameter;
  default?: unknown;
  properties?: Record<string, ToolParameter>;
  required?: string[];
};

export type ControlRpcToolDefinition = {
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

export type SkillCatalogEntry = {
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

export type SkillContext = SkillCatalogEntry & {
  instructions: string;
  priority?: number;
  metadata?: Record<string, unknown>;
};

export type SkillSelection = {
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

export type MemoryClaim = {
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

export type MemoryPath = {
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

export type MemoryActivationBundle = {
  claim: MemoryClaim;
  evidenceCount: number;
  paths: MemoryPath[];
};

export type ControlRpcMemoryActivation = {
  bundles: MemoryActivationBundle[];
  segment: string;
  hasContent: boolean;
};

export type MemoryEvidence = {
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
