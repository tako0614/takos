import {
  DEFAULT_MODEL_ID,
  FALLBACK_MODELS,
  getModelLabel,
  MODEL_OPTIONS,
} from "../../lib/modelCatalog.ts";

import { assertEquals } from "jsr:@std/assert";

Deno.test("frontend model catalog - keeps fallback options on OpenAI models only", () => {
  assertEquals(DEFAULT_MODEL_ID, "gpt-5.4-nano");
  assertEquals(FALLBACK_MODELS.map((model) => model.id), [
    "gpt-5.4-nano",
    "gpt-5.4-mini",
    "gpt-5.4",
  ]);
});
Deno.test("frontend model catalog - lists all supported models", () => {
  assertEquals(MODEL_OPTIONS.map((m) => m.id), [
    "gpt-5.4-nano",
    "gpt-5.4-mini",
    "gpt-5.4",
  ]);
});
Deno.test("frontend model catalog - returns model labels", () => {
  assertEquals(getModelLabel("gpt-5.4-nano"), "GPT-5.4 Nano");
  assertEquals(getModelLabel("gpt-5.4-mini"), "GPT-5.4 Mini");
  assertEquals(getModelLabel("gpt-5.4"), "GPT-5.4");
  assertEquals(getModelLabel("unknown-model"), "unknown-model");
});
