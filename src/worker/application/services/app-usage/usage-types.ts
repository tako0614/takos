export const APP_USAGE_METER_TYPES = [
  "llm_tokens_input",
  "llm_tokens_output",
  "embedding_count",
  "vector_search_count",
  "exec_seconds",
  "web_search_count",
  "r2_storage_gb_month",
  "wfp_requests",
  "queue_messages",
] as const;

export type AppUsageMeterType = typeof APP_USAGE_METER_TYPES[number];

export interface AppUsageRecordInput {
  ownerAccountId: string;
  spaceId?: string;
  meterType: AppUsageMeterType;
  units: number;
  referenceId?: string;
  referenceType?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface AppUsageRecordResult {
  success: boolean;
  applied: boolean;
  eventId: string;
}
