/**
 * PostgreSQL + pgvector implementation of the Cloudflare VectorizeIndex
 * binding interface.
 *
 * Requires the `vector` extension to be installed on the database.
 * See the companion migration file for the schema definition.
 */

// Minimal Pool interface to avoid depending on @types/pg.
interface PgPool {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

// ---------------------------------------------------------------------------
// Types — mirror the subset of VectorizeIndex used by EmbeddingsService
// ---------------------------------------------------------------------------

interface VectorizeVector {
  id: string;
  values: number[];
  namespace?: string;
  metadata?: Record<string, unknown>;
}

interface VectorizeMatch {
  id: string;
  score: number;
  values?: number[];
  namespace?: string;
  metadata?: Record<string, unknown>;
}

interface VectorizeMatches {
  matches: VectorizeMatch[];
  count: number;
}

interface VectorizeQueryOptions {
  topK?: number;
  namespace?: string;
  returnValues?: boolean;
  returnMetadata?: boolean | string;
  filter?: Record<string, unknown>;
}

interface VectorizeVectorMutation {
  ids: string[];
  count: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type PgVectorStoreConfig = {
  pool: PgPool;
  tableName?: string;
};

const DEFAULT_TABLE = "vector_embeddings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSqlVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

/**
 * Build a WHERE clause fragment from a Vectorize-style metadata filter.
 *
 * The filter is a flat record `{ key: value }` which we translate to
 * `metadata @> '{"key": value}'::jsonb` conditions.
 */
function buildFilterClause(
  filter: Record<string, unknown> | undefined,
  paramOffset: number,
): { clause: string; params: unknown[] } {
  if (!filter || Object.keys(filter).length === 0) {
    return { clause: "", params: [] };
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(filter)) {
    params.push(JSON.stringify({ [key]: value }));
    conditions.push(`metadata @> $${paramOffset + params.length}::jsonb`);
  }

  return {
    clause: `AND ${conditions.join(" AND ")}`,
    params,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createPgVectorStore(config: PgVectorStoreConfig) {
  const { pool } = config;
  const table = config.tableName ?? DEFAULT_TABLE;

  return {
    // -- query() -----------------------------------------------------------
    async query(
      vector: number[],
      options?: VectorizeQueryOptions,
    ): Promise<VectorizeMatches> {
      const topK = options?.topK ?? 10;
      const returnMetadata = options?.returnMetadata !== false &&
        options?.returnMetadata !== "none";
      const returnValues = options?.returnValues === true;

      const { clause: filterClause, params: filterParams } = buildFilterClause(
        options?.filter as Record<string, unknown> | undefined,
        1, // $1 is the vector
      );

      const selectCols = [
        "id",
        `1 - (embedding <=> $1::vector) AS score`,
        ...(returnMetadata ? ["metadata"] : []),
        ...(returnValues ? ["embedding"] : []),
      ].join(", ");

      const sql = `
        SELECT ${selectCols}
        FROM ${table}
        WHERE 1=1 ${filterClause}
        ORDER BY embedding <=> $1::vector
        LIMIT ${topK}
      `;

      const result = await pool.query(sql, [
        toSqlVector(vector),
        ...filterParams,
      ]);

      const matches: VectorizeMatch[] = result.rows.map((
        row: Record<string, unknown>,
      ) => ({
        id: row.id as string,
        score: row.score as number,
        ...(returnMetadata && row.metadata
          ? { metadata: row.metadata as Record<string, unknown> }
          : {}),
        ...(returnValues && row.embedding
          ? { values: parsePgVector(row.embedding as string) }
          : {}),
      }));

      return { matches, count: matches.length };
    },

    // -- upsert() ----------------------------------------------------------
    async upsert(vectors: VectorizeVector[]): Promise<VectorizeVectorMutation> {
      if (vectors.length === 0) return { ids: [], count: 0 };

      const ids: string[] = [];

      // Batch upsert using a single multi-row INSERT ... ON CONFLICT.
      const valuePlaceholders: string[] = [];
      const params: unknown[] = [];

      for (let i = 0; i < vectors.length; i++) {
        const v = vectors[i];
        const offset = i * 3;
        valuePlaceholders.push(
          `($${offset + 1}, $${offset + 2}::vector, $${offset + 3}::jsonb)`,
        );
        params.push(
          v.id,
          toSqlVector(v.values),
          JSON.stringify(v.metadata ?? {}),
        );
        ids.push(v.id);
      }

      const sql = `
        INSERT INTO ${table} (id, embedding, metadata)
        VALUES ${valuePlaceholders.join(", ")}
        ON CONFLICT (id) DO UPDATE SET
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata
      `;

      await pool.query(sql, params);

      return { ids, count: ids.length };
    },

    // -- deleteByIds() -----------------------------------------------------
    async deleteByIds(ids: string[]): Promise<VectorizeVectorMutation> {
      if (ids.length === 0) return { ids: [], count: 0 };

      const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `DELETE FROM ${table} WHERE id IN (${placeholders})`;

      const result = await pool.query(sql, ids);
      const deletedCount = result.rowCount ?? 0;

      return { ids: ids.slice(0, deletedCount), count: deletedCount };
    },

    // -- getByIds() --------------------------------------------------------
    async getByIds(ids: string[]): Promise<VectorizeVector[]> {
      if (ids.length === 0) return [];

      const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
      const sql =
        `SELECT id, embedding, metadata FROM ${table} WHERE id IN (${placeholders})`;

      const result = await pool.query(sql, ids);

      return result.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        values: parsePgVector(row.embedding as string),
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      }));
    },

    // -- describe() --------------------------------------------------------
    async describe() {
      const sql = `SELECT COUNT(*) as total FROM ${table}`;
      const result = await pool.query(sql);
      const count = Number(result.rows[0]?.total ?? 0);
      return {
        name: table,
        config: { dimensions: 0, metric: "cosine" as const },
        vectorsCount: count,
        processedUpToDatetime: new Date().toISOString(),
        processedUpToMutation: "",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse pgvector text representation `[0.1,0.2,0.3]` into number[].
 */
function parsePgVector(raw: string): number[] {
  if (typeof raw !== "string") return [];
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
  if (!inner) return [];
  return inner.split(",").map(Number);
}
