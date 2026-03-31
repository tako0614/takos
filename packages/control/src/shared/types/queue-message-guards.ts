import {
  RUN_QUEUE_MESSAGE_VERSION,
  INDEX_QUEUE_MESSAGE_VERSION,
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  DEPLOYMENT_QUEUE_MESSAGE_VERSION,
} from './queue-messages.ts';
import type {
  RunQueueMessage,
  IndexJobQueueMessage,
  WorkflowJobQueueMessage,
  DeploymentQueueMessage,
} from './queue-messages.ts';

export function isValidRunQueueMessage(msg: unknown): msg is RunQueueMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.version === RUN_QUEUE_MESSAGE_VERSION &&
    typeof m.runId === 'string' &&
    typeof m.timestamp === 'number'
  );
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
