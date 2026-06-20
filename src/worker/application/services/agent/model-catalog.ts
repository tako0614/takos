import { logWarn } from "../../../shared/utils/logger.ts";

export type ModelBackend = "openai" | "anthropic" | "google";

export type ModelOption = {
  id: string;
  name: string;
  description?: string;
};

export const SUPPORTED_MODEL_IDS = [
  "gpt-5.5",
  "takosumi/default",
  "deepseek/chat",
  "zai/glm",
  "gemini/chat",
] as const;
export type SupportedModelId = (typeof SUPPORTED_MODEL_IDS)[number];

// These model ids are product-facing aliases that are valid for the Takosumi AI
// Gateway and other OpenAI-compatible endpoints. Direct OpenAI deployments can
// keep using `gpt-5.5`; Gateway deployments set OPENAI_BASE_URL/OPENAI_API_KEY
// and can expose provider aliases such as DeepSeek, GLM, or Gemini without a
// second Takos-specific model backend.
export const OPENAI_COMPATIBLE_MODELS: ReadonlyArray<ModelOption> = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    description: "Default direct OpenAI-compatible model",
  },
  {
    id: "takosumi/default",
    name: "Takosumi Default",
    description: "Operator-selected model through Takosumi AI Gateway",
  },
  {
    id: "deepseek/chat",
    name: "DeepSeek Chat",
    description: "OpenAI-compatible alias through Takosumi AI Gateway",
  },
  {
    id: "zai/glm",
    name: "Z.AI GLM",
    description: "OpenAI-compatible alias through Takosumi AI Gateway",
  },
  {
    id: "gemini/chat",
    name: "Gemini Chat",
    description: "OpenAI-compatible alias through Takosumi AI Gateway",
  },
];

export const OPENAI_MODELS = OPENAI_COMPATIBLE_MODELS;

export const AVAILABLE_MODELS_BY_BACKEND: Readonly<
  Record<ModelBackend, ReadonlyArray<ModelOption>>
> = {
  openai: OPENAI_COMPATIBLE_MODELS,
  anthropic: [],
  google: [],
};

export const DEFAULT_MODEL_ID = OPENAI_MODELS[0].id;

export function normalizeModelId(model?: string | null): string | null {
  if (!model) return null;
  const normalized = model.toLowerCase().trim();
  return (SUPPORTED_MODEL_IDS as readonly string[]).includes(normalized)
    ? normalized
    : null;
}

export function getModelBackend(model: string): ModelBackend {
  const normalized = model.toLowerCase().trim();
  if (normalized.startsWith("gpt-")) {
    return "openai";
  }
  if (normalized.startsWith("claude-")) {
    return "anthropic";
  }
  if (normalized.startsWith("gemini-")) {
    return "google";
  }
  return "openai";
}

// --- Model token limits ---

/** Max input token limits per model (used to dynamically size conversation history) */
export const MODEL_TOKEN_LIMITS: Readonly<Record<string, number>> = {
  "gpt-5.5": 128_000,
  "takosumi/default": 128_000,
  "deepseek/chat": 128_000,
  "zai/glm": 128_000,
  "gemini/chat": 128_000,
};

const DEFAULT_TOKEN_LIMIT = 32_768;

/** Reserved tokens: system prompt + tool definitions + completion + safety margin */
const RESERVED_TOKENS = 16_000;

export function getModelTokenLimit(model: string): number {
  return MODEL_TOKEN_LIMITS[model] ?? DEFAULT_TOKEN_LIMIT;
}

/**
 * Resolve the token budget available for conversation history.
 * `envOverrides` is a JSON string like `{"gpt-5.5":200000}` from env var MODEL_CONTEXT_WINDOWS.
 */
export function resolveHistoryTokenBudget(
  model: string,
  envOverrides?: string | null,
): number {
  let limit = MODEL_TOKEN_LIMITS[model] ?? DEFAULT_TOKEN_LIMIT;
  if (envOverrides) {
    try {
      const overrides = JSON.parse(envOverrides) as Record<string, unknown>;
      const val = overrides[model];
      if (typeof val === "number" && val > 0) limit = val;
    } catch (error) {
      logWarn("Invalid MODEL_CONTEXT_WINDOWS ignored", {
        module: "services/agent/model-catalog",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return Math.max(limit - RESERVED_TOKENS, 4_000);
}
