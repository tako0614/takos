import { expect, test } from "bun:test";
import { readModelSettingsResponse } from "../../lib/model-settings-response.ts";

function response() {
  return {
    ai_model: "gpt-5.5",
    model: "gpt-5.5",
    model_backend: "openai",
    available_models: {
      openai: [
        {
          id: "gpt-5.5",
          name: "GPT-5.5",
          source: "models_api",
        },
        "gateway/model",
      ],
      anthropic: [],
      google: [],
    },
    catalog_status: "fresh",
    token_limit: 112000,
  };
}

test("model settings response projects the operator catalog", () => {
  expect(readModelSettingsResponse(response())).toEqual({
    model: "gpt-5.5",
    modelBackend: "openai",
    availableModels: {
      openai: [
        {
          id: "gpt-5.5",
          label: "GPT-5.5",
          description: undefined,
          source: "models_api",
          disabled: undefined,
        },
        { id: "gateway/model", label: "gateway/model" },
      ],
      anthropic: [],
      google: [],
    },
    catalogStatus: "fresh",
    tokenLimit: 112000,
  });
});

test("model settings response rejects alias and catalog drift", () => {
  expect(() =>
    readModelSettingsResponse({ ...response(), model: "other/model" })
  ).toThrow();
  expect(() =>
    readModelSettingsResponse({
      ...response(),
      available_models: {
        ...response().available_models,
        openai: [{ id: "other/model" }],
      },
    })
  ).toThrow();
});

test("model settings response rejects duplicate and disabled selections", () => {
  expect(() =>
    readModelSettingsResponse({
      ...response(),
      available_models: {
        ...response().available_models,
        openai: ["gpt-5.5", "gpt-5.5"],
      },
    })
  ).toThrow();
  expect(() =>
    readModelSettingsResponse({
      ...response(),
      available_models: {
        ...response().available_models,
        openai: [{ id: "gpt-5.5", disabled: true }],
      },
    })
  ).toThrow();
});
