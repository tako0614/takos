export type WorkerQueueKind =
  | "runs"
  | "runs_dlq"
  | "index_jobs"
  | "index_jobs_dlq"
  | "workflow_jobs"
  | "workflow_jobs_dlq"
  | "deployment_jobs"
  | "deployment_jobs_dlq";

const STAGING_SUFFIX = /-staging$/i;

export function normalizeWorkerQueueName(queueName: string): string {
  return queueName.replace(STAGING_SUFFIX, "");
}

export function classifyWorkerQueueName(
  queueName: string,
): WorkerQueueKind | null {
  const normalized = normalizeWorkerQueueName(queueName);
  if (normalized.endsWith("-runs-dlq")) return "runs_dlq";
  if (normalized.endsWith("-runs")) return "runs";
  if (normalized.endsWith("-index-jobs-dlq")) return "index_jobs_dlq";
  if (normalized.endsWith("-index-jobs")) return "index_jobs";
  if (normalized.endsWith("-workflow-jobs-dlq")) return "workflow_jobs_dlq";
  if (normalized.endsWith("-workflow-jobs")) return "workflow_jobs";
  if (normalized.endsWith("-deployment-jobs-dlq")) {
    return "deployment_jobs_dlq";
  }
  if (normalized.endsWith("-deployment-jobs")) return "deployment_jobs";
  return null;
}
