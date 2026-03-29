/**
 * Multi-Model Provider Abstraction
 * Supports OpenAI, Anthropic Claude, and Google Gemini
 */
import type { AgentMessage, AgentTool, ToolCall } from './agent-models';
import { type ModelProvider } from './model-catalog';
export { DEFAULT_MODEL_ID } from './model-catalog';
export type { ModelProvider } from './model-catalog';
export interface ModelConfig {
    provider: ModelProvider;
    model: string;
    apiKey: string;
    maxTokens?: number;
    temperature?: number;
}
export interface LLMResponse {
    content: string;
    toolCalls?: ToolCall[];
    stopReason: 'stop' | 'tool_calls' | 'length';
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}
export interface LLMProvider {
    chat(messages: AgentMessage[], tools?: AgentTool[], signal?: AbortSignal): Promise<LLMResponse>;
}
export declare function createProvider(config: ModelConfig): LLMProvider;
/** Get provider from model ID */
export declare function getProviderFromModel(modelId: string): ModelProvider;
//# sourceMappingURL=llm-providers.d.ts.map