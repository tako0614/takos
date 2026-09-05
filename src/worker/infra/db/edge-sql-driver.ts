import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import type { Cache } from "drizzle-orm/cache/core";
import { NoopCache } from "drizzle-orm/cache/core";
import type { WithCacheConfig } from "drizzle-orm/cache/core/types";
import { Column } from "drizzle-orm/column";
import { is } from "drizzle-orm/entity";
import {
  DefaultLogger,
  NoopLogger,
  type Logger,
} from "drizzle-orm/logger";
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  type ExtractTablesWithRelations,
  type RelationalSchemaConfig,
  type TablesRelationalConfig,
} from "drizzle-orm/relations";
import {
  fillPlaceholders,
  type Query,
  type QueryWithTypings,
  SQL,
  sql,
} from "drizzle-orm/sql";
import {
  BaseSQLiteDatabase,
  SQLiteAsyncDialect,
  SQLitePreparedQuery,
  SQLiteSession,
  type SQLiteExecuteMethod,
  type SQLiteTransaction,
  type SQLiteTransactionConfig,
} from "drizzle-orm/sqlite-core";
import type { SQLiteDeleteConfig } from "drizzle-orm/sqlite-core/query-builders/delete";
import type { SQLiteInsertConfig } from "drizzle-orm/sqlite-core/query-builders/insert";
import type { SQLiteSelectConfig } from "drizzle-orm/sqlite-core/query-builders/select.types";
import type { SelectedFieldsOrdered } from "drizzle-orm/sqlite-core/query-builders/select.types";
import type { SQLiteUpdateConfig } from "drizzle-orm/sqlite-core/query-builders/update";
import { Subquery } from "drizzle-orm/subquery";
import type { DrizzleConfig } from "drizzle-orm/utils";
import * as drizzleRuntimeUtils from "drizzle-orm/utils";

import {
  EdgeSqlAdapterError,
  encodeEdgeSqlParams,
  normalizedEdgeSqlToSqlResultBinding,
  normalizeEdgeSqlResult,
  readEdgeSqlTransactionResults,
  type NormalizedEdgeSqlResult,
  toSqlResultBinding,
} from "../../platform/adapters/edge-sql.ts";
import type {
  EdgeSqlBinding,
  EdgeSqlStatement,
  SqlResultBinding,
} from "../../shared/types/bindings.ts";

const executionPlan = Symbol("takos.edge-sql.execution-plan");
const PROJECTION_ALIAS_PREFIX = "__takos_edge_sql_v1_c";
const MAX_TRANSACTION_STATEMENTS = 100;

type QueryMetadata = {
  type: "select" | "update" | "delete" | "insert";
  tables: string[];
};

type AliasedSelectionField = SQL.Aliased & {
  isSelectionField: boolean;
};

type PreparedQueryInternals = {
  joinsNotNullableMap?: Record<string, boolean>;
  queryWithCache<T>(
    query: string,
    params: unknown[],
    execute: () => Promise<T>,
  ): Promise<T>;
};

const { mapResultRow, orderSelectedFields } = drizzleRuntimeUtils as unknown as {
  mapResultRow(
    fields: SelectedFieldsOrdered,
    row: unknown[],
    joinsNotNullableMap?: Record<string, boolean>,
  ): unknown;
  orderSelectedFields(fields: Record<string, unknown>): SelectedFieldsOrdered;
};

function isSelectionField(value: SQL.Aliased): boolean {
  return (value as AliasedSelectionField).isSelectionField === true;
}

type ProjectionPlan =
  | { readonly kind: "select"; readonly config: SQLiteSelectConfig }
  | { readonly kind: "insert"; readonly config: SQLiteInsertConfig }
  | { readonly kind: "update"; readonly config: SQLiteUpdateConfig }
  | { readonly kind: "delete"; readonly config: SQLiteDeleteConfig };

type PlannedQuery = QueryWithTypings & {
  [executionPlan]?: ProjectionPlan;
};

type ProjectionAliases = {
  readonly fields: SelectedFieldsOrdered;
  readonly names: readonly string[];
  readonly references: ReadonlyMap<SQL, ReadonlyMap<string, string>>;
};

function projectionAlias(index: number): string {
  return `${PROJECTION_ALIAS_PREFIX}${index}x`;
}

function singleTableSql(value: SQL): SQL {
  return new SQL(
    value.queryChunks.map((chunk) =>
      is(chunk, Column) ? sql.identifier(chunk.name) : chunk
    ),
  );
}

function projectionExpression(
  field: SelectedFieldsOrdered[number]["field"],
  isSingleTable: boolean,
): SQL {
  if (is(field, SQL.Aliased)) {
    if (isSelectionField(field)) return sql`${field}`;
    return isSingleTable ? singleTableSql(field.sql) : field.sql;
  }
  if (is(field, SQL)) {
    return isSingleTable ? singleTableSql(field) : field;
  }
  if (is(field, Column)) {
    const column = isSingleTable
      ? sql`${sql.identifier(field.name)}`
      : sql`${field}`;
    return field.columnType === "SQLiteNumericBigInt"
      ? sql`cast(${column} as text)`
      : column;
  }
  if (is(field, Subquery)) return sql`${field}`;
  throw new TypeError("edge.sql: unsupported Drizzle projection field");
}

function aliasProjection(
  fields: SelectedFieldsOrdered,
  isSingleTable: boolean,
): ProjectionAliases {
  const references = new Map<SQL, Map<string, string>>();
  const names = fields.map((_field, index) => projectionAlias(index));
  const aliasedFields = fields.map((entry, index) => {
    const name = names[index]!;
    if (is(entry.field, SQL.Aliased)) {
      const byName = references.get(entry.field.sql) ?? new Map<string, string>();
      byName.set(entry.field.fieldAlias, name);
      references.set(entry.field.sql, byName);
    }
    return {
      ...entry,
      field: projectionExpression(entry.field, isSingleTable).as(name),
    };
  });
  return { fields: aliasedFields, names, references };
}

function rewriteAliasReference(
  value: SQL | SQL.Aliased,
  references: ReadonlyMap<SQL, ReadonlyMap<string, string>>,
): SQL | SQL.Aliased {
  if (is(value, SQL.Aliased)) {
    if (isSelectionField(value)) {
      const alias = references.get(value.sql)?.get(value.fieldAlias);
      if (alias) return sql`${sql.identifier(alias)}`;
    }
    const rewritten = new SQL.Aliased(
      rewriteAliasReference(value.sql, references) as SQL,
      value.fieldAlias,
    );
    (rewritten as AliasedSelectionField).isSelectionField =
      isSelectionField(value);
    return rewritten;
  }

  return new SQL(
    value.queryChunks.map((chunk) => {
      if (is(chunk, SQL) || is(chunk, SQL.Aliased)) {
        return rewriteAliasReference(chunk, references);
      }
      return chunk;
    }),
  );
}

function rewriteAliasReferences<T extends Column | SQL | SQL.Aliased>(
  values: readonly T[] | undefined,
  references: ReadonlyMap<SQL, ReadonlyMap<string, string>>,
): T[] | undefined {
  return values?.map((value) =>
    is(value, SQL) || is(value, SQL.Aliased)
      ? rewriteAliasReference(value, references) as T
      : value
  );
}

class EdgeSqlDialect extends SQLiteAsyncDialect {
  readonly #plans = new WeakMap<SQL, ProjectionPlan>();

  override buildSelectQuery(config: SQLiteSelectConfig): SQL {
    const statement = super.buildSelectQuery(config);
    this.#plans.set(statement, { kind: "select", config });
    return statement;
  }

  override buildInsertQuery(config: SQLiteInsertConfig): SQL {
    const statement = super.buildInsertQuery(config);
    this.#plans.set(statement, { kind: "insert", config });
    return statement;
  }

  override buildUpdateQuery(config: SQLiteUpdateConfig): SQL {
    const statement = super.buildUpdateQuery(config);
    this.#plans.set(statement, { kind: "update", config });
    return statement;
  }

  override buildDeleteQuery(config: SQLiteDeleteConfig): SQL {
    const statement = super.buildDeleteQuery(config);
    this.#plans.set(statement, { kind: "delete", config });
    return statement;
  }

  override sqlToQuery(
    statement: SQL,
    invokeSource?: "indexes",
  ): QueryWithTypings {
    const query = super.sqlToQuery(statement, invokeSource) as PlannedQuery;
    const plan = this.#plans.get(statement);
    if (plan) query[executionPlan] = plan;
    return query;
  }

  forExecution(query: Query): {
    readonly query: Query;
    readonly aliases?: readonly string[];
    readonly operation?: "execute" | "query";
  } {
    const plan = (query as PlannedQuery)[executionPlan];
    if (!plan) return { query };

    const fields = plan.kind === "select"
      ? plan.config.fieldsFlat ?? orderSelectedFields(plan.config.fields)
      : plan.config.returning;
    if (!fields) return { query };
    const aliased = aliasProjection(
      fields,
      plan.kind !== "select" ||
        !plan.config.joins || plan.config.joins.length === 0,
    );
    let statement: SQL;
    switch (plan.kind) {
      case "select":
        statement = super.buildSelectQuery({
          ...plan.config,
          fieldsFlat: aliased.fields,
          orderBy: rewriteAliasReferences(
            plan.config.orderBy,
            aliased.references,
          ),
          groupBy: rewriteAliasReferences(
            plan.config.groupBy,
            aliased.references,
          ),
          setOperators: plan.config.setOperators.map((operator) => ({
            ...operator,
            orderBy: rewriteAliasReferences(
              operator.orderBy,
              aliased.references,
            ),
          })),
        });
        break;
      case "insert":
        statement = super.buildInsertQuery({
          ...plan.config,
          returning: aliased.fields,
        });
        break;
      case "update":
        statement = super.buildUpdateQuery({
          ...plan.config,
          returning: aliased.fields,
        });
        break;
      case "delete":
        statement = super.buildDeleteQuery({
          ...plan.config,
          returning: aliased.fields,
        });
        break;
    }
    return {
      query: super.sqlToQuery(statement),
      aliases: aliased.names,
      operation: plan.kind === "select" ? "query" : "execute",
    };
  }
}

function rowsByProjection(
  rows: readonly Readonly<Record<string, unknown>>[],
  aliases: readonly string[] | undefined,
): unknown[][] {
  if (!aliases) {
    throw new TypeError(
      "edge.sql: positional results require Drizzle projection metadata",
    );
  }
  return rows.map((row) => {
    if (Object.keys(row).length !== aliases.length) {
      throw new EdgeSqlAdapterError(
        "sql_error",
        "edge.sql: projected result columns do not match",
      );
    }
    return aliases.map((alias) => {
      if (!Object.prototype.hasOwnProperty.call(row, alias)) {
        throw new EdgeSqlAdapterError(
          "sql_error",
          `edge.sql: projected result is missing ${alias}`,
        );
      }
      return row[alias];
    });
  });
}

class EdgeSqlPreparedQuery extends SQLitePreparedQuery<{
  type: "async";
  run: SqlResultBinding;
  all: unknown;
  get: unknown;
  values: unknown[][];
  execute: unknown;
}> {
  constructor(
    private readonly binding: EdgeSqlBinding,
    query: Query,
    private readonly aliases: readonly string[] | undefined,
    private readonly logger: Logger,
    cache: Cache,
    queryMetadata: QueryMetadata | undefined,
    cacheConfig: WithCacheConfig | undefined,
    private readonly fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    private readonly responseInArrayMode: boolean,
    private readonly customResultMapper?: (rows: unknown[][]) => unknown,
    operation?: "execute" | "query",
  ) {
    super(
      "async",
      executeMethod,
      query,
      cache,
      queryMetadata,
      cacheConfig,
    );
    this.operation = operation ??
      (queryMetadata?.type === "select" ? "query" : "execute");
  }

  private readonly operation: "execute" | "query";

  private async invoke(
    placeholderValues?: Record<string, unknown>,
  ): Promise<NormalizedEdgeSqlResult> {
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
    const encoded = encodeEdgeSqlParams(params);
    this.logger.logQuery(this.query.sql, params);
    return await (this as unknown as PreparedQueryInternals)
      .queryWithCache<NormalizedEdgeSqlResult>(
        this.query.sql,
        params,
        async () => {
          const result = this.operation === "query"
            ? await this.binding.query(
              this.query.sql,
              encoded.length > 0 ? encoded : undefined,
            )
            : await this.binding.execute(
              this.query.sql,
              encoded.length > 0 ? encoded : undefined,
            );
          const normalized = normalizeEdgeSqlResult(result);
          if (this.operation === "query" && normalized.rowsWritten !== 0) {
            throw new EdgeSqlAdapterError(
              "sql_error",
              `edge.sql: rollback-only query returned rowsWritten ${normalized.rowsWritten}`,
            );
          }
          return normalized;
        },
      );
  }

  private mapRows(result: NormalizedEdgeSqlResult): unknown {
    if (!this.fields && !this.customResultMapper) return result.rows;
    const rows = rowsByProjection(result.rows, this.aliases);
    if (this.customResultMapper) return this.customResultMapper(rows);
    return rows.map((row) =>
      mapResultRow(
        this.fields!,
        row,
        (this as unknown as PreparedQueryInternals).joinsNotNullableMap,
      )
    );
  }

  override async run(
    placeholderValues?: Record<string, unknown>,
  ): Promise<SqlResultBinding> {
    return normalizedEdgeSqlToSqlResultBinding(
      await this.invoke(placeholderValues),
    );
  }

  override async all(
    placeholderValues?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.mapRows(await this.invoke(placeholderValues));
  }

  override async get(
    placeholderValues?: Record<string, unknown>,
  ): Promise<unknown> {
    const result = await this.invoke(placeholderValues);
    if (!this.fields && !this.customResultMapper) return result.rows[0];
    if (result.rows.length === 0) return undefined;
    if (this.customResultMapper) {
      return this.customResultMapper(rowsByProjection(result.rows, this.aliases));
    }
    const fields = this.fields;
    if (!fields) throw new TypeError("edge.sql: missing projection fields");
    return mapResultRow(
      fields,
      rowsByProjection(result.rows, this.aliases)[0]!,
      (this as unknown as PreparedQueryInternals).joinsNotNullableMap,
    );
  }

  override async values(
    placeholderValues?: Record<string, unknown>,
  ): Promise<unknown[][]> {
    if (!this.aliases) {
      throw new TypeError(
        "edge.sql: positional results require Drizzle projection metadata",
      );
    }
    const result = await this.invoke(placeholderValues);
    return rowsByProjection(result.rows, this.aliases);
  }

  override mapRunResult(result: unknown): SqlResultBinding {
    return toSqlResultBinding(result);
  }

  override mapAllResult(result: unknown): unknown {
    return this.mapRows(normalizeEdgeSqlResult(result));
  }

  override mapGetResult(result: unknown): unknown {
    const normalized = normalizeEdgeSqlResult(result);
    if (!this.fields && !this.customResultMapper) return normalized.rows[0];
    if (normalized.rows.length === 0) return undefined;
    if (this.customResultMapper) {
      return this.customResultMapper(
        rowsByProjection(normalized.rows, this.aliases),
      );
    }
    const fields = this.fields;
    if (!fields) throw new TypeError("edge.sql: missing projection fields");
    return mapResultRow(
      fields,
      rowsByProjection(normalized.rows, this.aliases)[0]!,
      (this as unknown as PreparedQueryInternals).joinsNotNullableMap,
    );
  }

  /** @internal Drizzle batch discriminator. */
  isResponseInArrayMode(): boolean {
    return this.responseInArrayMode;
  }
}

class EdgeSqlSession<
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
> extends SQLiteSession<"async", SqlResultBinding, TFullSchema, TSchema> {
  constructor(
    private readonly binding: EdgeSqlBinding,
    private readonly edgeDialect: EdgeSqlDialect,
    private readonly logger: Logger,
    private readonly cache: Cache,
  ) {
    super(edgeDialect);
  }

  override prepareQuery(
    query: Query,
    fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    isResponseInArrayMode: boolean,
    customResultMapper?: (rows: unknown[][]) => unknown,
    queryMetadata?: QueryMetadata,
    cacheConfig?: WithCacheConfig,
  ): SQLitePreparedQuery<any> {
    const execution = this.edgeDialect.forExecution(query);
    return new EdgeSqlPreparedQuery(
      this.binding,
      execution.query,
      execution.aliases,
      this.logger,
      this.cache,
      queryMetadata,
      cacheConfig,
      fields,
      executeMethod,
      isResponseInArrayMode,
      customResultMapper,
      execution.operation,
    );
  }

  async batch(
    queries: readonly BatchItem<"sqlite">[],
  ): Promise<unknown[]> {
    if (queries.length < 1) {
      throw new EdgeSqlAdapterError(
        "sql_error",
        "edge.sql: a transaction requires at least one statement",
      );
    }
    if (queries.length > MAX_TRANSACTION_STATEMENTS) {
      throw new EdgeSqlAdapterError(
        "sql_error",
        `edge.sql: ${queries.length} statements exceed the edge.sql limit of ${MAX_TRANSACTION_STATEMENTS}`,
      );
    }
    const prepared = queries.map((query) =>
      (query as unknown as { _prepare(): unknown })._prepare() as {
        getQuery(): Query;
        mapResult(result: unknown, isFromBatch?: boolean): unknown;
      }
    );
    const statements: EdgeSqlStatement[] = prepared.map((query) => {
      const built = query.getQuery();
      const params = encodeEdgeSqlParams(built.params);
      return params.length > 0
        ? { sql: built.sql, params }
        : { sql: built.sql };
    });
    const results = readEdgeSqlTransactionResults(
      await this.binding.transaction(statements),
      statements.length,
    );
    return results.map((result, index) =>
      prepared[index]!.mapResult(result, true)
    );
  }

  extractRawRunValueFromBatchResult(result: unknown): unknown {
    return toSqlResultBinding(result);
  }

  extractRawAllValueFromBatchResult(result: unknown): unknown {
    return normalizeEdgeSqlResult(result).rows;
  }

  extractRawGetValueFromBatchResult(result: unknown): unknown {
    return normalizeEdgeSqlResult(result).rows[0];
  }

  extractRawValuesValueFromBatchResult(_result: unknown): never {
    throw new TypeError(
      "edge.sql: positional results require Drizzle projection metadata",
    );
  }

  override async transaction<T>(
    _transaction: (
      tx: SQLiteTransaction<"async", SqlResultBinding, TFullSchema, TSchema>,
    ) => Promise<T>,
    _config?: SQLiteTransactionConfig,
  ): Promise<T> {
    throw new TypeError(
      "edge.sql: callback transactions are not expressible; use db.batch()",
    );
  }
}

export class EdgeSqlDatabase<
  TSchema extends Record<string, unknown> = Record<string, never>,
> extends BaseSQLiteDatabase<"async", SqlResultBinding, TSchema> {
  constructor(
    dialect: EdgeSqlDialect,
    private readonly edgeSession: EdgeSqlSession<
      TSchema,
      ExtractTablesWithRelations<TSchema>
    >,
    schema: RelationalSchemaConfig<ExtractTablesWithRelations<TSchema>> | undefined,
  ) {
    super("async", dialect, edgeSession, schema);
  }

  async batch<
    U extends BatchItem<"sqlite">,
    T extends Readonly<[U, ...U[]]>,
  >(batch: T): Promise<BatchResponse<T>> {
    return await this.edgeSession.batch(batch) as BatchResponse<T>;
  }
}

export function drizzleEdgeSql<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  binding: EdgeSqlBinding,
  config: DrizzleConfig<TSchema> = {},
): EdgeSqlDatabase<TSchema> & { readonly $client: EdgeSqlBinding } {
  const dialect = new EdgeSqlDialect({ casing: config.casing });
  const logger = config.logger === true
    ? new DefaultLogger()
    : config.logger === false || config.logger === undefined
    ? new NoopLogger()
    : config.logger;

  let relationalSchema:
    | RelationalSchemaConfig<ExtractTablesWithRelations<TSchema>>
    | undefined;
  if (config.schema) {
    const tables = extractTablesRelationalConfig(
      config.schema,
      createTableRelationsHelpers,
    );
    relationalSchema = {
      fullSchema: config.schema,
      schema: tables.tables as ExtractTablesWithRelations<TSchema>,
      tableNamesMap: tables.tableNamesMap,
    };
  }

  const session = new EdgeSqlSession(
    binding,
    dialect,
    logger,
    config.cache ?? new NoopCache(),
  );
  const db = new EdgeSqlDatabase(
    dialect,
    session,
    relationalSchema,
  ) as EdgeSqlDatabase<TSchema> & { $client: EdgeSqlBinding };
  db.$client = binding;
  return db;
}
