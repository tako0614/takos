import { assertEquals, assertThrows } from "jsr:@std/assert";

import {
  createLLMClientFromEnv,
  LLMClient,
  VALID_MODEL_BACKENDS,
} from "../../../../../../packages/control/src/application/services/agent/llm.ts";

Deno.test("LLM client - exposes the supported backend list", () => {
  assertEquals(VALID_MODEL_BACKENDS, ["openai", "anthropic", "google"]);
});

Deno.test("LLMClient - preserves the provided config", () => {
  const config = {
    apiKey: "test-key",
    model: "gpt-5.4-mini",
    maxTokens: 8192,
    temperature: 0,
    backend: "openai" as const,
  };

  const client = new LLMClient(config);
  assertEquals(client.getConfig(), config);
});

Deno.test("createLLMClientFromEnv - returns a client with backend-specific config", () => {
  const openaiClient = createLLMClientFromEnv({ OPENAI_API_KEY: "oai-key" });
  assertEquals(openaiClient.getConfig().backend, "openai");
  assertEquals(openaiClient.getConfig().apiKey, "oai-key");

  const anthropicClient = createLLMClientFromEnv({
    ANTHROPIC_API_KEY: "ant-key",
    AI_MODEL: "claude-4-sonnet",
  });
  assertEquals(anthropicClient.getConfig().backend, "anthropic");
  assertEquals(anthropicClient.getConfig().model, "claude-4-sonnet");

  const googleClient = createLLMClientFromEnv({
    GOOGLE_API_KEY: "goog-key",
    AI_MODEL: "gemini-2.0-flash",
  });
  assertEquals(googleClient.getConfig().backend, "google");
  assertEquals(googleClient.getConfig().model, "gemini-2.0-flash");
});

Deno.test("createLLMClientFromEnv - rejects when the backend key is missing", () => {
  assertThrows(
    () => createLLMClientFromEnv({}),
    Error,
    "OpenAI API key",
  );
  assertThrows(
    () => createLLMClientFromEnv({ AI_MODEL: "claude-4-sonnet" }),
    Error,
    "Anthropic API key",
  );
  assertThrows(
    () => createLLMClientFromEnv({ AI_MODEL: "gemini-2.0-flash" }),
    Error,
    "Google API key",
  );
});

Deno.test("createLLMClientFromEnv - ignores invalid AI_BACKEND values", () => {
  const client = createLLMClientFromEnv({
    OPENAI_API_KEY: "oai-key",
    AI_BACKEND: "invalid-backend",
  });

  assertEquals(client.getConfig().backend, "openai");
});
