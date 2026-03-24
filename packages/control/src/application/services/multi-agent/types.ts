/**
 * Multi-Agent Framework — Core type definitions.
 *
 * Provides the foundational interfaces for building specialized agents
 * that can operate independently, communicate via messages, and be
 * coordinated by an orchestrator.
 */

// ── Agent Identity ──────────────────────────────────────────────────

export type AgentId = string;

export type AgentRole =
  | 'orchestrator'
  | 'tool-executor'
  | 'memory-extractor'
  | 'memory-consolidator'
  | 'deployment-executor'
  | 'pr-reviewer'
  | 'delegation-coordinator'
  | 'workflow-executor';

export type AgentStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ── Messages ────────────────────────────────────────────────────────

export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';

export interface AgentMessage<T = unknown> {
  id: string;
  from: AgentId;
  to: AgentId;
  type: string;
  payload: T;
  priority: MessagePriority;
  timestamp: number;
  correlationId?: string;
  replyTo?: string;
}

export interface AgentResponse<T = unknown> {
  messageId: string;
  status: 'success' | 'error' | 'timeout';
  payload?: T;
  error?: string;
}

// ── Agent Worker ────────────────────────────────────────────────────

export interface AgentCapability {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface AgentWorkerConfig {
  id: AgentId;
  role: AgentRole;
  capabilities: AgentCapability[];
  maxConcurrency: number;
  timeoutMs: number;
  retryPolicy?: RetryPolicy;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 30000,
};

/**
 * Base interface for all agent workers.
 *
 * An AgentWorker encapsulates a unit of autonomous work that can:
 * - Process typed messages
 * - Report progress via events
 * - Be started/stopped independently
 * - Communicate results back to the coordinator
 */
export interface AgentWorker<TInput = unknown, TOutput = unknown> {
  readonly id: AgentId;
  readonly role: AgentRole;
  readonly status: AgentStatus;

  /** Initialize the worker with its configuration. */
  initialize(config: AgentWorkerConfig): Promise<void>;

  /** Execute the worker's primary task. */
  execute(input: TInput, signal?: AbortSignal): Promise<TOutput>;

  /** Handle an incoming message from another agent. */
  handleMessage(message: AgentMessage): Promise<AgentResponse>;

  /** Gracefully shut down the worker. */
  shutdown(): Promise<void>;

  /** Get current health/progress info. */
  getHealthInfo(): AgentHealthInfo;
}

export interface AgentHealthInfo {
  agentId: AgentId;
  role: AgentRole;
  status: AgentStatus;
  activeTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  lastActivityAt: number;
  uptime: number;
  metadata?: Record<string, unknown>;
}

// ── Coordination ────────────────────────────────────────────────────

export type CoordinationStrategy = 'sequential' | 'parallel' | 'pipeline' | 'scatter-gather';

export interface WorkflowStep<TInput = unknown, TOutput = unknown> {
  agentRole: AgentRole;
  input: TInput;
  dependsOn?: string[];
  id: string;
  timeoutMs?: number;
  onError?: 'fail' | 'skip' | 'retry';
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  strategy: CoordinationStrategy;
  steps: WorkflowStep[];
  timeoutMs?: number;
}

export interface WorkflowResult {
  workflowId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'partial';
  stepResults: Map<string, StepResult>;
  startedAt: number;
  completedAt: number;
  error?: string;
}

export interface StepResult<T = unknown> {
  stepId: string;
  agentId: AgentId;
  status: 'completed' | 'failed' | 'skipped' | 'cancelled';
  output?: T;
  error?: string;
  startedAt: number;
  completedAt: number;
}

// ── Events ──────────────────────────────────────────────────────────

export type AgentEventType =
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.progress'
  | 'agent.message_sent'
  | 'agent.message_received'
  | 'workflow.started'
  | 'workflow.step_started'
  | 'workflow.step_completed'
  | 'workflow.completed';

export interface AgentEvent {
  type: AgentEventType;
  agentId: AgentId;
  timestamp: number;
  data: Record<string, unknown>;
}

export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;
