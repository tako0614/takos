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

export interface IndexJobQueueMessage {
  version: typeof INDEX_QUEUE_MESSAGE_VERSION;
  jobId: string;
  spaceId: string;
  type: 'full' | 'file' | 'vectorize' | 'info_unit' | 'thread_context' | 'repo_code_index' | 'memory_build_paths';
  targetId?: string;
  repoId?: string;
  timestamp: number;
}

export interface WorkflowStep {
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
  steps: WorkflowStep[];
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

export interface DeploymentQueueMessage {
  version: typeof DEPLOYMENT_QUEUE_MESSAGE_VERSION;
  type: 'deployment';
  deploymentId: string;
  timestamp: number;
}
