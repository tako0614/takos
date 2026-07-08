import {
  deepStrictEqual as assertEquals,
  strictEqual as assertStrictEquals,
} from "node:assert/strict";
import { test } from "bun:test";
import {
  ensureModelOption,
  getModelsForModelBackend,
} from "../../../views/agent/work/task-work-utils.ts";

test("agent task model helpers preserve dynamic catalog metadata", () => {
  const options = getModelsForModelBackend({
    ai_model: "retired/model",
    model_backend: "openai",
    available_models: {
      openai: [
        {
          id: "retired/model",
          name: "Retired Model",
          description: "Saved model is not in the current model catalog",
          source: "fallback",
          disabled: true,
        },
        { id: "gpt-5.5", name: "GPT-5.5", source: "models_api" },
      ],
      anthropic: [],
      google: [],
    },
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
      description: undefined,
      source: "models_api",
      disabled: undefined,
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
