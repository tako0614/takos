import { afterEach, test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import {
  analyzeTask,
  taskAnalysisDeps,
  VALID_PLAN_TYPES,
} from "../task-analysis.ts";

const originalLLMClient = taskAnalysisDeps.LLMClient;

afterEach(() => {
  taskAnalysisDeps.LLMClient = originalLLMClient;
});

function stubLLM(content: string | (() => never)): void {
  taskAnalysisDeps.LLMClient = class {
    constructor(_config: unknown) {}
    async chat(): Promise<{ content: string }> {
      if (typeof content === "function") content();
      return { content };
    }
    // deno-lint-ignore no-explicit-any
  } as any;
}

const ctx = {
  spaceId: "s1",
  userId: "u1",
  tools: ["search", "edit"],
  apiKey: "k",
};

test("analyzeTask parses a valid plan and applies defaults", async () => {
  stubLLM(JSON.stringify({ type: "code_change", commitMessage: "wip" }));

  const plan = await analyzeTask("change a file", ctx);

  assertEquals(plan.type, "code_change");
  assertEquals(plan.commitMessage, "wip");
  // Defaults filled in by analyzeTask.
  assertEquals(plan.tools, []);
  assertEquals(plan.needsRepo, false);
  assertEquals(plan.needsRuntime, false);
  assertEquals(plan.usePR, false);
  assertEquals(plan.needsReview, false);
  assertEquals(plan.reviewType, "self");
});

test("analyzeTask coerces an unknown plan type to conversation", async () => {
  stubLLM(JSON.stringify({ type: "bogus", tools: ["x"] }));

  const plan = await analyzeTask("hello", ctx);

  assertEquals(VALID_PLAN_TYPES.has("bogus"), false);
  assertEquals(plan.type, "conversation");
  assertEquals(plan.tools, ["x"]);
});

test("analyzeTask strips a ```json fence before parsing", async () => {
  stubLLM('```json\n{"type":"tool_only"}\n```');

  const plan = await analyzeTask("search the web", ctx);

  assertEquals(plan.type, "tool_only");
});

test("analyzeTask falls back to conversation on invalid JSON", async () => {
  stubLLM("not json at all");

  const plan = await analyzeTask("anything", ctx);

  assertEquals(plan.type, "conversation");
  assertEquals(plan.tools, []);
  assertEquals(plan.reasoning, "Analysis failed, defaulting to conversation");
});

test("analyzeTask falls back to conversation when the LLM throws", async () => {
  stubLLM(() => {
    throw new Error("backend exploded");
  });

  const plan = await analyzeTask("anything", ctx);

  assertEquals(plan.type, "conversation");
  assertEquals(plan.reasoning, "Analysis failed, defaulting to conversation");
});
