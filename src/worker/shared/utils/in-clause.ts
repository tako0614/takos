/**
 * Helpers for issuing `IN (...)` / `inArray(...)` queries safely against
 * Cloudflare D1.
 *
 * D1 caps the number of bound parameters at 100 per query. drizzle expands
 * `inArray(col, values)` to one bound parameter per element with no chunking, so
 * a query over more than ~100 ids throws `D1_ERROR: too many SQL variables` in
 * production — while the libsql-backed test stack does NOT enforce the cap and
 * silently passes. Always chunk an attacker/user-growable id set before feeding
 * it to `inArray`, and merge the per-chunk rows in JS.
 */

/**
 * Conservative per-query batch size for an `inArray` id set. Kept below D1's
 * 100-parameter ceiling to leave headroom for any other bound params in the
 * same statement.
 */
export const IN_CLAUSE_CHUNK_SIZE = 90;

/**
 * Split `values` into batches of at most `chunkSize` so each batch can be passed
 * to a single `inArray(...)` query without exceeding D1's bound-parameter cap.
 * Returns `[]` for an empty input (callers should skip the query entirely).
 */
export function chunkForInClause<T>(
  values: readonly T[],
  chunkSize: number = IN_CLAUSE_CHUNK_SIZE,
): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

/**
 * Run a chunked `inArray` query and concatenate the rows. `query` is invoked
 * once per ≤`chunkSize` batch and the batches run concurrently. Returns `[]`
 * without issuing any query when `values` is empty.
 */
export async function selectInChunks<TId, TRow>(
  values: readonly TId[],
  query: (chunk: TId[]) => Promise<TRow[]>,
  chunkSize: number = IN_CLAUSE_CHUNK_SIZE,
): Promise<TRow[]> {
  if (values.length === 0) return [];
  const batches = await Promise.all(
    chunkForInClause(values, chunkSize).map((chunk) => query(chunk)),
  );
  return batches.flat();
}
