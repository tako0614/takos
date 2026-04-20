import type { AgentMessage, AgentTool } from "./agent-models.ts";
import {
  createBackend,
  DEFAULT_MODEL_ID,
  getBackendFromModel,
  type LLMBackend,
  type LLMResponse,
  type ModelBackend,
  type ModelConfig,
} from "./llm-backends.ts";

export type { LLMBackend, LLMResponse, ModelBackend, ModelConfig };
export { getBackendFromModel };

export interface LLMConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  backend?: ModelBackend;
  anthropicApiKey?: string;
  googleApiKey?: string;
}

export class LLMClient {
  private backend: LLMBackend;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;

    const model = config.model || DEFAULT_MODEL_ID;
    const backendType = config.backend || getBackendFromModel(model);

    let apiKey = config.apiKey;
    if (backendType === "anthropic" && config.anthropicApiKey) {
      apiKey = config.anthropicApiKey;
    } else if (backendType === "google" && config.googleApiKey) {
      apiKey = config.googleApiKey;
    }

    this.backend = createBackend({
      backend: backendType,
      model,
      apiKey,
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 1,
    });
  }

  getConfig(): LLMConfig {
    return this.config;
  }

  async chat(
    messages: AgentMessage[],
    tools?: AgentTool[],
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    return this.backend.chat(messages, tools, signal);
  }
}

export const VALID_MODEL_BACKENDS: readonly ModelBackend[] = [
  "openai",
  "anthropic",
  "google",
];

function parseModelBackend(
  value: string | undefined,
): ModelBackend | undefined {
  if (!value) return undefined;
  return (VALID_MODEL_BACKENDS as readonly string[]).includes(value)
    ? (value as ModelBackend)
    : undefined;
}

export function createLLMClientFromEnv(env: {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  AI_MODEL?: string;
  AI_BACKEND?: string;
}): LLMClient {
  const model = env.AI_MODEL || DEFAULT_MODEL_ID;
  const backendType = parseModelBackend(env.AI_BACKEND) ||
    getBackendFromModel(model);

  const keyMap: Record<
    ModelBackend,
    { key: string | undefined; label: string }
  > = {
    openai: {
      key: env.OPENAI_API_KEY,
      label: "OpenAI API key (OPENAI_API_KEY) is required for OpenAI models",
    },
    anthropic: {
      key: env.ANTHROPIC_API_KEY,
      label:
        "Anthropic API key (ANTHROPIC_API_KEY) is required for Claude models",
    },
    google: {
      key: env.GOOGLE_API_KEY,
      label: "Google API key (GOOGLE_API_KEY) is required for Gemini models",
    },
  };

  const entry = keyMap[backendType];
  if (!entry) throw new Error(`Unknown backend type: ${backendType}`);
  if (!entry.key) throw new Error(entry.label);

  return new LLMClient({
    apiKey: entry.key,
    model,
    backend: backendType,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    googleApiKey: env.GOOGLE_API_KEY,
  });
}
