import {
  DEPLOYMENT_QUEUE_MESSAGE_VERSION,
  INDEX_QUEUE_MESSAGE_VERSION,
  RUN_QUEUE_MESSAGE_VERSION,
  WORKFLOW_QUEUE_MESSAGE_VERSION,
} from "./queue-messages.ts";
import type {
  DeploymentQueueMessage,
  IndexJobQueueMessage,
  RunQueueMessage,
  WorkflowJobQueueMessage,
} from "./queue-messages.ts";

export function isValidRunQueueMessage(msg: unknown): msg is RunQueueMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    m.version === RUN_QUEUE_MESSAGE_VERSION &&
    typeof m.runId === "string" &&
    typeof m.timestamp === "number"
  );
}

export function isValidIndexJobQueueMessage(
  msg: unknown,
): msg is IndexJobQueueMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    m.version === INDEX_QUEUE_MESSAGE_VERSION &&
    typeof m.jobId === "string" &&
    typeof m.spaceId === "string" &&
    typeof m.type === "string" &&
    [
      "vectorize",
      "info_unit",
      "thread_context",
      "repo_code_index",
      "memory_build_paths",
    ].includes(m.type as string) &&
    typeof m.timestamp === "number"
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

export function isValidWorkflowJobQueueMessage(
  msg: unknown,
): msg is WorkflowJobQueueMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    m.version === WORKFLOW_QUEUE_MESSAGE_VERSION &&
    m.type === "job" &&
    typeof m.runId === "string" &&
    typeof m.jobId === "string" &&
    typeof m.repoId === "string" &&
    typeof m.ref === "string" &&
    typeof m.sha === "string" &&
    typeof m.jobKey === "string" &&
    !!m.jobDefinition &&
    typeof m.jobDefinition === "object" &&
    isStringRecord(m.env) &&
    Array.isArray(m.secretIds) &&
    m.secretIds.every((id) => typeof id === "string") &&
    typeof m.timestamp === "number" &&
    !("secrets" in m)
  );
}

export function isValidDeploymentQueueMessage(
  msg: unknown,
): msg is DeploymentQueueMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (m.version !== DEPLOYMENT_QUEUE_MESSAGE_VERSION) return false;
  if (m.type === "deployment") {
    return typeof m.deploymentId === "string" &&
      typeof m.timestamp === "number";
  }
  if (m.type === "group_deployment_snapshot") {
    return typeof m.spaceId === "string" &&
      typeof m.groupId === "string" &&
      typeof m.groupName === "string" &&
      typeof m.repositoryUrl === "string" &&
      typeof m.ref === "string" &&
      ["branch", "tag", "commit"].includes(m.refType as string) &&
      typeof m.createdByAccountId === "string" &&
      (m.backendName === undefined ||
        ["cloudflare", "local", "aws", "gcp", "k8s"].includes(
          m.backendName as string,
        )) &&
      (m.envName === undefined || typeof m.envName === "string") &&
      (m.reason === undefined || m.reason === "default_app_preinstall") &&
      typeof m.timestamp === "number";
  }
  return false;
}
