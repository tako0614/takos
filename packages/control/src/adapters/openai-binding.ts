/**
 * OpenAI-backed adapter that satisfies the Cloudflare `Ai` binding interface
 * used by {@link EmbeddingsService}.
 *
 * Only the `run()` method is implemented — specifically for embedding models.
 * Other Ai capabilities (text-generation, image-classification, etc.) are NOT
 * supported through this adapter; LLM calls go through the direct API keys
 * already handled by the agent executor.
 */

// We only need the `run()` shape.  Importing the full Ai class from
// cloudflare-compat is not necessary; we just conform to the subset that
// EmbeddingsService calls.

import { logWarn } from '../shared/utils/logger';

const MODEL_MAP: Record<string, { openAiModel: string; dimensions?: number }> = {
  '@cf/baai/bge-base-en-v1.5': { openAiModel: 'text-embedding-3-small', dimensions: 768 },
  '@cf/baai/bge-small-en-v1.5': { openAiModel: 'text-embedding-3-small', dimensions: 384 },
  '@cf/baai/bge-large-en-v1.5': { openAiModel: 'text-embedding-3-large', dimensions: 1024 },
};

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
export function createOpenAiAiBinding(config: OpenAiAiBindingConfig) {
  const baseUrl = config.baseUrl?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1';

  return {
    async run(model: string, inputs: EmbeddingInput): Promise<EmbeddingOutput> {
      const mapping = MODEL_MAP[model];
      if (!mapping) {
        throw new Error(
          `OpenAI Ai adapter: unsupported model "${model}". ` +
          `Supported: ${Object.keys(MODEL_MAP).join(', ')}`,
        );
      }

      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: mapping.openAiModel,
          input: inputs.text,
          ...(mapping.dimensions ? { dimensions: mapping.dimensions } : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch((e) => { logWarn('Failed to read OpenAI error response body', { module: 'openai-binding', error: String(e) }); return ''; });
        throw new Error(
          `OpenAI embeddings API error (${response.status}): ${body.slice(0, 500)}`,
        );
      }

      const json = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // OpenAI returns embeddings sorted by index; ensure order matches input.
      const sorted = json.data.sort((a, b) => a.index - b.index);

      return {
        data: sorted.map((d) => d.embedding),
      };
    },
  };
}
