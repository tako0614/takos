/**
 * LLM Manager - Handles LLM client initialization, model selection, and API key management.
 *
 * Extracted from runner.ts to separate LLM provider concerns from the core run loop.
 */

import type { Env } from '../../../shared/types';
import { LLMClient, createMultiModelClient, getProviderFromModel, type ModelProvider } from './llm';

export interface LLMManagerConfig {
  apiKey: string | undefined;
  env: Env;
  aiModel: string;
}

export interface LLMState {
  readonly aiModel: string;
  readonly modelProvider: ModelProvider;
  readonly openAiKey: string | undefined;
  readonly anthropicKey: string | undefined;
  readonly googleKey: string | undefined;
  readonly client: LLMClient | undefined;
}

/** Build LLM state: resolve API keys, detect provider, and create client. */
export function createLLMState(config: LLMManagerConfig): LLMState {
  const aiModel = config.aiModel;
  const modelProvider = getProviderFromModel(config.aiModel);

  const openAiKey = config.apiKey || config.env.OPENAI_API_KEY;
  const anthropicKey = config.env.ANTHROPIC_API_KEY;
  const googleKey = config.env.GOOGLE_API_KEY;

  const providerKeyMap: Record<ModelProvider, string | undefined> = {
    openai: openAiKey,
    anthropic: anthropicKey,
    google: googleKey,
  };
  const providerKey = providerKeyMap[modelProvider];

  const client = providerKey
    ? createMultiModelClient({
        apiKey: providerKey,
        model: config.aiModel,
        anthropicApiKey: anthropicKey,
        googleApiKey: googleKey,
      })
    : undefined;

  return { aiModel, modelProvider, openAiKey, anthropicKey, googleKey, client };
}
