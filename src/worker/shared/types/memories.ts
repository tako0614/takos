export type MemoryType = "episode" | "semantic" | "procedural";

export const MAX_MEMORY_RECORDS_PER_PAGE = 100;
export const MAX_MEMORY_REFERENCE_CHARACTERS = 128;
export const MAX_MEMORY_SEARCH_QUERY_CHARACTERS = 1_000;
export const MAX_MEMORY_CONTENT_CHARACTERS = 100_000;
export const MAX_MEMORY_CATEGORY_CHARACTERS = 1_000;
export const MAX_MEMORY_SUMMARY_CHARACTERS = 100_000;
export const MAX_MEMORY_TAG_CHARACTERS = 1_000;
export const MAX_MEMORY_TAG_ITEMS = 100;
export const MAX_MEMORY_TAGS_CHARACTERS = 100_000;
export const MAX_MEMORY_TIMESTAMP_CHARACTERS = 64;
export const MAX_REMINDER_CONTENT_CHARACTERS = 100_000;
export const MAX_REMINDER_CONTEXT_CHARACTERS = 100_000;
export const MAX_REMINDER_TRIGGER_VALUE_CHARACTERS = 100_000;

export interface Memory {
  id: string;
  space_id: string;
  user_id: string | null;
  thread_id: string | null;

  type: MemoryType;
  category: string | null;
  content: string;
  summary: string | null;

  importance: number;

  tags: string | null;

  occurred_at: string | null;
  expires_at: string | null;
  last_accessed_at: string | null;
  access_count: number;

  created_at: string;
  updated_at: string;
}

export type ReminderTriggerType = "time" | "condition" | "context";
export type ReminderStatus =
  | "pending"
  | "triggered"
  | "completed"
  | "dismissed";
export type ReminderPriority = "low" | "normal" | "high" | "critical";

export interface Reminder {
  id: string;
  space_id: string;
  user_id: string | null;

  content: string;
  context: string | null;

  trigger_type: ReminderTriggerType;
  trigger_value: string | null;

  status: ReminderStatus;
  triggered_at: string | null;

  priority: ReminderPriority;

  created_at: string;
  updated_at: string;
}
