import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import { defineTools } from "./define-tools.ts";
import type {
  MemoryType,
  ReminderPriority,
  ReminderTriggerType,
} from "../../../shared/types/index.ts";
import {
  MAX_MEMORY_CATEGORY_CHARACTERS,
  MAX_MEMORY_CONTENT_CHARACTERS,
  MAX_MEMORY_SEARCH_QUERY_CHARACTERS,
  MAX_REMINDER_CONTENT_CHARACTERS,
  MAX_REMINDER_TRIGGER_VALUE_CHARACTERS,
} from "../../../shared/types/index.ts";
import {
  bumpMemoryAccess,
  createMemory,
  createReminder,
  explicitMemoryResourceReference,
  searchMemories,
} from "../../services/memory/memories.ts";
import { appendRunContextResourceReferences } from "../../services/runs/run-authority.ts";

export const REMEMBER: ToolDefinition = {
  name: "remember",
  description:
    "Store important information in memory for future reference. Use this to save facts, procedures, or experiences that should be remembered.",
  category: "memory",
  namespace: "memory",
  family: "memory.core",
  risk_level: "none",
  side_effects: true,
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The information to remember",
        minLength: 1,
        maxLength: MAX_MEMORY_CONTENT_CHARACTERS,
      },
      type: {
        type: "string",
        description:
          'Memory type: "episode" (experiences/events), "semantic" (facts/knowledge), "procedural" (methods/preferences)',
        enum: ["episode", "semantic", "procedural"],
      },
      importance: {
        type: "number",
        description: "Importance score from 0 to 1 (optional, default: 0.5)",
        minimum: 0,
        maximum: 1,
      },
      category: {
        type: "string",
        description:
          'Category for organization (optional, e.g., "project", "user", "workflow")',
        maxLength: MAX_MEMORY_CATEGORY_CHARACTERS,
      },
    },
    required: ["content", "type"],
    additionalProperties: false,
  },
};

export const RECALL: ToolDefinition = {
  name: "recall",
  description:
    "Search memories for relevant information. Returns matching memories based on query.",
  category: "memory",
  namespace: "memory",
  family: "memory.core",
  risk_level: "none",
  side_effects: false,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query to find relevant memories",
        minLength: 1,
        maxLength: MAX_MEMORY_SEARCH_QUERY_CHARACTERS,
      },
      type: {
        type: "string",
        description: "Filter by memory type (optional)",
        enum: ["episode", "semantic", "procedural"],
      },
      limit: {
        type: "integer",
        description: "Maximum number of results (optional, default: 10)",
        minimum: 1,
        maximum: 50,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const SET_REMINDER: ToolDefinition = {
  name: "set_reminder",
  description:
    "Create a reminder record for the user to review later. This stores the trigger metadata but does not promise automatic notification or condition evaluation.",
  category: "memory",
  namespace: "memory",
  family: "memory.core",
  risk_level: "none",
  side_effects: true,
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "What to remind about",
        minLength: 1,
        maxLength: MAX_REMINDER_CONTENT_CHARACTERS,
      },
      trigger_type: {
        type: "string",
        description:
          'When to trigger: "time" (at specific time), "condition" (when condition is met), "context" (when topic comes up)',
        enum: ["time", "condition", "context"],
      },
      trigger_value: {
        type: "string",
        description:
          "Trigger details - ISO timestamp for time, condition description, or context keywords",
        minLength: 1,
        maxLength: MAX_REMINDER_TRIGGER_VALUE_CHARACTERS,
      },
      priority: {
        type: "string",
        description: 'Priority level (optional, default: "normal")',
        enum: ["low", "normal", "high", "critical"],
      },
    },
    required: ["content", "trigger_type", "trigger_value"],
    additionalProperties: false,
  },
};

function requiredBoundedString(
  value: unknown,
  label: string,
  maxCharacters: number,
): string {
  if (
    typeof value !== "string" || !value.trim() ||
    value.length > maxCharacters
  ) {
    throw new Error(
      `${label} must be non-empty and at most ${maxCharacters} characters`,
    );
  }
  return value;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxCharacters: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxCharacters) {
    throw new Error(`${label} must be at most ${maxCharacters} characters`);
  }
  return value;
}

export const rememberHandler: ToolHandler = async (args, context) => {
  const content = requiredBoundedString(
    args.content,
    "Memory content",
    MAX_MEMORY_CONTENT_CHARACTERS,
  );
  if (!(["episode", "semantic", "procedural"] as unknown[]).includes(args.type)) {
    throw new Error("Invalid Memory type");
  }
  const type = args.type as MemoryType;
  const importance = args.importance === undefined ? 0.5 : args.importance;
  if (
    typeof importance !== "number" || !Number.isFinite(importance) ||
    importance < 0 || importance > 1
  ) throw new Error("Memory importance must be between 0 and 1");
  const category = optionalBoundedString(
    args.category,
    "Memory category",
    MAX_MEMORY_CATEGORY_CHARACTERS,
  );

  await createMemory(context.db, {
    spaceId: context.spaceId,
    userId: context.userId,
    threadId: context.threadId,
    type,
    category: category || null,
    content,
    summary: content.length > 100 ? content.substring(0, 100) + "..." : content,
    importance,
  });

  return `Remembered (${type}): ${content.substring(0, 50)}${
    content.length > 50 ? "..." : ""
  }`;
};

export const recallHandler: ToolHandler = async (args, context) => {
  const query = requiredBoundedString(
    args.query,
    "Memory search query",
    MAX_MEMORY_SEARCH_QUERY_CHARACTERS,
  );
  if (
    args.type !== undefined &&
    !(["episode", "semantic", "procedural"] as unknown[]).includes(args.type)
  ) throw new Error("Invalid Memory type");
  const type = args.type as MemoryType | undefined;
  const requestedLimit = args.limit ?? 10;
  if (
    typeof requestedLimit !== "number" ||
    !Number.isSafeInteger(requestedLimit) || requestedLimit < 1 ||
    requestedLimit > 50
  ) throw new Error("Memory search limit must be an integer from 1 to 50");
  const limit = requestedLimit;

  const memoryResults = await searchMemories(
    context.db,
    context.spaceId,
    query,
    type,
    limit,
  );

  if (memoryResults.length === 0) {
    return `No memories found for: "${query}"`;
  }

  if (!context.runAuthority || !context.toolCallId) {
    throw new Error("Memory recall requires exact RunContext authority");
  }
  const references = await Promise.all(
    memoryResults.map(explicitMemoryResourceReference),
  );
  await appendRunContextResourceReferences({
    db: context.db,
    runId: context.runId,
    expectedAttestation: context.runAuthority.attestation,
    activationEventId: `tool_call:${context.toolCallId}`,
    references,
  });

  await bumpMemoryAccess(
    context.db,
    memoryResults.map((m) => m.id),
  );

  const lines = memoryResults.map((m) => {
    const typeEmoji =
      m.type === "episode" ? "📅" : m.type === "semantic" ? "💡" : "📋";
    const categoryStr = m.category ? ` [${m.category}]` : "";
    return `${typeEmoji}${categoryStr} ${m.content.substring(0, 100)}${
      m.content.length > 100 ? "..." : ""
    }`;
  });

  return `Found ${memoryResults.length} memories:\n\n${lines.join("\n\n")}`;
};

export const setReminderHandler: ToolHandler = async (args, context) => {
  const content = requiredBoundedString(
    args.content,
    "Reminder content",
    MAX_REMINDER_CONTENT_CHARACTERS,
  );
  if (
    !(["time", "condition", "context"] as unknown[]).includes(
      args.trigger_type,
    )
  ) throw new Error("Invalid Reminder trigger type");
  const triggerType = args.trigger_type as ReminderTriggerType;
  const triggerValue = requiredBoundedString(
    args.trigger_value,
    "Reminder trigger value",
    MAX_REMINDER_TRIGGER_VALUE_CHARACTERS,
  );
  const requestedPriority = args.priority ?? "normal";
  if (
    !(["low", "normal", "high", "critical"] as unknown[]).includes(
      requestedPriority,
    )
  ) {
    throw new Error("Invalid Reminder priority");
  }
  const priority = requestedPriority as ReminderPriority;

  if (triggerType === "time") {
    const triggerDate = new Date(triggerValue);
    if (isNaN(triggerDate.getTime())) {
      throw new Error(
        'Invalid time format. Use ISO 8601 format (e.g., "2024-12-31T12:00:00Z")',
      );
    }
    if (triggerDate <= new Date()) {
      throw new Error("Trigger time must be in the future");
    }
  }

  await createReminder(context.db, {
    spaceId: context.spaceId,
    userId: context.userId,
    content,
    triggerType,
    triggerValue,
    priority,
  });

  let triggerDescription: string;
  switch (triggerType) {
    case "time":
      triggerDescription = `at ${triggerValue}`;
      break;
    case "condition":
      triggerDescription = `when: ${triggerValue}`;
      break;
    case "context":
      triggerDescription = `context: ${triggerValue}`;
      break;
  }

  return `Reminder set (${priority}): "${content}" - ${triggerDescription}`;
};

export const { tools: MEMORY_TOOLS, handlers: MEMORY_HANDLERS } = defineTools([
  [REMEMBER, rememberHandler],
  [RECALL, recallHandler],
  [SET_REMINDER, setReminderHandler],
]);
