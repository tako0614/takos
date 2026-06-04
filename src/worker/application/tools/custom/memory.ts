import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import type {
  MemoryType,
  ReminderPriority,
  ReminderTriggerType,
} from "../../../shared/types/index.ts";
import {
  bumpMemoryAccess,
  createMemory,
  createReminder,
  searchMemories,
} from "../../services/memory/memories.ts";

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
      },
      category: {
        type: "string",
        description:
          'Category for organization (optional, e.g., "project", "user", "workflow")',
      },
    },
    required: ["content", "type"],
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
      },
      type: {
        type: "string",
        description: "Filter by memory type (optional)",
        enum: ["episode", "semantic", "procedural"],
      },
      limit: {
        type: "number",
        description: "Maximum number of results (optional, default: 10)",
      },
    },
    required: ["query"],
  },
};

export const SET_REMINDER: ToolDefinition = {
  name: "set_reminder",
  description:
    "Set a reminder for future. Can be time-based, condition-based, or context-based.",
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
      },
      priority: {
        type: "string",
        description: 'Priority level (optional, default: "normal")',
        enum: ["low", "normal", "high", "critical"],
      },
    },
    required: ["content", "trigger_type", "trigger_value"],
  },
};

const MAX_MEMORY_CONTENT_SIZE = 100_000; // 100KB max per memory entry
const MAX_MEMORY_CATEGORY_SIZE = 1000; // 1000 chars max for category

export const rememberHandler: ToolHandler = async (args, context) => {
  const content = args.content as string;
  const type = args.type as MemoryType;
  const importance = (args.importance as number) || 0.5;
  const category = args.category as string | undefined;

  if (content.length > MAX_MEMORY_CONTENT_SIZE) {
    throw new Error(
      `Memory content too large: ${content.length} chars (max: ${MAX_MEMORY_CONTENT_SIZE})`,
    );
  }

  if (category && category.length > MAX_MEMORY_CATEGORY_SIZE) {
    throw new Error(
      `Memory category too long: ${category.length} chars (max: ${MAX_MEMORY_CATEGORY_SIZE})`,
    );
  }

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

  let result = `Remembered (${type}): ${content.substring(0, 50)}${
    content.length > 50 ? "..." : ""
  }`;
  if (context.sessionId) {
    result += ` [session: ${context.sessionId.slice(0, 8)}...]`;
  }
  return result;
};

export const recallHandler: ToolHandler = async (args, context) => {
  const query = args.query as string;
  const type = args.type as MemoryType | undefined;
  const limit = Math.min((args.limit as number) || 10, 50);

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

  await bumpMemoryAccess(
    context.db,
    memoryResults.map((m) => m.id),
  );

  const lines = memoryResults.map((m) => {
    const typeEmoji = m.type === "episode"
      ? "📅"
      : m.type === "semantic"
      ? "💡"
      : "📋";
    const categoryStr = m.category ? ` [${m.category}]` : "";
    return `${typeEmoji}${categoryStr} ${m.content.substring(0, 100)}${
      m.content.length > 100 ? "..." : ""
    }`;
  });

  return `Found ${memoryResults.length} memories:\n\n${lines.join("\n\n")}`;
};

export const setReminderHandler: ToolHandler = async (args, context) => {
  const content = args.content as string;
  const triggerType = args.trigger_type as ReminderTriggerType;
  const triggerValue = args.trigger_value as string;
  const priority = (args.priority as ReminderPriority) || "normal";

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

  let result =
    `Reminder set (${priority}): "${content}" - ${triggerDescription}`;
  if (context.sessionId) {
    result += ` [session: ${context.sessionId.slice(0, 8)}...]`;
  }
  return result;
};

export const MEMORY_TOOLS: ToolDefinition[] = [
  REMEMBER,
  RECALL,
  SET_REMINDER,
];

export const MEMORY_HANDLERS: Record<string, ToolHandler> = {
  remember: rememberHandler,
  recall: recallHandler,
  set_reminder: setReminderHandler,
};
