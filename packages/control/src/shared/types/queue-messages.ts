export const RUN_QUEUE_MESSAGE_VERSION = 2;
export const WORKFLOW_QUEUE_MESSAGE_VERSION = 3;
export const DEPLOYMENT_QUEUE_MESSAGE_VERSION = 1;
export const INDEX_QUEUE_MESSAGE_VERSION = 1;
export type WorkflowShell = 'bash' | 'pwsh' | 'python' | 'sh' | 'cmd' | 'powershell';

export interface RunQueueMessage {
  version: typeof RUN_QUEUE_MESSAGE_VERSION;
  runId: string;
  timestamp: number;
  retryCount?: number;
  model?: string;
}

export function isValidRunQueueMessage(msg: unknown): msg is RunQueueMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.version === RUN_QUEUE_MESSAGE_VERSION &&
    typeof m.runId === 'string' &&
    typeof m.timestamp === 'number'
  );
}

export interface IndexJobQueueMessage {
  version: typeof INDEX_QUEUE_MESSAGE_VERSION;
  jobId: string;
  spaceId: string;
  type: 'full' | 'file' | 'vectorize' | 'info_unit' | 'thread_context' | 'repo_code_index' | 'memory_build_paths';
  targetId?: string;
  repoId?: string;
  timestamp: number;
}

export function isValidIndexJobQueueMessage(msg: unknown): msg is IndexJobQueueMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.version === INDEX_QUEUE_MESSAGE_VERSION &&
    typeof m.jobId === 'string' &&
    typeof m.spaceId === 'string' &&
    typeof m.type === 'string' &&
    ['full', 'file', 'vectorize', 'info_unit', 'thread_context', 'repo_code_index', 'memory_build_paths'].includes(m.type as string) &&
    typeof m.timestamp === 'number'
  );
}

export interface WorkflowJobDefinition {
  name?: string;
  'runs-on': string | string[];
  needs?: string | string[];
  if?: string;
  env?: Record<string, string>;
  defaults?: {
    run?: {
      shell?: WorkflowShell;
      'working-directory'?: string;
    };
  };
  steps: Array<{
    id?: string;
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
    if?: string;
    shell?: WorkflowShell;
    'working-directory'?: string;
    'continue-on-error'?: boolean;
    'timeout-minutes'?: number;
  }>;
  outputs?: Record<string, string>;
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean;
  services?: Record<string, unknown>;
  container?: unknown;
}

export interface WorkflowJobQueueMessage {
  version: typeof WORKFLOW_QUEUE_MESSAGE_VERSION;
  type: 'job';
  runId: string;
  jobId: string;
  repoId: string;
  ref: string;
  sha: string;
  jobKey: string;
  jobDefinition: WorkflowJobDefinition;
  env: Record<string, string>;
  secretIds: string[];
  timestamp: number;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}

export function isValidWorkflowJobQueueMessage(msg: unknown): msg is WorkflowJobQueueMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.version === WORKFLOW_QUEUE_MESSAGE_VERSION &&
    m.type === 'job' &&
    typeof m.runId === 'string' &&
    typeof m.jobId === 'string' &&
    typeof m.repoId === 'string' &&
    typeof m.ref === 'string' &&
    typeof m.sha === 'string' &&
    typeof m.jobKey === 'string' &&
    !!m.jobDefinition &&
    typeof m.jobDefinition === 'object' &&
    isStringRecord(m.env) &&
    Array.isArray(m.secretIds) &&
    m.secretIds.every((id) => typeof id === 'string') &&
    typeof m.timestamp === 'number' &&
    !('secrets' in m)
  );
}

export interface DeploymentQueueMessage {
  version: typeof DEPLOYMENT_QUEUE_MESSAGE_VERSION;
  type: 'deployment';
  deploymentId: string;
  timestamp: number;
}

export function isValidDeploymentQueueMessage(msg: unknown): msg is DeploymentQueueMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.version === DEPLOYMENT_QUEUE_MESSAGE_VERSION &&
    m.type === 'deployment' &&
    typeof m.deploymentId === 'string' &&
    typeof m.timestamp === 'number'
  );
}
