/**
 * LLM Manager - Handles LLM client initialization, model selection, and API key management.
 *
 * Extracted from runner.ts to separate LLM model backend concerns from the core run loop.
 */

import type { Env } from "../../../shared/types/index.ts";
import { getBackendFromModel, LLMClient, type ModelBackend } from "./llm.ts";

export interface LLMManagerConfig {
  apiKey: string | undefined;
  env: Env;
  aiModel: string;
}

export interface LLMState {
  readonly aiModel: string;
  readonly modelBackend: ModelBackend;
  readonly openAiKey: string | undefined;
  readonly anthropicKey: string | undefined;
  readonly googleKey: string | undefined;
  readonly client: LLMClient | undefined;
}

/** Build LLM state: resolve API keys, detect model backend, and create client. */
export function createLLMState(config: LLMManagerConfig): LLMState {
  const aiModel = config.aiModel;
  const modelBackend = getBackendFromModel(config.aiModel);

  const openAiKey = config.apiKey || config.env.OPENAI_API_KEY;
  const anthropicKey = config.env.ANTHROPIC_API_KEY;
  const googleKey = config.env.GOOGLE_API_KEY;

  const backendKeyMap: Record<ModelBackend, string | undefined> = {
    openai: openAiKey,
    anthropic: anthropicKey,
    google: googleKey,
  };
  const backendKey = backendKeyMap[modelBackend];

  const client = backendKey
    ? new LLMClient({
      apiKey: backendKey,
      model: config.aiModel,
      anthropicApiKey: anthropicKey,
      googleApiKey: googleKey,
    })
    : undefined;

  return { aiModel, modelBackend, openAiKey, anthropicKey, googleKey, client };
}
