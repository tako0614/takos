import {
  deepStrictEqual as assertEquals,
  strictEqual as assertStrictEquals,
} from "node:assert/strict";
import { test } from "bun:test";
import {
  canStartAgentTask,
  ensureModelOption,
  getModelsForModelBackend,
  parsePlan,
} from "../../../views/agent/work/task-work-utils.ts";

test("agent task model helpers preserve dynamic catalog metadata", () => {
  const options = getModelsForModelBackend({
    model: "gpt-5.5",
    modelBackend: "openai",
    availableModels: {
      openai: [
        {
          id: "retired/model",
          label: "Retired Model",
          description: "Saved model is not in the current model catalog",
          source: "fallback",
          disabled: true,
        },
        { id: "gpt-5.5", label: "GPT-5.5", source: "models_api" },
      ],
      anthropic: [],
      google: [],
    },
    catalogStatus: "fresh",
    tokenLimit: 112000,
  });

  assertEquals(options, [
    {
      id: "retired/model",
      label: "Retired Model",
      description: "Saved model is not in the current model catalog",
      source: "fallback",
      disabled: true,
    },
    {
      id: "gpt-5.5",
      label: "GPT-5.5",
      source: "models_api",
    },
  ]);
});

test("agent task model helpers add missing current model as disabled", () => {
  const options = ensureModelOption(
    [{ id: "gpt-5.5", label: "GPT-5.5" }],
    "legacy/model",
  );

  assertStrictEquals(options[0].id, "legacy/model");
  assertStrictEquals(options[0].disabled, true);
});

test("agent tasks reuse active runs instead of offering a duplicate start", () => {
  const base = { status: "planned" as const, latest_run: null };
  assertStrictEquals(canStartAgentTask(base), true);
  assertStrictEquals(canStartAgentTask({
    ...base,
    status: "in_progress",
    latest_run: {
      run_id: "run_active",
      status: "running",
      agent_type: "default",
      started_at: null,
      completed_at: null,
      created_at: "2026-08-09T00:00:00.000Z",
      error: null,
      artifact_count: 0,
    },
  }), false);
  assertStrictEquals(canStartAgentTask({
    ...base,
    status: "failed",
    latest_run: {
      run_id: "run_failed",
      status: "failed",
      agent_type: "default",
      started_at: null,
      completed_at: "2026-08-09T00:00:01.000Z",
      created_at: "2026-08-09T00:00:00.000Z",
      error: "failed",
      artifact_count: 0,
    },
  }), true);
});

test("agent task plan parsing rejects malformed persisted data", () => {
  assertEquals(parsePlan(JSON.stringify({
    type: "tool_only",
    tools: ["search", "search"],
  })), {
    type: "tool_only",
    tools: ["search"],
    needsRepo: false,
    needsRuntime: false,
    usePR: false,
    needsReview: false,
    reviewType: "self",
  });
  assertStrictEquals(parsePlan(JSON.stringify({
    type: "tool_only",
    tools: "shell",
  })), null);
  assertStrictEquals(parsePlan("not json"), null);
});
