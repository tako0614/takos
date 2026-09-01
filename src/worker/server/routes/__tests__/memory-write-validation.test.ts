import { expect, test } from "bun:test";
import {
  MAX_MEMORY_CONTENT_CHARACTERS,
  MAX_MEMORY_TAG_ITEMS,
  MAX_REMINDER_TRIGGER_VALUE_CHARACTERS,
} from "../../../shared/types/index.ts";
import {
  memoryCreateSchema,
  memoryListQuerySchema,
  memoryPatchSchema,
  reminderCreateSchema,
  reminderListQuerySchema,
  reminderPatchSchema,
} from "../memories/routes.ts";

test("Memory and Reminder writes are strict, bounded, and clearable", () => {
  expect(memoryCreateSchema.safeParse({
    type: "semantic",
    content: "Keep the product boundary explicit.",
    tags: ["architecture"],
    occurred_at: "2026-08-10T09:00:00.000Z",
  }).success).toBe(true);
  expect(memoryPatchSchema.safeParse({
    summary: null,
    category: null,
    tags: null,
    expires_at: null,
  }).success).toBe(true);
  expect(reminderCreateSchema.safeParse({
    content: "Review the evidence.",
    trigger_type: "time",
    trigger_value: "2026-08-11T09:00:00.000Z",
  }).success).toBe(true);
  expect(reminderPatchSchema.safeParse({
    context: null,
    trigger_value: null,
  }).success).toBe(true);

  expect(memoryCreateSchema.safeParse({
    type: "semantic",
    content: "valid",
    source: "forged-authority",
  }).success).toBe(false);
  expect(memoryCreateSchema.safeParse({
    type: "semantic",
    content: " ",
  }).success).toBe(false);
  expect(memoryCreateSchema.safeParse({
    type: "semantic",
    content: "x".repeat(MAX_MEMORY_CONTENT_CHARACTERS + 1),
  }).success).toBe(false);
  expect(memoryCreateSchema.safeParse({
    type: "semantic",
    content: "valid",
    tags: Array.from({ length: MAX_MEMORY_TAG_ITEMS + 1 }, () => "tag"),
  }).success).toBe(false);
  expect(memoryCreateSchema.safeParse({
    type: "semantic",
    content: "valid",
    occurred_at: "tomorrow",
  }).success).toBe(false);
  expect(memoryPatchSchema.safeParse({}).success).toBe(false);
  expect(reminderPatchSchema.safeParse({}).success).toBe(false);
  expect(reminderCreateSchema.safeParse({
    content: "valid",
    trigger_type: "time",
    trigger_value: "x".repeat(MAX_REMINDER_TRIGGER_VALUE_CHARACTERS + 1),
  }).success).toBe(false);
});

test("Memory list filters use current vocabularies and bounded pagination", () => {
  expect(memoryListQuerySchema.safeParse({
    type: "episode",
    limit: "100",
    offset: "0",
  }).success).toBe(true);
  expect(reminderListQuerySchema.safeParse({
    status: "completed",
    limit: "50",
  }).success).toBe(true);
  expect(memoryListQuerySchema.safeParse({ type: "invented" }).success).toBe(
    false,
  );
  expect(reminderListQuerySchema.safeParse({ status: "invented" }).success)
    .toBe(false);
  expect(memoryListQuerySchema.safeParse({ limit: "10garbage" }).success).toBe(
    false,
  );
  expect(memoryListQuerySchema.safeParse({ forged: "true" }).success).toBe(
    false,
  );
});
