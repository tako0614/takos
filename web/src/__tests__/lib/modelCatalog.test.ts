import { deepStrictEqual as assertEquals } from "node:assert/strict";
import {
  DEFAULT_MODEL_ID,
  FALLBACK_MODELS,
  getModelLabel,
  MODEL_OPTIONS,
} from "../../lib/modelCatalog.ts";
import { test } from "bun:test";

test("frontend model catalog - keeps fallback options on OpenAI-compatible aliases", () => {
  assertEquals(DEFAULT_MODEL_ID, "gpt-5.5");
  assertEquals(
    FALLBACK_MODELS.map((model) => model.id),
    ["gpt-5.5", "takosumi/default", "deepseek/chat", "zai/glm", "gemini/chat"],
  );
});
test("frontend model catalog - lists all supported models", () => {
  assertEquals(
    MODEL_OPTIONS.map((m) => m.id),
    ["gpt-5.5", "takosumi/default", "deepseek/chat", "zai/glm", "gemini/chat"],
  );
});
test("frontend model catalog - returns model labels", () => {
  assertEquals(getModelLabel("gpt-5.5"), "GPT-5.5");
  assertEquals(getModelLabel("takosumi/default"), "Takosumi Default");
  assertEquals(getModelLabel("unknown-model"), "unknown-model");
});
