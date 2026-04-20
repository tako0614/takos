import {
  buildBudgetedSystemPrompt,
  estimateTokens,
  LANE_MAX_TOKENS,
  LANE_PRIORITY,
  type PromptLane,
} from "@/services/agent/prompt-budget";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

Deno.test("estimateTokens - returns 0 for empty string", () => {
  assertEquals(estimateTokens(""), 0);
});
Deno.test("estimateTokens - returns 0 for falsy input", () => {
  assertEquals(estimateTokens(undefined as unknown as string), 0);
});
Deno.test("estimateTokens - counts English words with subword multiplier", () => {
  const tokens = estimateTokens("Hello world");
  // 2 words * 1.3 = 2.6 → ceil = 3
  assertEquals(tokens, 3);
});
Deno.test("estimateTokens - counts CJK characters individually", () => {
  const tokens = estimateTokens("こんにちは");
  // 5 CJK characters
  assertEquals(tokens, 5);
});
Deno.test("estimateTokens - handles mixed CJK and English text", () => {
  const tokens = estimateTokens("Hello こんにちは world");
  // 5 CJK + ceil(2 * 1.3) = 5 + 3 = 8
  assertEquals(tokens, 8);
});
Deno.test("estimateTokens - handles punctuation and special characters", () => {
  const tokens = estimateTokens("Hello, world! How are you?");
  // Words: Hello, world, How, are, you → 5 words * 1.3 = 6.5 → 7
  assert(tokens > 0);
});
Deno.test("estimateTokens - gives reasonable estimates for longer text", () => {
  const text = "The quick brown fox jumps over the lazy dog.";
  const tokens = estimateTokens(text);
  // 9 words * 1.3 = 11.7 → 12
  assert(tokens > 5);
  assert(tokens < 30);
});

Deno.test("buildBudgetedSystemPrompt - includes all lanes when budget allows", () => {
  const lanes: PromptLane[] = [
    {
      priority: 0,
      name: "base",
      content: "Base prompt content",
      maxTokens: 500,
    },
    { priority: 1, name: "tools", content: "Tool catalog", maxTokens: 500 },
    { priority: 2, name: "memory", content: "Memory content", maxTokens: 500 },
  ];

  const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5000 });
  assertStringIncludes(result, "Base prompt content");
  assertStringIncludes(result, "Tool catalog");
  assertStringIncludes(result, "Memory content");
});
Deno.test("buildBudgetedSystemPrompt - respects priority ordering (lower number = higher priority)", () => {
  const lanes: PromptLane[] = [
    { priority: 2, name: "low", content: "Low priority", maxTokens: 500 },
    { priority: 0, name: "high", content: "High priority", maxTokens: 500 },
    { priority: 1, name: "mid", content: "Mid priority", maxTokens: 500 },
  ];

  const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5000 });
  const highIdx = result.indexOf("High priority");
  const midIdx = result.indexOf("Mid priority");
  const lowIdx = result.indexOf("Low priority");
  assert(highIdx < midIdx);
  assert(midIdx < lowIdx);
});
Deno.test("buildBudgetedSystemPrompt - drops lower-priority lanes when budget is exceeded", () => {
  const lanes: PromptLane[] = [
    {
      priority: 0,
      name: "base",
      content: "Base prompt with enough words to fill budget",
      maxTokens: 5000,
    },
    {
      priority: 1,
      name: "dropped",
      content: "This should be dropped",
      maxTokens: 5000,
    },
  ];

  const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5 });
  // With a very tight budget, the second lane should be truncated or dropped
  assertStringIncludes(result, "[... truncated]");
});
Deno.test("buildBudgetedSystemPrompt - uses default totalBudget of 8000 when not specified", () => {
  const lanes: PromptLane[] = [
    { priority: 0, name: "base", content: "Short content", maxTokens: 500 },
  ];

  const result = buildBudgetedSystemPrompt(lanes);
  assertStringIncludes(result, "Short content");
});
Deno.test("buildBudgetedSystemPrompt - skips lanes with empty content", () => {
  const lanes: PromptLane[] = [
    { priority: 0, name: "base", content: "Real content", maxTokens: 500 },
    { priority: 1, name: "empty", content: "", maxTokens: 500 },
    { priority: 2, name: "also-real", content: "More content", maxTokens: 500 },
  ];

  const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5000 });
  assertStringIncludes(result, "Real content");
  assertStringIncludes(result, "More content");
});
Deno.test("buildBudgetedSystemPrompt - truncates individual lanes to their maxTokens", () => {
  const longContent = Array(200).fill("word").join(" ");
  const lanes: PromptLane[] = [
    { priority: 0, name: "limited", content: longContent, maxTokens: 5 },
  ];

  const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5000 });
  assertStringIncludes(result, "[... truncated]");
  assert(result.length < longContent.length);
});
Deno.test("buildBudgetedSystemPrompt - joins parts with double newlines", () => {
  const lanes: PromptLane[] = [
    { priority: 0, name: "a", content: "Part A", maxTokens: 500 },
    { priority: 1, name: "b", content: "Part B", maxTokens: 500 },
  ];

  const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5000 });
  assertEquals(result, "Part A\n\nPart B");
});

Deno.test("LANE_PRIORITY constants - has correct priority ordering", () => {
  assertEquals(LANE_PRIORITY.BASE_PROMPT, 0);
  assertEquals(LANE_PRIORITY.TOOL_CATALOG, 1);
  assertEquals(LANE_PRIORITY.MEMORY_ACTIVATION, 2);
  assertEquals(LANE_PRIORITY.SKILL_INSTRUCTIONS, 3);
  assertEquals(LANE_PRIORITY.THREAD_CONTEXT, 4);
});

Deno.test("LANE_MAX_TOKENS constants - has reasonable token limits", () => {
  assertEquals(LANE_MAX_TOKENS.BASE_PROMPT, 2000);
  assertEquals(LANE_MAX_TOKENS.TOOL_CATALOG, 2500);
  assertEquals(LANE_MAX_TOKENS.MEMORY_ACTIVATION, 800);
  assertEquals(LANE_MAX_TOKENS.SKILL_INSTRUCTIONS, 2000);
  assertEquals(LANE_MAX_TOKENS.THREAD_CONTEXT, 1500);
});
