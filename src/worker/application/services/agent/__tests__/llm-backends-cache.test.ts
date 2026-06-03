import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { createBackend } from "../llm-backends.ts";
import type { AgentMessage } from "../agent-models.ts";

/**
 * Verifies the prompt-cache wiring in the LLM backends: Anthropic emits a
 * cache_control breakpoint on the stable system block (and any cacheControl-marked
 * message) but not the dynamic tail; OpenAI never emits cache_control (automatic
 * prefix caching); and all backends report cached tokens in LLMResponse.usage with
 * inputTokens kept as the TOTAL prompt tokens.
 */

type Captured = { url: string; body: Record<string, unknown> };

function installFetch(responseJson: unknown): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string | URL, init: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(responseJson), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

const tool = {
  name: "t",
  description: "d",
  parameters: { type: "object" as const, properties: {} },
};

test("Anthropic: stable system block is cache-marked, dynamic tail is not, message marker honored, usage totals cache tokens", async () => {
  const orig = globalThis.fetch;
  try {
    const calls = installFetch({
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 200,
      },
    });
    const backend = createBackend({
      backend: "anthropic",
      model: "claude-x",
      apiKey: "k",
      maxTokens: 100,
      temperature: 1,
    });
    const messages: AgentMessage[] = [
      { role: "system", content: "STABLE", cacheControl: "ephemeral" },
      { role: "system", content: "DYNAMIC" },
      { role: "user", content: "hello", cacheControl: "ephemeral" },
    ];
    const res = await backend.chat(messages, [tool]);
    const body = calls[0].body as {
      system: { text: string; cache_control?: unknown }[];
      messages: { role: string; content: { cache_control?: unknown }[] }[];
    };

    assertEquals(Array.isArray(body.system), true);
    assertEquals(body.system[0].text, "STABLE");
    assertEquals(body.system[0].cache_control, { type: "ephemeral" });
    assertEquals(body.system[1].text, "DYNAMIC");
    assertEquals(body.system[1].cache_control, undefined);
    // The cacheControl-marked user message becomes a blocks array with the
    // breakpoint on its last block (incremental conversation caching).
    assertEquals(Array.isArray(body.messages[0].content), true);
    assertEquals(body.messages[0].content[0].cache_control, { type: "ephemeral" });

    assertEquals(res.usage.inputTokens, 310); // 10 + 100 + 200 (total)
    assertEquals(res.usage.cacheReadTokens, 100);
    assertEquals(res.usage.cacheWriteTokens, 200);
  } finally {
    globalThis.fetch = orig;
  }
});

test("Anthropic: an unmarked system carries no cache_control (caching stays off until the agent marks a stable block)", async () => {
  const orig = globalThis.fetch;
  try {
    const calls = installFetch({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 7, output_tokens: 3 },
    });
    const backend = createBackend({
      backend: "anthropic",
      model: "claude-x",
      apiKey: "k",
    });
    const res = await backend.chat([
      { role: "system", content: "S" },
      { role: "user", content: "u" },
    ]);
    const body = calls[0].body as { system: { cache_control?: unknown }[] };
    assertEquals(body.system[0].cache_control, undefined);
    assertEquals(res.usage.inputTokens, 7);
    assertEquals(res.usage.cacheReadTokens, undefined);
  } finally {
    globalThis.fetch = orig;
  }
});

test("OpenAI: never emits cache_control; cached_tokens parsed; inputTokens is the total", async () => {
  const orig = globalThis.fetch;
  try {
    const calls = installFetch({
      choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 500,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 400 },
      },
    });
    const backend = createBackend({
      backend: "openai",
      model: "gpt-5.5",
      apiKey: "k",
    });
    const res = await backend.chat([
      { role: "system", content: "STABLE", cacheControl: "ephemeral" },
      { role: "user", content: "hello" },
    ], [tool]);
    const body = calls[0].body;
    assertEquals(JSON.stringify(body).includes("cache_control"), false);
    assertEquals(res.usage.inputTokens, 500);
    assertEquals(res.usage.cacheReadTokens, 400);
    assertEquals(res.usage.cacheWriteTokens, undefined);
  } finally {
    globalThis.fetch = orig;
  }
});
