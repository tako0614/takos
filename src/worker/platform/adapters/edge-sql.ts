/**
 * Adapter for the published `module-worker.sqlite@1.0.0` binding.
 *
 * Takos' application code consumes the small D1-shaped port in
 * `shared/types/bindings.ts`, while a Worker Version installed on a
 * Takoserver receives the exact `edge.sql` three-method surface.  This module
 * is the boundary between those contracts.  It deliberately does not add a
 * migration path or a transaction emulation: the external binding owns its
 * schema and its serializable transaction operation.
 */

import type {
  EdgeSqlBinding,
  EdgeSqlEncodedBytes,
  EdgeSqlStatement,
  EdgeSqlValue,
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
} from "../../shared/types/bindings.ts";

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_SQL_PARAMETERS = 100;
const MAX_SQL_STATEMENTS = 100;

const EDGE_METHODS = ["execute", "query", "transaction"] as const;
const NATIVE_METHODS = [
  "prepare",
  "batch",
  "exec",
  "withSession",
  "dump",
] as const;

type EdgeSqlErrorCode =
  | "sql_error"
  | "numeric_out_of_range"
  | "busy"
  | "backend_unavailable";

/** A local conversion/response error carrying the published error name. */
export class EdgeSqlAdapterError extends TypeError {
  constructor(
    readonly code: "sql_error" | "numeric_out_of_range",
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

/** A binding shape cannot be selected safely. */
export class EdgeSqlShapeError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "EdgeSqlShapeError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasMethods(
  value: unknown,
  methods: readonly string[],
): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  return methods.every((method) => typeof value[method] === "function");
}

function hasAnyProperty(value: Record<string, unknown>, names: readonly string[]): boolean {
  return names.some((name) => name in value);
}

/**
 * True only for the exact external three-method method set.  Known native D1
 * members are treated as a hybrid even when they are non-callable so a partial
 * or accidentally merged binding cannot be guessed into a lane.
 */
export function isEdgeSqlBinding(value: unknown): value is EdgeSqlBinding {
  return hasMethods(value, EDGE_METHODS) &&
    !hasAnyProperty(value, NATIVE_METHODS);
}

/**
 * Native D1 is identified by the two operations the pinned Drizzle driver
 * needs.  The shared native port retains its other required methods; the
 * narrower edge adapter explicitly refuses those methods.  A binding carrying
 * any edge.sql operation is a hybrid and is refused rather than guessed into
 * the native path.
 */
export function isNativeD1Binding(value: unknown): value is SqlDatabaseBinding {
  return hasMethods(value, ["prepare", "batch"]) &&
    !hasAnyProperty(value as Record<string, unknown>, EDGE_METHODS);
}

/** Alias matching the terminology used by other platform adapters. */
export const isNativeD1Database = isNativeD1Binding;

const externallyManagedBindings = new WeakSet<object>();
const adapterCache = new WeakMap<EdgeSqlBinding, SqlDatabaseBinding>();
const edgeSqlSources = new WeakMap<SqlDatabaseBinding, EdgeSqlBinding>();

/** Whether this is the D1-shaped wrapper over an external edge.sql binding. */
export function isExternallyManagedSqlBinding(value: unknown): boolean {
  return isObject(value) && externallyManagedBindings.has(value);
}

/** Recover the exact external source behind an internal compatibility port. */
export function getEdgeSqlSourceBinding(
  value: SqlDatabaseBinding,
): EdgeSqlBinding | undefined {
  return edgeSqlSources.get(value);
}

/**
 * Resolve an incoming `DB` binding.  Undefined is preserved for entrypoints
 * that intentionally have no database; every truthy value must be one of the
 * two complete, disjoint contracts.
 */
export function resolveSqlDatabaseBinding(
  value: unknown,
): SqlDatabaseBinding | undefined {
  if (value === undefined || value === null) return undefined;
  if (isNativeD1Binding(value)) return value;
  if (isEdgeSqlBinding(value)) return adaptEdgeSqlBinding(value);
  throw new EdgeSqlShapeError(
    "DB must expose either native D1 prepare/batch or the exact edge.sql " +
      "execute/query/transaction surface; partial and hybrid bindings are refused",
  );
}

/** Short alias for callers that already know the value is a DB binding. */
export const resolveSqlBinding = resolveSqlDatabaseBinding;

function adapterError(
  code: "sql_error" | "numeric_out_of_range",
  message: string,
): EdgeSqlAdapterError {
  return new EdgeSqlAdapterError(code, `edge.sql: ${message}`);
}

function encodeBytes(bytes: Uint8Array): EdgeSqlEncodedBytes {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return { encoding: "base64", data: btoa(binary) };
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeBytes(value: EdgeSqlEncodedBytes): Uint8Array {
  if (
    value.encoding !== "base64" ||
    typeof value.data !== "string" ||
    Object.keys(value).length !== 2 ||
    !BASE64_PATTERN.test(value.data)
  ) {
    throw adapterError("sql_error", "malformed base64 encoded bytes");
  }
  let binary: string;
  try {
    binary = atob(value.data);
  } catch {
    throw adapterError("sql_error", "malformed base64 encoded bytes");
  }
  // atob accepts a few non-canonical spellings in some runtimes.  The
  // published contract is padded RFC 4648 with no whitespace, so round-trip
  // through btoa to make the canonical check explicit.
  if (btoa(binary) !== value.data) {
    throw adapterError("sql_error", "malformed base64 encoded bytes");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isEncodedBytes(value: unknown): value is EdgeSqlEncodedBytes {
  return isObject(value) && value.encoding === "base64" &&
    typeof value.data === "string";
}

/** Convert a native D1 parameter into the closed edge.sql value union. */
export function toEdgeSqlValue(value: unknown): EdgeSqlValue {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_SAFE_INTEGER) {
      throw adapterError(
        "numeric_out_of_range",
        `number ${String(value)} is outside the portable range`,
      );
    }
    return value;
  }
  if (typeof value === "boolean" || typeof value === "bigint") {
    throw adapterError(
      "sql_error",
      `${typeof value} parameters are not edge.sql values`,
    );
  }
  if (value instanceof ArrayBuffer) {
    return encodeBytes(new Uint8Array(value));
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return encodeBytes(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
  }
  if (isEncodedBytes(value)) {
    // Validate before forwarding an already-canonical value.  Returning the
    // original object also preserves the caller's exact wire representation.
    decodeBytes(value);
    return { encoding: "base64", data: value.data };
  }
  throw adapterError(
    "sql_error",
    `${Object.prototype.toString.call(value)} parameters are not edge.sql values`,
  );
}

function fromEdgeSqlValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_SAFE_INTEGER) {
      throw adapterError(
        "numeric_out_of_range",
        `number ${String(value)} is outside the portable range`,
      );
    }
    return value;
  }
  if (isEncodedBytes(value)) return decodeBytes(value);
  if (typeof value === "boolean" || typeof value === "bigint") {
    throw adapterError(
      "sql_error",
      `${typeof value} result values are not edge.sql values`,
    );
  }
  throw adapterError(
    "sql_error",
    `${Object.prototype.toString.call(value)} result values are not edge.sql values`,
  );
}

type NativeRow = Record<string, unknown>;

function mapEdgeRow(row: unknown): NativeRow {
  if (!isObject(row) || Array.isArray(row)) {
    throw adapterError("sql_error", "result rows must be records");
  }
  const mapped: NativeRow = {};
  for (const [column, value] of Object.entries(row)) {
    Object.defineProperty(mapped, column, {
      configurable: true,
      enumerable: true,
      value: fromEdgeSqlValue(value),
      writable: true,
    });
  }
  return mapped;
}

export type NormalizedEdgeSqlResult = {
  rows: NativeRow[];
  rowsWritten: number;
};

export function normalizeEdgeSqlResult(
  value: unknown,
): NormalizedEdgeSqlResult {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, "rows") ||
    !Object.prototype.hasOwnProperty.call(value, "rowsWritten") ||
    !Array.isArray(value.rows)
  ) {
    throw adapterError(
      "sql_error",
      "result must contain exactly rows and rowsWritten",
    );
  }
  if (
    typeof value.rowsWritten !== "number" ||
    !Number.isSafeInteger(value.rowsWritten) ||
    value.rowsWritten < 0
  ) {
    throw adapterError("sql_error", "rowsWritten must be a non-negative integer");
  }
  return {
    rows: value.rows.map(mapEdgeRow),
    rowsWritten: value.rowsWritten,
  };
}

export function toSqlResultBinding<T>(value: unknown): SqlResultBinding<T> {
  return normalizedEdgeSqlToSqlResultBinding(normalizeEdgeSqlResult(value));
}

export function normalizedEdgeSqlToSqlResultBinding<T>(
  result: NormalizedEdgeSqlResult,
): SqlResultBinding<T> {
  return {
    results: result.rows as T[],
    success: true,
    // `changes` is the only metadata field the Takos consumers use.  In
    // particular, edge.sql intentionally has no last-insert metadata.
    meta: { changes: result.rowsWritten },
  };
}

export function readEdgeSqlTransactionResults(
  value: unknown,
  expectedCount: number,
): readonly unknown[] {
  const results = isObject(value) &&
      Object.keys(value).length === 1 &&
      Array.isArray(value.results)
    ? value.results
    : undefined;
  if (!results || results.length !== expectedCount) {
    throw adapterError(
      "sql_error",
      `transaction returned ${results ? results.length : "an invalid"} results for ${expectedCount} statements`,
    );
  }
  return results;
}

export function encodeEdgeSqlParams(
  params: readonly unknown[],
): readonly EdgeSqlValue[] {
  if (params.length > MAX_SQL_PARAMETERS) {
    throw adapterError(
      "sql_error",
      `${params.length} parameters exceed the edge.sql limit of ${MAX_SQL_PARAMETERS}`,
    );
  }
  return params.map(toEdgeSqlValue);
}

type PreparedState = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

/** Adapt the external binding into the D1-shaped application port. */
export function adaptEdgeSqlBinding(binding: EdgeSqlBinding): SqlDatabaseBinding {
  if (!isEdgeSqlBinding(binding)) {
    throw new EdgeSqlShapeError(
      "cannot adapt a partial or hybrid edge.sql binding",
    );
  }
  const cached = adapterCache.get(binding);
  if (cached) return cached;

  const preparedStates = new WeakMap<object, PreparedState>();

  const createPrepared = (
    sql: string,
    params: readonly unknown[] = [],
  ): SqlPreparedStatementBinding => {
    const state: PreparedState = { sql, params: [...params] };
    const execute = async () => {
      const encoded = encodeEdgeSqlParams(state.params);
      const result = encoded.length === 0
        ? await binding.execute(state.sql)
        : await binding.execute(state.sql, encoded);
      return normalizeEdgeSqlResult(result);
    };

    async function raw<T = unknown[]>(options: {
      columnNames: true;
    }): Promise<[string[], ...T[]]>;
    async function raw<T = unknown[]>(options?: {
      columnNames?: false;
    }): Promise<T[]>;
    async function raw<T = unknown[]>(options?: {
      columnNames?: boolean;
    }): Promise<T[] | [string[], ...T[]]> {
      void options;
      throw new EdgeSqlShapeError(
        "edge.sql positional raw rows require projection metadata",
      );
    }

    const statement: SqlPreparedStatementBinding = {
      bind(...values: unknown[]) {
        return createPrepared(sql, values);
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const result = await execute();
        const row = result.rows[0];
        if (!row) return null;
        if (colName !== undefined) return row[colName] as T;
        return row as T;
      },
      async run<T = Record<string, unknown>>(): Promise<SqlResultBinding<T>> {
        const result = await execute();
        return {
          results: result.rows as T[],
          success: true,
          meta: { changes: result.rowsWritten },
        };
      },
      async all<T = Record<string, unknown>>(): Promise<SqlResultBinding<T>> {
        const result = await execute();
        return {
          results: result.rows as T[],
          success: true,
          meta: { changes: result.rowsWritten },
        };
      },
      raw,
    };
    preparedStates.set(statement as object, state);
    return statement;
  };

  const adapted: SqlDatabaseBinding = {
    prepare(sql: string) {
      return createPrepared(sql);
    },
    async batch<T = Record<string, unknown>>(
      statements: SqlPreparedStatementBinding[],
    ): Promise<SqlResultBinding<T>[]> {
      if (statements.length === 0) return [];
      if (statements.length > MAX_SQL_STATEMENTS) {
        throw adapterError(
          "sql_error",
          `${statements.length} statements exceed the edge.sql limit of ${MAX_SQL_STATEMENTS}`,
        );
      }
      const requests: EdgeSqlStatement[] = statements.map((statement) => {
        const state = preparedStates.get(statement as object);
        if (!state) {
          throw new EdgeSqlShapeError(
            "edge.sql batch received a statement from another database binding",
          );
        }
        const params = encodeEdgeSqlParams(state.params);
        return params.length === 0
          ? { sql: state.sql }
          : { sql: state.sql, params };
      });
      const results = readEdgeSqlTransactionResults(
        await binding.transaction(requests),
        requests.length,
      );
      return results.map((result) => toSqlResultBinding<T>(result));
    },
    async exec(_query: string): Promise<never> {
      throw new EdgeSqlShapeError(
        "edge.sql: native D1 exec is not expressible; use one prepared statement",
      );
    },
    withSession(_bookmark?: string): never {
      throw new EdgeSqlShapeError(
        "edge.sql: native D1 bookmarked sessions are not expressible",
      );
    },
    async dump(): Promise<never> {
      throw new EdgeSqlShapeError(
        "edge.sql: native D1 dumps are not expressible",
      );
    },
  };

  externallyManagedBindings.add(adapted as object);
  edgeSqlSources.set(adapted, binding);
  adapterCache.set(binding, adapted);
  return adapted;
}

// Keep the portable error code type available to focused adapter consumers
// without forcing them to duplicate the published union in their tests.
export type { EdgeSqlErrorCode };
