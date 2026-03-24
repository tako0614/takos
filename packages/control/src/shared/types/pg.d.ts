declare module 'pg' {
  export interface QueryResultField {
    name: string;
  }

  export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
    rows: Row[];
    rowCount: number | null;
    command: string;
    oid: number;
    fields: QueryResultField[];
  }

  export interface PoolClient {
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      queryText: string,
      values?: unknown[],
    ): Promise<QueryResult<Row>>;
    release(): void;
  }

  export class Pool {
    constructor(config?: { connectionString?: string });
    connect(): Promise<PoolClient>;
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      queryText: string,
      values?: unknown[],
    ): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  }
}
