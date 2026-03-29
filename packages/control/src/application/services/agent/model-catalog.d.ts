export type ModelProvider = 'openai' | 'anthropic' | 'google';
export type ModelOption = {
    id: string;
    name: string;
    description?: string;
};
export declare const OPENAI_MODELS: ReadonlyArray<ModelOption>;
export declare const SUPPORTED_MODEL_IDS: readonly ["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4"];
export type SupportedModelId = (typeof SUPPORTED_MODEL_IDS)[number];
export declare const DEFAULT_MODEL_ID: string;
export declare function normalizeModelId(model?: string | null): string | null;
export declare function getModelProvider(model: string): ModelProvider;
/** Max input token limits per model (used to dynamically size conversation history) */
export declare const MODEL_TOKEN_LIMITS: Readonly<Record<string, number>>;
export declare function getModelTokenLimit(model: string): number;
/**
 * Resolve the token budget available for conversation history.
 * `envOverrides` is a JSON string like `{"gpt-5.4":200000}` from env var MODEL_CONTEXT_WINDOWS.
 */
export declare function resolveHistoryTokenBudget(model: string, envOverrides?: string | null): number;
//# sourceMappingURL=model-catalog.d.ts.map