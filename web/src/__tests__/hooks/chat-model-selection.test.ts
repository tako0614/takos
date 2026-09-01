import { expect, test } from "bun:test";
import {
  isSelectableChatModel,
  readChatModelSelection,
} from "../../hooks/chat-model-selection.ts";

function response() {
  return {
    ai_model: "gpt-5.5",
    model: "gpt-5.5",
    model_backend: "openai",
    available_models: {
      openai: [
        { id: "gpt-5.5", name: "GPT-5.5", source: "models_api" },
        { id: "takosumi/default", name: "Takosumi Default" },
        { id: "retired", name: "Retired", disabled: true },
      ],
      anthropic: [],
      google: [],
    },
    catalog_status: "fresh",
    token_limit: 128_000,
  };
}

test("Chat model selection uses only the active operator catalog", () => {
  const projected = readChatModelSelection(response(), "takosumi/default");

  expect(projected.models.map((model) => model.id)).toEqual([
    "gpt-5.5",
    "takosumi/default",
    "retired",
  ]);
  expect(projected.selectedModel).toBe("takosumi/default");
  expect(isSelectableChatModel(projected.models, "takosumi/default")).toBe(
    true,
  );
  expect(isSelectableChatModel(projected.models, "retired")).toBe(false);
});

test("Chat model selection falls back only to the validated Workspace default", () => {
  expect(readChatModelSelection(response(), "retired").selectedModel).toBe(
    "gpt-5.5",
  );
  expect(readChatModelSelection(response(), "client-only").selectedModel).toBe(
    "gpt-5.5",
  );
  expect(() =>
    readChatModelSelection({
      ...response(),
      available_models: {
        openai: [],
        anthropic: [],
        google: [],
      },
    })
  ).toThrow("Selected model is not available");
});
