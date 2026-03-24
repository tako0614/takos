import type { AgentMessage, AgentTool } from './types';
import {
  createProvider,
  getProviderFromModel,
  DEFAULT_MODEL_ID,
  type ModelConfig,
  type ModelProvider,
  type LLMProvider,
  type LLMResponse,
} from './providers';

export type { ModelConfig, ModelProvider, LLMProvider, LLMResponse };
export { getProviderFromModel };

export interface LLMConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  provider?: ModelProvider;
  anthropicApiKey?: string;
  googleApiKey?: string;
}

/** @deprecated Use estimateTokens from prompt-budget.ts instead */
export const CHARS_PER_TOKEN = 4;

export class LLMClient {
  private provider: LLMProvider;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;

    const model = config.model || DEFAULT_MODEL_ID;
    const providerType = config.provider || getProviderFromModel(model);

    let apiKey = config.apiKey;
    if (providerType === 'anthropic' && config.anthropicApiKey) {
      apiKey = config.anthropicApiKey;
    } else if (providerType === 'google' && config.googleApiKey) {
      apiKey = config.googleApiKey;
    }

    this.provider = createProvider({
      provider: providerType,
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
    return this.provider.chat(messages, tools, signal);
  }
}

export function createLLMClient(apiKey: string, config?: Partial<LLMConfig>): LLMClient {
  return new LLMClient({ apiKey, ...config });
}

export function createMultiModelClient(config: LLMConfig): LLMClient {
  return new LLMClient(config);
}

export const VALID_PROVIDERS: readonly ModelProvider[] = ['openai', 'anthropic', 'google'];

function parseModelProvider(value: string | undefined): ModelProvider | undefined {
  if (!value) return undefined;
  return (VALID_PROVIDERS as readonly string[]).includes(value) ? (value as ModelProvider) : undefined;
}

export function createLLMClientFromEnv(env: {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  AI_MODEL?: string;
  AI_PROVIDER?: string;
}): LLMClient {
  const model = env.AI_MODEL || DEFAULT_MODEL_ID;
  const providerType = parseModelProvider(env.AI_PROVIDER) || getProviderFromModel(model);

  const keyMap: Record<ModelProvider, { key: string | undefined; label: string }> = {
    openai: { key: env.OPENAI_API_KEY, label: 'OpenAI API key (OPENAI_API_KEY) is required for OpenAI models' },
    anthropic: { key: env.ANTHROPIC_API_KEY, label: 'Anthropic API key (ANTHROPIC_API_KEY) is required for Claude models' },
    google: { key: env.GOOGLE_API_KEY, label: 'Google API key (GOOGLE_API_KEY) is required for Gemini models' },
  };

  const entry = keyMap[providerType];
  if (!entry) throw new Error(`Unknown provider type: ${providerType}`);
  if (!entry.key) throw new Error(entry.label);

  return new LLMClient({
    apiKey: entry.key,
    model,
    provider: providerType,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    googleApiKey: env.GOOGLE_API_KEY,
  });
}
