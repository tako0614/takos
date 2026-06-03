/**
 * Multi-Model Backend Abstraction
 * Supports OpenAI, Anthropic Claude, and Google Gemini
 */

import type {
  AgentMessage,
  AgentTool,
  AgentUsage,
  ToolCall,
} from "./agent-models.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { getModelBackend, type ModelBackend } from "./model-catalog.ts";
export { DEFAULT_MODEL_ID } from "./model-catalog.ts";
export type { ModelBackend } from "./model-catalog.ts";

// ---- Public types ----------------------------------------------------------

export interface ModelConfig {
  backend: ModelBackend;
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason: "stop" | "tool_calls" | "length";
  usage: AgentUsage;
}

export interface LLMBackend {
  chat(
    messages: AgentMessage[],
    tools?: AgentTool[],
    signal?: AbortSignal,
  ): Promise<LLMResponse>;
}

// ---- Shared helpers --------------------------------------------------------

/** Truncate and redact LLM API error bodies to prevent secret leakage. */
function sanitize(body: string, max = 500): string {
  return body.slice(0, max)
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***")
    .replace(/key-[A-Za-z0-9_-]{10,}/g, "key-***")
    .replace(/Bearer\s+[A-Za-z0-9_-]+/gi, "Bearer ***");
}

/** Extract and concatenate system messages; return the rest unchanged. */
function extractSystem(
  msgs: AgentMessage[],
): { system: string; rest: AgentMessage[] } {
  let system = "";
  const rest: AgentMessage[] = [];
  for (const m of msgs) {
    if (m.role === "system") system += (system ? "\n\n" : "") + m.content;
    else rest.push(m);
  }
  return { system, rest };
}

/**
 * Split system messages into a STABLE block (everything up to and including the
 * last system message marked `cacheControl: "ephemeral"`) and a DYNAMIC block
 * (system messages after it). The stable block is the prompt-cache prefix; the
 * dynamic block (activated memory, thread context) is appended uncached after the
 * cache breakpoint. When no system message is marked, everything is dynamic
 * (caching off) — so this is a no-op until the agent emits a marked stable block.
 */
function extractSystemBlocks(
  msgs: AgentMessage[],
): { stableSystem: string; dynamicSystem: string; rest: AgentMessage[] } {
  const rest: AgentMessage[] = [];
  const systems: AgentMessage[] = [];
  for (const m of msgs) {
    if (m.role === "system") systems.push(m);
    else rest.push(m);
  }
  let lastStableIdx = -1;
  for (let i = 0; i < systems.length; i++) {
    if (systems[i].cacheControl === "ephemeral") lastStableIdx = i;
  }
  const join = (from: number, to: number) =>
    systems.slice(from, to).map((m) => m.content).filter(Boolean).join("\n\n");
  return {
    stableSystem: lastStableIdx >= 0 ? join(0, lastStableIdx + 1) : "",
    dynamicSystem: lastStableIdx >= 0
      ? join(lastStableIdx + 1, systems.length)
      : join(0, systems.length),
    rest,
  };
}

/** Generic POST + JSON-parse with error sanitization. */
async function llmFetch<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(
      `${label} API error: ${res.status} - ${sanitize(await res.text())}`,
    );
  }
  return res.json() as Promise<T>;
}

/** Parse raw tool-call data and log malformed tool calls. */
function parseToolCalls(
  raw: { id: string; name: string; arguments: unknown }[],
): ToolCall[] {
  const out: ToolCall[] = [];
  for (const tc of raw) {
    try {
      out.push({
        id: tc.id,
        name: tc.name,
        arguments: typeof tc.arguments === "string"
          ? JSON.parse(tc.arguments)
          : tc.arguments,
      });
    } catch (e) {
      logError("Failed to parse tool call", e, {
        module: "services/agent/backends",
      });
    }
  }
  return out;
}

/**
 * Assemble a normalised LLMResponse. `inTok` MUST be the TOTAL prompt tokens
 * (cached + uncached); `cacheRead` / `cacheWrite` are the cached subset.
 */
function respond(
  content: string,
  toolCalls: ToolCall[],
  stopReason: string,
  inTok: number,
  outTok: number,
  cacheRead = 0,
  cacheWrite = 0,
): LLMResponse {
  const usage: AgentUsage = { inputTokens: inTok, outputTokens: outTok };
  if (cacheRead) usage.cacheReadTokens = cacheRead;
  if (cacheWrite) usage.cacheWriteTokens = cacheWrite;
  return {
    content,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    stopReason: stopReason as LLMResponse["stopReason"],
    usage,
  };
}

/** Common schema body shared by all backends' tool definitions. */
function toolSchema(t: AgentTool) {
  return {
    properties: t.parameters.properties,
    required: t.parameters.required,
  };
}

function toolArgsStr(tc: ToolCall): string {
  return typeof tc.arguments === "string"
    ? tc.arguments
    : JSON.stringify(tc.arguments || {});
}

// ---- OpenAI ----------------------------------------------------------------

class OpenAIBackend implements LLMBackend {
  constructor(private cfg: ModelConfig) {}

  async chat(
    messages: AgentMessage[],
    tools?: AgentTool[],
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      max_completion_tokens: this.cfg.maxTokens || 4096,
      messages: messages.map((m) => {
        if (m.role === "system" || m.role === "user") {
          return { role: m.role, content: m.content };
        }
        if (m.role === "assistant") {
          const o: Record<string, unknown> = {
            role: "assistant",
            content: m.content || null,
          };
          if (m.tool_calls?.length) {
            o.tool_calls = m.tool_calls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: toolArgsStr(tc) },
            }));
          }
          return o;
        }
        return {
          role: "tool",
          content: m.content,
          tool_call_id: m.tool_call_id ?? "",
        };
      }),
    };

    const isReasoning = /^o[0-9]/.test(this.cfg.model) ||
      this.cfg.model.includes("o1") || this.cfg.model.includes("o3") ||
      this.cfg.model.includes("gpt-5");
    if (!isReasoning) body.temperature = this.cfg.temperature ?? 1;

    if (tools?.length) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: { type: "object", ...toolSchema(t) },
        },
      }));
    }

    type Res = {
      choices: {
        message: {
          content: string | null;
          tool_calls?: {
            id: string;
            function: { name: string; arguments: string };
          }[];
        };
        finish_reason: string;
      }[];
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        // OpenAI automatic prefix caching reports the cached subset here.
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const d = await llmFetch<Res>(
      "https://api.openai.com/v1/chat/completions",
      { Authorization: `Bearer ${this.cfg.apiKey}` },
      body,
      "OpenAI",
      signal,
    );
    if (!d.choices?.length) {
      throw new Error("OpenAI API returned empty choices array");
    }

    const c = d.choices[0];
    // `prompt_tokens` is the TOTAL (cached + uncached); cached_tokens is the
    // discounted subset (OpenAI auto-caches stable prefixes ≥1024 tokens — no
    // explicit cache_control needed, so the agent just keeps the prefix stable).
    return respond(
      c.message.content || "",
      parseToolCalls(
        (c.message.tool_calls ?? []).map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        })),
      ),
      c.finish_reason,
      d.usage.prompt_tokens,
      d.usage.completion_tokens,
      d.usage.prompt_tokens_details?.cached_tokens ?? 0,
      0,
    );
  }
}

// ---- Anthropic -------------------------------------------------------------

class AnthropicBackend implements LLMBackend {
  constructor(private cfg: ModelConfig) {}

  async chat(
    messages: AgentMessage[],
    tools?: AgentTool[],
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    const { stableSystem, dynamicSystem, rest } = extractSystemBlocks(messages);
    const converted: { role: string; content: unknown }[] = [];

    // Tag the last block of a content value with a cache_control breakpoint so
    // Anthropic caches the conversation prefix up to and including this message.
    const tagCache = (blocks: Record<string, unknown>[]): unknown => {
      if (!blocks.length) return blocks;
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        cache_control: { type: "ephemeral" },
      };
      return blocks;
    };

    for (const m of rest) {
      const mark = m.cacheControl === "ephemeral";
      if (m.role === "user") {
        converted.push({
          role: "user",
          content: mark
            ? tagCache([{ type: "text", text: m.content }])
            : m.content,
        });
      } else if (m.role === "assistant") {
        if (m.tool_calls?.length) {
          const parts: Record<string, unknown>[] = [];
          if (m.content) parts.push({ type: "text", text: m.content });
          for (const tc of m.tool_calls) {
            parts.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          converted.push({
            role: "assistant",
            content: mark ? tagCache(parts) : parts,
          });
        } else {
          converted.push({
            role: "assistant",
            content: mark
              ? tagCache([{ type: "text", text: m.content }])
              : m.content,
          });
        }
      } else if (m.role === "tool") {
        const block: Record<string, unknown> = {
          type: "tool_result",
          tool_use_id: m.tool_call_id ?? "",
          content: m.content,
        };
        if (mark) block.cache_control = { type: "ephemeral" };
        const last = converted[converted.length - 1];
        if (last?.role === "user" && Array.isArray(last.content)) {
          (last.content as Record<string, unknown>[]).push(block);
        } else converted.push({ role: "user", content: [block] });
      }
    }

    const body: Record<string, unknown> = {
      model: this.cfg.model,
      max_tokens: this.cfg.maxTokens || 4096,
      messages: converted,
    };
    // System as content blocks. A breakpoint on the stable block caches the whole
    // tools → system prefix (Anthropic orders the cached prefix tools-then-system),
    // so no separate tool breakpoint is needed. The dynamic block (activated
    // memory / thread context) follows uncached. When the agent has not marked a
    // stable block, `stableSystem` is empty → no cache_control → behaviour
    // unchanged.
    if (stableSystem || dynamicSystem) {
      const sys: Record<string, unknown>[] = [];
      if (stableSystem) {
        sys.push({
          type: "text",
          text: stableSystem,
          cache_control: { type: "ephemeral" },
        });
      }
      if (dynamicSystem) sys.push({ type: "text", text: dynamicSystem });
      body.system = sys;
    }
    if (tools?.length) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: { type: "object", ...toolSchema(t) },
      }));
    }

    type Res = {
      content: {
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
      }[];
      stop_reason: string;
      usage: {
        input_tokens: number;
        output_tokens: number;
        // Present only when a cache breakpoint matched; Anthropic excludes these
        // from `input_tokens`, so total prompt tokens = input + read + creation.
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    const d = await llmFetch<Res>(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": this.cfg.apiKey, "anthropic-version": "2023-06-01" },
      body,
      "Anthropic",
      signal,
    );
    if (!d.content || !Array.isArray(d.content)) {
      throw new Error("Anthropic API returned invalid content structure");
    }

    let text = "";
    const tc: ToolCall[] = [];
    for (const b of d.content) {
      if (b.type === "text") text += b.text || "";
      else if (b.type === "tool_use") {
        tc.push({
          id: b.id ?? "",
          name: b.name ?? "",
          arguments: b.input as Record<string, unknown>,
        });
      }
    }
    const cacheRead = d.usage.cache_read_input_tokens ?? 0;
    const cacheWrite = d.usage.cache_creation_input_tokens ?? 0;
    return respond(
      text,
      tc,
      d.stop_reason === "tool_use" ? "tool_calls" : d.stop_reason,
      d.usage.input_tokens + cacheRead + cacheWrite,
      d.usage.output_tokens,
      cacheRead,
      cacheWrite,
    );
  }
}

// ---- Google Gemini ---------------------------------------------------------

class GoogleBackend implements LLMBackend {
  constructor(private cfg: ModelConfig) {}

  async chat(
    messages: AgentMessage[],
    tools?: AgentTool[],
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    const { system, rest } = extractSystem(messages);
    const contents: { role: string; parts: Record<string, unknown>[] }[] = [];

    for (const m of rest) {
      if (m.role === "user") {
        contents.push({ role: "user", parts: [{ text: m.content }] });
      } else if (m.role === "assistant") {
        const parts: Record<string, unknown>[] = [];
        if (m.content) parts.push({ text: m.content });
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) {
            parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          }
        }
        if (parts.length) contents.push({ role: "model", parts });
      } else if (m.role === "tool") {
        const prev = contents[contents.length - 1];
        const fn = prev?.parts.find((p) => p.functionCall);
        const name = (fn?.functionCall as { name?: string })?.name || "unknown";
        contents.push({
          role: "user",
          parts: [{
            functionResponse: { name, response: { result: m.content } },
          }],
        });
      }
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: this.cfg.maxTokens || 4096,
        temperature: this.cfg.temperature ?? 1,
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (tools?.length) {
      body.tools = [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: {
            type: "OBJECT",
            properties: Object.fromEntries(
              Object.entries(t.parameters.properties).map((
                [k, v],
              ) => [k, {
                type: (v.type || "string").toUpperCase(),
                description: v.description,
              }]),
            ),
            required: t.parameters.required,
          },
        })),
      }];
    }

    type Res = {
      candidates: {
        content: {
          parts: {
            text?: string;
            functionCall?: { name: string; args: unknown };
          }[];
        };
        finishReason: string;
      }[];
      usageMetadata: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        // Gemini implicit/explicit context caching reports the cached subset.
        cachedContentTokenCount?: number;
      };
    };
    const d = await llmFetch<Res>(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.cfg.model}:generateContent`,
      { "x-goog-api-key": this.cfg.apiKey },
      body,
      "Google",
      signal,
    );
    if (!d.candidates?.length) {
      throw new Error("Google API returned empty candidates array");
    }

    const cand = d.candidates[0];
    if (!cand.content?.parts) {
      throw new Error(
        "Google API returned invalid candidate content structure",
      );
    }

    let text = "";
    const tc: ToolCall[] = [];
    for (const p of cand.content.parts) {
      if (p.text) text += p.text;
      else if (p.functionCall) {
        tc.push({
          id: `call_${crypto.randomUUID()}`,
          name: p.functionCall.name,
          arguments: p.functionCall.args as Record<string, unknown>,
        });
      }
    }
    return respond(
      text,
      tc,
      cand.finishReason === "STOP" ? "stop" : tc.length ? "tool_calls" : "stop",
      d.usageMetadata?.promptTokenCount || 0,
      d.usageMetadata?.candidatesTokenCount || 0,
      d.usageMetadata?.cachedContentTokenCount ?? 0,
      0,
    );
  }
}

// ---- Factory ---------------------------------------------------------------

export function createBackend(config: ModelConfig): LLMBackend {
  switch (config.backend) {
    case "openai":
      return new OpenAIBackend(config);
    case "anthropic":
      return new AnthropicBackend(config);
    case "google":
      return new GoogleBackend(config);
    default:
      throw new Error(`Unknown backend: ${config.backend}`);
  }
}

/** Get backend from model ID */
export function getBackendFromModel(modelId: string): ModelBackend {
  return getModelBackend(modelId);
}
