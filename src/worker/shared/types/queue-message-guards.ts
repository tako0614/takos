import {
  DEPLOYMENT_QUEUE_MESSAGE_VERSION,
  INDEX_JOB_QUEUE_TYPES,
  INDEX_QUEUE_MESSAGE_VERSION,
  NOTIFICATION_PUSH_QUEUE_MESSAGE_VERSION,
  RUN_QUEUE_MESSAGE_VERSION,
  WORKFLOW_QUEUE_MESSAGE_VERSION,
} from "./queue-messages.ts";
import type {
  DeploymentQueueMessage,
  IndexJobQueueMessage,
  NotificationPushQueueMessage,
  RunQueueMessage,
  WorkflowJobQueueMessage,
} from "./queue-messages.ts";

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

export function isValidNotificationPushQueueMessage(
  msg: unknown,
): msg is NotificationPushQueueMessage {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return false;
  const m = msg as Record<string, unknown>;
  const allowedKeys = new Set([
    "version",
    "notificationId",
    "userId",
    "scopeId",
    "timestamp",
  ]);
  return (
    Object.keys(m).every((key) => allowedKeys.has(key)) &&
    m.version === NOTIFICATION_PUSH_QUEUE_MESSAGE_VERSION &&
    isBoundedIdentifier(m.notificationId) &&
    isBoundedIdentifier(m.userId) &&
    (m.scopeId === undefined || isBoundedIdentifier(m.scopeId)) &&
    typeof m.timestamp === "number" &&
    Number.isFinite(m.timestamp) &&
    m.timestamp >= 0
  );
}

export function isValidRunQueueMessage(msg: unknown): msg is RunQueueMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    m.version === RUN_QUEUE_MESSAGE_VERSION &&
    typeof m.runId === "string" &&
    m.runId.length > 0 &&
    m.runId.length <= 512 &&
    typeof m.timestamp === "number" &&
    Number.isFinite(m.timestamp) &&
    (m.model === undefined ||
      (typeof m.model === "string" &&
        m.model.length > 0 &&
        m.model.length <= 128)) &&
    (m.backpressureCount === undefined ||
      (typeof m.backpressureCount === "number" &&
        Number.isSafeInteger(m.backpressureCount) &&
        m.backpressureCount >= 0))
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
    m.jobId.length > 0 &&
    m.jobId.length <= 512 &&
    // One-release rolling compatibility: old in-flight v1 queue bodies have
    // no deliveryId and the consumer falls back to transport message.id.
    (m.deliveryId === undefined ||
      (typeof m.deliveryId === "string" &&
        m.deliveryId.length > 0 &&
        m.deliveryId.length <= 1024)) &&
    typeof m.spaceId === "string" &&
    m.spaceId.length > 0 &&
    m.spaceId.length <= 512 &&
    typeof m.type === "string" &&
    (INDEX_JOB_QUEUE_TYPES as readonly string[]).includes(m.type as string) &&
    (m.targetId === undefined ||
      (typeof m.targetId === "string" &&
        m.targetId.length > 0 &&
        m.targetId.length <= 512)) &&
    (m.repoId === undefined ||
      (typeof m.repoId === "string" &&
        m.repoId.length > 0 &&
        m.repoId.length <= 512)) &&
    typeof m.timestamp === "number" &&
    Number.isFinite(m.timestamp) &&
    m.timestamp >= 0
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
    return (
      typeof m.deploymentId === "string" && typeof m.timestamp === "number"
    );
  }
  return false;
}
