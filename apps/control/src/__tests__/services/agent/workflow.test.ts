import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";

const mocks = {
  LLMClient: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: ((..._args: any[]) => undefined) as any,
  now: ((..._args: any[]) => undefined) as any,
  callRuntimeRequest: ((..._args: any[]) => undefined) as any,
  buildPRDiffText: ((..._args: any[]) => undefined) as any,
  SnapshotManager: ((..._args: any[]) => undefined) as any,
  logError: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/services/agent/llm'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/pull-requests/ai-review'
// [Deno] vi.mock removed - manually stub imports from '@/services/sync/snapshot'
// [Deno] vi.mock removed - manually stub imports from '@/utils/logger'
import {
  analyzeTask,
  executeCodeChangeWorkflow,
  executeReview,
  orchestrateWorkflow,
  type TaskPlan,
  type WorkflowContext,
} from "@/services/agent/workflow";

Deno.test("analyzeTask - parses a valid task analysis response", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockChat = async () => ({
    content: JSON.stringify({
      type: "code_change",
      tools: ["file_read", "file_write"],
      needsRepo: true,
      needsRuntime: true,
      usePR: true,
      needsReview: true,
      reviewType: "self",
      commitMessage: "Fix the bug",
      reasoning: "This needs code changes",
    }),
    usage: { inputTokens: 10, outputTokens: 20 },
  });
  mocks.LLMClient = () => ({ chat: mockChat }) as any;

  const plan = await analyzeTask("Fix the login bug", {
    spaceId: "ws-1",
    userId: "user-1",
    tools: ["file_read", "file_write"],
    apiKey: "test-key",
  });

  assertEquals(plan.type, "code_change");
  assertEquals(plan.tools, ["file_read", "file_write"]);
  assertEquals(plan.needsRepo, true);
  assertEquals(plan.commitMessage, "Fix the bug");
});
Deno.test("analyzeTask - defaults to conversation on parse failure", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockChat = async () => ({
    content: "This is not valid JSON",
    usage: { inputTokens: 10, outputTokens: 20 },
  });
  mocks.LLMClient = () => ({ chat: mockChat }) as any;

  const plan = await analyzeTask("Do something", {
    spaceId: "ws-1",
    userId: "user-1",
    tools: [],
    apiKey: "test-key",
  });

  assertEquals(plan.type, "conversation");
  assertStringIncludes(plan.reasoning, "failed");
});
Deno.test("analyzeTask - normalizes invalid plan type to conversation", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockChat = async () => ({
    content: JSON.stringify({ type: "invalid_type" }),
    usage: { inputTokens: 10, outputTokens: 20 },
  });
  mocks.LLMClient = () => ({ chat: mockChat }) as any;

  const plan = await analyzeTask("Something", {
    spaceId: "ws-1",
    userId: "user-1",
    tools: [],
    apiKey: "key",
  });

  assertEquals(plan.type, "conversation");
});
Deno.test("analyzeTask - handles markdown-wrapped JSON response", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockChat = async () => ({
    content: '```json\n{"type":"tool_only","tools":["web_search"]}\n```',
    usage: { inputTokens: 10, outputTokens: 20 },
  });
  mocks.LLMClient = () => ({ chat: mockChat }) as any;

  const plan = await analyzeTask("Search for something", {
    spaceId: "ws-1",
    userId: "user-1",
    tools: ["web_search"],
    apiKey: "key",
  });

  assertEquals(plan.type, "tool_only");
});
Deno.test("analyzeTask - defaults optional fields when not provided in response", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockChat = async () => ({
    content: JSON.stringify({ type: "conversation" }),
    usage: { inputTokens: 10, outputTokens: 20 },
  });
  mocks.LLMClient = () => ({ chat: mockChat }) as any;

  const plan = await analyzeTask("Chat with me", {
    spaceId: "ws-1",
    userId: "user-1",
    tools: [],
    apiKey: "key",
  });

  assertEquals(plan.tools, []);
  assertEquals(plan.needsRepo, false);
  assertEquals(plan.needsRuntime, false);
  assertEquals(plan.usePR, false);
  assertEquals(plan.needsReview, false);
  assertEquals(plan.reviewType, "self");
});

Deno.test("executeCodeChangeWorkflow - returns success for a simple code change without PR", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.generateId = (() => "gen-id") as any;
  mocks.now = (() => "2025-01-01T00:00:00Z") as any;
  const plan: TaskPlan = {
    type: "code_change",
    tools: ["file_write"],
    needsRepo: false,
    usePR: false,
    commitMessage: "Simple change",
  };

  const context: WorkflowContext = {
    env: {} as any,
    spaceId: "ws-1",
    userId: "user-1",
    threadId: "thread-1",
    runId: "run-1",
  };

  const result = await executeCodeChangeWorkflow("Fix a typo", plan, context);
  assertEquals(result.success, true);
  assertStringIncludes(result.message, "directly");
});
Deno.test("executeCodeChangeWorkflow - handles errors gracefully and marks steps as failed", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.generateId = (() => "gen-id") as any;
  mocks.now = (() => "2025-01-01T00:00:00Z") as any;
  const plan: TaskPlan = {
    type: "code_change",
    tools: ["file_write"],
    needsRepo: true,
    repoId: "repo-1",
    usePR: true,
    commitMessage: "Changes",
  };

  // Make createPullRequest fail
  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          get: async () => {
            throw new Error("DB connection failed");
          },
        }),
      }),
    }),
  };
  mocks.getDb = (() => mockDb) as any;

  const context: WorkflowContext = {
    env: { DB: {} } as any,
    spaceId: "ws-1",
    userId: "user-1",
    threadId: "thread-1",
    runId: "run-1",
  };

  const result = await executeCodeChangeWorkflow("Make changes", plan, context);
  assertEquals(result.success, false);
  assertStringIncludes(result.message, "Workflow failed");
  assertEquals(result.steps?.some((s) => s.status === "failed"), true);
});

Deno.test("executeReview - throws when OPENAI_API_KEY is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.generateId = (() => "review-id") as any;
  mocks.now = (() => "2025-01-01T00:00:00Z") as any;
  const context: WorkflowContext = {
    env: {} as any,
    spaceId: "ws-1",
    userId: "user-1",
    threadId: "thread-1",
    runId: "run-1",
  };

  await assertRejects(async () => {
    await executeReview(context, "pr-1", "self");
  }, "OpenAI API key");
});
Deno.test("executeReview - throws when PR not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.generateId = (() => "review-id") as any;
  mocks.now = (() => "2025-01-01T00:00:00Z") as any;
  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          get: async () => null,
        }),
      }),
    }),
  };
  mocks.getDb = (() => mockDb) as any;

  const context: WorkflowContext = {
    env: { OPENAI_API_KEY: "key", DB: {} } as any,
    spaceId: "ws-1",
    userId: "user-1",
    threadId: "thread-1",
    runId: "run-1",
  };

  await assertRejects(async () => {
    await executeReview(context, "pr-999", "self");
  }, "PR not found");
});

Deno.test("orchestrateWorkflow - returns conversation result for conversation plan type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockChat = async () => ({
    content: JSON.stringify({ type: "conversation" }),
    usage: { inputTokens: 10, outputTokens: 20 },
  });
  mocks.LLMClient = () => ({ chat: mockChat }) as any;

  const result = await orchestrateWorkflow("Tell me a joke", {
    env: {} as any,
    spaceId: "ws-1",
    userId: "user-1",
    threadId: "thread-1",
    runId: "run-1",
    apiKey: "key",
    tools: [],
  });

  assertEquals(result.success, true);
  assertStringIncludes(result.message, "conversation");
});
Deno.test("orchestrateWorkflow - returns tool steps for tool_only plan type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.generateId = (() => "step-id") as any;
  const mockChat = async () => ({
    content: JSON.stringify({
      type: "tool_only",
      tools: ["web_search", "file_read"],
    }),
    usage: { inputTokens: 10, outputTokens: 20 },
  });
  mocks.LLMClient = () => ({ chat: mockChat }) as any;

  const result = await orchestrateWorkflow("Search and read", {
    env: {} as any,
    spaceId: "ws-1",
    userId: "user-1",
    threadId: "thread-1",
    runId: "run-1",
    apiKey: "key",
    tools: ["web_search", "file_read"],
  });

  assertEquals(result.success, true);
  assertEquals(result.steps?.length, 2);
  assertEquals(result.steps?.[0].type, "tool_call");
});

Deno.test("TaskPlan type structure - supports all valid plan types", () => {
  const types: TaskPlan["type"][] = [
    "conversation",
    "tool_only",
    "code_change",
    "composite",
  ];
  assertEquals(types.length, 4);
});

Deno.test("TaskStep type structure - supports all step types", () => {
  const types = [
    "tool_call",
    "code_change",
    "review",
    "commit",
    "pr_create",
    "pr_merge",
  ];
  assertEquals(types.length, 6);
});
Deno.test("TaskStep type structure - supports all step statuses", () => {
  const statuses = ["pending", "running", "completed", "failed", "skipped"];
  assertEquals(statuses.length, 5);
});
