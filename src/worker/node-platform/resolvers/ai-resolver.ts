/**
 * AI / Vectorize resolver — sets up OpenAI embeddings and pgvector.
 */
import { optionalEnv } from "./env-utils.ts";
import type { VectorIndexBinding } from "../../shared/types/bindings.ts";

export async function resolveAiBinding(): Promise<
  {
    run(
      model: string,
      inputs: { text: string[] },
    ): Promise<{ data: number[][] }>;
  } | undefined
> {
  const openAiKey = optionalEnv("OPENAI_API_KEY");
  if (openAiKey) {
    const { createOpenAiAiBinding } = await import(
      "../../adapters/openai-binding.ts"
    );
    return createOpenAiAiBinding({
      apiKey: openAiKey,
      baseUrl: optionalEnv("OPENAI_BASE_URL"),
    });
  }
  return undefined;
}

export type PgPool = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

export async function resolvePgPool(
  postgresUrl: string | null,
): Promise<PgPool | undefined> {
  if (optionalEnv("PGVECTOR_ENABLED") !== "true") return undefined;
  if (!postgresUrl) return undefined;

  type PgPoolConstructor = new (opts: { connectionString: string }) => PgPool;

  const pg: Record<string, unknown> = await import("pg");
  const pgModule = (pg.default ?? pg) as Record<string, unknown>;
  const Pool = pgModule.Pool as PgPoolConstructor;
  return new Pool({ connectionString: postgresUrl });
}

export async function resolveVectorizeBinding(
  pool: PgPool | undefined,
): Promise<VectorIndexBinding | undefined> {
  if (!pool) return undefined;
  const { createPgVectorStore } = await import(
    "../../adapters/pgvector-store.ts"
  );
  return createPgVectorStore({ pool });
}
