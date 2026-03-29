import type { AgentMessage, AgentTool } from './agent-models';
import { getProviderFromModel, type ModelConfig, type ModelProvider, type LLMProvider, type LLMResponse } from './llm-providers';
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
export declare class LLMClient {
    private provider;
    private config;
    constructor(config: LLMConfig);
    getConfig(): LLMConfig;
    chat(messages: AgentMessage[], tools?: AgentTool[], signal?: AbortSignal): Promise<LLMResponse>;
}
export declare const VALID_PROVIDERS: readonly ModelProvider[];
export declare function createLLMClientFromEnv(env: {
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    GOOGLE_API_KEY?: string;
    AI_MODEL?: string;
    AI_PROVIDER?: string;
}): LLMClient;
//# sourceMappingURL=llm.d.ts.map