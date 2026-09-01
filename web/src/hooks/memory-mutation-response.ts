import {
  MAX_MEMORY_CATEGORY_CHARACTERS,
  MAX_MEMORY_CONTENT_CHARACTERS,
  MAX_MEMORY_RECORDS_PER_PAGE,
  MAX_MEMORY_REFERENCE_CHARACTERS,
  MAX_MEMORY_SUMMARY_CHARACTERS,
  MAX_MEMORY_TAGS_CHARACTERS,
  MAX_MEMORY_TIMESTAMP_CHARACTERS,
  MAX_REMINDER_CONTENT_CHARACTERS,
  MAX_REMINDER_CONTEXT_CHARACTERS,
  MAX_REMINDER_TRIGGER_VALUE_CHARACTERS,
} from "takos-api-contract/shared/types";
import type { Memory, Reminder } from "../types/index.ts";

const MEMORY_TYPES = new Set(["episode", "semantic", "procedural"]);
const REMINDER_TRIGGER_TYPES = new Set(["time", "condition", "context"]);
const REMINDER_STATUSES = new Set([
  "pending",
  "triggered",
  "completed",
  "dismissed",
]);
const REMINDER_PRIORITIES = new Set([
  "low",
  "normal",
  "high",
  "critical",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" || value.length > maxCharacters ||
    (!allowEmpty && !value.trim())
  ) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value;
}

function nullableString(
  value: unknown,
  field: string,
  maxCharacters: number,
): string | null {
  return value === null
    ? null
    : boundedString(value, field, maxCharacters, true);
}

function timestamp(value: unknown, field: string): string {
  const text = boundedString(value, field, MAX_MEMORY_TIMESTAMP_CHARACTERS);
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`Invalid ${field}`);
  }
  return text;
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

function nullableReference(value: unknown, field: string): string | null {
  return value === null
    ? null
    : boundedString(value, field, MAX_MEMORY_REFERENCE_CHARACTERS);
}

function parseMemoryRecord(value: unknown, expectedSpaceId: string): Memory {
  const candidate = record(value);
  if (
    !candidate || candidate.space_id !== expectedSpaceId ||
    !MEMORY_TYPES.has(candidate.type as string) ||
    typeof candidate.importance !== "number" ||
    !Number.isFinite(candidate.importance) || candidate.importance < 0 ||
    candidate.importance > 1 ||
    !Number.isSafeInteger(candidate.access_count) ||
    (candidate.access_count as number) < 0
  ) {
    throw new TypeError("Invalid Memory response record");
  }

  nullableReference(candidate.user_id, "Memory user_id");
  nullableReference(candidate.thread_id, "Memory thread_id");
  return {
    id: boundedString(
      candidate.id,
      "Memory id",
      MAX_MEMORY_REFERENCE_CHARACTERS,
    ),
    space_id: expectedSpaceId,
    type: candidate.type as Memory["type"],
    category: nullableString(
      candidate.category,
      "Memory category",
      MAX_MEMORY_CATEGORY_CHARACTERS,
    ),
    content: boundedString(
      candidate.content,
      "Memory content",
      MAX_MEMORY_CONTENT_CHARACTERS,
    ),
    summary: nullableString(
      candidate.summary,
      "Memory summary",
      MAX_MEMORY_SUMMARY_CHARACTERS,
    ),
    importance: candidate.importance,
    tags: nullableString(
      candidate.tags,
      "Memory tags",
      MAX_MEMORY_TAGS_CHARACTERS,
    ),
    occurred_at: nullableTimestamp(candidate.occurred_at, "Memory occurred_at"),
    expires_at: nullableTimestamp(candidate.expires_at, "Memory expires_at"),
    last_accessed_at: nullableTimestamp(
      candidate.last_accessed_at,
      "Memory last_accessed_at",
    ),
    access_count: candidate.access_count as number,
    created_at: timestamp(candidate.created_at, "Memory created_at"),
    updated_at: timestamp(candidate.updated_at, "Memory updated_at"),
  };
}

function parseReminderRecord(
  value: unknown,
  expectedSpaceId: string,
): Reminder {
  const candidate = record(value);
  if (
    !candidate || candidate.space_id !== expectedSpaceId ||
    !REMINDER_TRIGGER_TYPES.has(candidate.trigger_type as string) ||
    !REMINDER_STATUSES.has(candidate.status as string) ||
    !REMINDER_PRIORITIES.has(candidate.priority as string)
  ) {
    throw new TypeError("Invalid Reminder response record");
  }

  nullableReference(candidate.user_id, "Reminder user_id");
  return {
    id: boundedString(
      candidate.id,
      "Reminder id",
      MAX_MEMORY_REFERENCE_CHARACTERS,
    ),
    space_id: expectedSpaceId,
    content: boundedString(
      candidate.content,
      "Reminder content",
      MAX_REMINDER_CONTENT_CHARACTERS,
    ),
    context: nullableString(
      candidate.context,
      "Reminder context",
      MAX_REMINDER_CONTEXT_CHARACTERS,
    ),
    trigger_type: candidate.trigger_type as Reminder["trigger_type"],
    trigger_value: nullableString(
      candidate.trigger_value,
      "Reminder trigger_value",
      MAX_REMINDER_TRIGGER_VALUE_CHARACTERS,
    ),
    status: candidate.status as Reminder["status"],
    triggered_at: nullableTimestamp(
      candidate.triggered_at,
      "Reminder triggered_at",
    ),
    priority: candidate.priority as Reminder["priority"],
    created_at: timestamp(candidate.created_at, "Reminder created_at"),
    updated_at: timestamp(candidate.updated_at, "Reminder updated_at"),
  };
}

function uniqueRecords<T extends { id: string }>(records: T[], label: string) {
  if (new Set(records.map((item) => item.id)).size !== records.length) {
    throw new TypeError(`Duplicate ${label} ids`);
  }
  return records;
}

export function parseMemoriesListResponse(
  value: unknown,
  expectedSpaceId: string,
): Memory[] {
  const candidate = record(value);
  if (
    !candidate || !Array.isArray(candidate.memories) ||
    candidate.memories.length > MAX_MEMORY_RECORDS_PER_PAGE
  ) {
    throw new TypeError("Invalid Memories list response");
  }
  return uniqueRecords(
    candidate.memories.map((item) =>
      parseMemoryRecord(item, expectedSpaceId)
    ),
    "Memory",
  );
}

export function parseRemindersListResponse(
  value: unknown,
  expectedSpaceId: string,
): Reminder[] {
  const candidate = record(value);
  if (
    !candidate || !Array.isArray(candidate.reminders) ||
    candidate.reminders.length > MAX_MEMORY_RECORDS_PER_PAGE
  ) {
    throw new TypeError("Invalid Reminders list response");
  }
  return uniqueRecords(
    candidate.reminders.map((item) =>
      parseReminderRecord(item, expectedSpaceId)
    ),
    "Reminder",
  );
}

export function parseMemoryMutationResponse(
  value: unknown,
  expectedSpaceId: string,
  expectedId?: string,
): Memory {
  const memory = parseMemoryRecord(value, expectedSpaceId);
  if (expectedId !== undefined && memory.id !== expectedId) {
    throw new TypeError("Memory mutation response does not match the request");
  }
  return memory;
}

export function parseReminderMutationResponse(
  value: unknown,
  expectedSpaceId: string,
  expectedId?: string,
): Reminder {
  const reminder = parseReminderRecord(value, expectedSpaceId);
  if (expectedId !== undefined && reminder.id !== expectedId) {
    throw new TypeError("Reminder mutation response does not match the request");
  }
  return reminder;
}

export function parseMemoryDeleteResponse(value: unknown): void {
  const candidate = record(value);
  if (!candidate || candidate.success !== true) {
    throw new TypeError("Invalid Memory delete response");
  }
}
