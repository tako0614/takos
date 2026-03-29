/**
 * OpenAI-backed adapter that satisfies the Cloudflare `Ai` binding interface
 * used by {@link EmbeddingsService}.
 *
 * Only the `run()` method is implemented — specifically for embedding models.
 * Other Ai capabilities (text-generation, image-classification, etc.) are NOT
 * supported through this adapter; LLM calls go through the direct API keys
 * already handled by the agent executor.
 */
export type OpenAiAiBindingConfig = {
    apiKey: string;
    baseUrl?: string;
};
interface EmbeddingInput {
    text: string[];
}
interface EmbeddingOutput {
    data: number[][];
}
/**
 * Creates an object that conforms to the `Ai.run(model, inputs)` interface
 * used by `EmbeddingsService`, delegating to OpenAI's embedding endpoint.
 */
export declare function createOpenAiAiBinding(config: OpenAiAiBindingConfig): {
    run(model: string, inputs: EmbeddingInput): Promise<EmbeddingOutput>;
};
export {};
//# sourceMappingURL=openai-binding.d.ts.map