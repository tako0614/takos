/**
 * LLM Manager - Handles LLM client initialization, model selection, and API key management.
 *
 * Extracted from runner.ts to separate LLM provider concerns from the core run loop.
 */
import type { Env } from '../../../shared/types';
import { LLMClient, type ModelProvider } from './llm';
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
export declare function createLLMState(config: LLMManagerConfig): LLMState;
//# sourceMappingURL=llm-manager.d.ts.map