import {
  deepStrictEqual as assertEquals,
  strictEqual as assertStrictEquals,
} from "node:assert/strict";
import { test } from "bun:test";
import {
  clearModelCatalogCacheForTests,
  isModelSelectable,
  normalizeModelId,
  resolveExecutionModel,
  resolveModelCatalog,
  usesTakosumiManagedAiGateway,
} from "../model-catalog.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("model catalog returns fallback when OpenAI credentials are not configured", async () => {
  clearModelCatalogCacheForTests();
  const catalog = await resolveModelCatalog({});

  assertStrictEquals(catalog.status, "unconfigured");
  assertEquals(
    catalog.availableModelsByBackend.openai.map((model) => model.id),
    ["gpt-5.5", "takosumi/default", "deepseek/chat", "zai/glm", "gemini/chat"],
  );
});

test("managed Takosumi Gateway exposes only its safe default without an operator allowlist", async () => {
  clearModelCatalogCacheForTests();
  const env = {
    OIDC_ISSUER_URL: "https://app.takosumi.test",
    OIDC_CLIENT_ID: "toc_test",
    ENCRYPTION_KEY: "test-encryption-key",
    TAKOSUMI_ACCOUNTS_URL: "https://app.takosumi.test",
  };

  assertStrictEquals(usesTakosumiManagedAiGateway(env), true);
  const catalog = await resolveModelCatalog(env, { currentModel: "gpt-5.5" });
  assertStrictEquals(catalog.status, "fallback");
  assertEquals(
    catalog.availableModelsByBackend.openai.map((model) => ({
      id: model.id,
      disabled: model.disabled ?? false,
    })),
    [
      { id: "gpt-5.5", disabled: true },
      { id: "takosumi/default", disabled: false },
    ],
  );
  assertStrictEquals(resolveExecutionModel(env, "gpt-5.5"), "takosumi/default");
});

test("managed Takosumi Gateway accepts only aliases the operator explicitly allows", () => {
  const env = {
    OIDC_ISSUER_URL: "https://app.takosumi.test",
    OIDC_CLIENT_ID: "toc_test",
    ENCRYPTION_KEY: "test-encryption-key",
    TAKOSUMI_ACCOUNTS_URL: "https://app.takosumi.test",
    TAKOS_ALLOWED_MODELS: "deepseek/chat",
  };

  assertStrictEquals(
    resolveExecutionModel(env, "deepseek/chat"),
    "deepseek/chat",
  );
  assertStrictEquals(resolveExecutionModel(env, "gpt-5.5"), "takosumi/default");
});

test("model catalog fetches direct OpenAI models and filters non-chat model ids", async () => {
  clearModelCatalogCacheForTests();
  const urls: string[] = [];
  const catalog = await resolveModelCatalog(
    { OPENAI_API_KEY: "sk-test" },
    {
      fetchImpl: async (url) => {
        urls.push(String(url));
        return jsonResponse({
          data: [
            { id: "gpt-5.5" },
            { id: "gpt-5.5" },
            { id: "text-embedding-3-large" },
            { id: "o4-mini" },
          ],
        });
      },
    },
  );

  assertEquals(urls, ["https://api.openai.com/v1/models"]);
  assertStrictEquals(catalog.status, "fresh");
  assertEquals(
    catalog.availableModelsByBackend.openai.map((model) => model.id),
    ["gpt-5.5", "o4-mini"],
  );
  assertStrictEquals(
    catalog.availableModelsByBackend.openai[0].source,
    "models_api",
  );
});

test("model catalog trusts OpenAI-compatible gateway aliases and supports allowlists", async () => {
  clearModelCatalogCacheForTests();
  const urls: string[] = [];
  const catalog = await resolveModelCatalog(
    {
      OPENAI_API_KEY: "gateway-key",
      OPENAI_BASE_URL: "https://gateway.example.test/gateway/ai/v1",
      TAKOS_ALLOWED_MODELS: "takosumi/default,deepseek/chat",
    },
    {
      fetchImpl: async (url) => {
        urls.push(String(url));
        return jsonResponse({
          data: [
            { id: "takosumi/default" },
            { id: "deepseek/chat" },
            { id: "not-allowed/chat" },
          ],
        });
      },
    },
  );

  assertEquals(urls, ["https://gateway.example.test/gateway/ai/v1/models"]);
  assertEquals(
    catalog.availableModelsByBackend.openai.map((model) => model.id),
    ["takosumi/default", "deepseek/chat"],
  );
  assertStrictEquals(
    catalog.availableModelsByBackend.openai[0].source,
    "gateway",
  );
});

test("model catalog reuses stale cache when refresh fails", async () => {
  clearModelCatalogCacheForTests();
  let shouldFail = false;
  const fetchImpl = async () => {
    if (shouldFail) return jsonResponse({ error: "nope" }, 500);
    return jsonResponse({ data: [{ id: "gpt-5.5" }] });
  };

  const first = await resolveModelCatalog(
    { OPENAI_API_KEY: "sk-test" },
    { fetchImpl, now: 1 },
  );
  shouldFail = true;
  const second = await resolveModelCatalog(
    { OPENAI_API_KEY: "sk-test" },
    { fetchImpl, now: 1 + 10 * 60 * 1000 },
  );

  assertStrictEquals(first.status, "fresh");
  assertStrictEquals(second.status, "cached");
  assertEquals(
    second.availableModelsByBackend.openai.map((model) => model.id),
    ["gpt-5.5"],
  );
});

test("model catalog includes saved legacy model as disabled but not selectable", async () => {
  clearModelCatalogCacheForTests();
  const catalog = await resolveModelCatalog(
    { OPENAI_API_KEY: "sk-test" },
    {
      currentModel: "retired/model",
      fetchImpl: async () => jsonResponse({ data: [{ id: "gpt-5.5" }] }),
    },
  );

  assertEquals(
    catalog.availableModelsByBackend.openai.map((model) => ({
      id: model.id,
      disabled: model.disabled ?? false,
    })),
    [
      { id: "retired/model", disabled: true },
      { id: "gpt-5.5", disabled: false },
    ],
  );
  assertStrictEquals(isModelSelectable(catalog, "retired/model"), false);
  assertStrictEquals(isModelSelectable(catalog, "gpt-5.5"), true);
});

test("model id normalization allows dynamic aliases but rejects suspicious input", () => {
  assertStrictEquals(normalizeModelId(" DeepSeek/Chat "), "deepseek/chat");
  assertStrictEquals(normalizeModelId("gpt-5.5; rm -rf /"), null);
  assertStrictEquals(normalizeModelId("../gpt-5"), null);
});
