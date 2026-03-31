import type { ToolDefinition, ToolHandler } from '../../tool-definitions.ts';

export const D1_QUERY: ToolDefinition = {
  name: 'd1_query',
  description:
    'Execute a SQL query on D1 database. Use with caution - prefer read-only queries unless modification is explicitly needed.',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SQL query to execute',
      },
      params: {
        type: 'array',
        description: 'Query parameters (optional, for parameterized queries)',
        items: { type: 'string', description: 'Parameter value' },
      },
    },
    required: ['sql'],
  },
};

export const D1_TABLES: ToolDefinition = {
  name: 'd1_tables',
  description: 'List tables in the D1 database',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const D1_DESCRIBE: ToolDefinition = {
  name: 'd1_describe',
  description: 'Describe a table schema in D1 database',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'Table name to describe',
      },
    },
    required: ['table'],
  },
};

/**
 * Normalize SQL by removing comments and extra whitespace for security analysis.
 * This prevents bypasses through multiline comments like: DR/ * * /OP, DELETE/ *comment* /FROM
 */
function normalizeSqlForAnalysis(sql: string): string {
  let normalized = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  normalized = normalized.replace(/--[^\n\r]*/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ');
  return normalized.trim().toLowerCase();
}

/**
 * Check if SQL contains a valid WHERE clause after DELETE FROM or UPDATE.
 * Returns true if the operation is safe (has WHERE), false otherwise.
 */
function hasValidWhereClause(normalizedSql: string, operation: 'delete' | 'update'): boolean {
  if (operation === 'delete') {
    const deleteMatch = normalizedSql.match(/delete\s+from\s+\S+\s+where\s+/);
    return deleteMatch !== null;
  } else if (operation === 'update') {
    const updateMatch = normalizedSql.match(/update\s+\S+\s+set\s+[\s\S]+\s+where\s+/);
    return updateMatch !== null;
  }
  return false;
}

export const d1QueryHandler: ToolHandler = async (args, context) => {
  const sql = args.sql as string;
  const params = args.params as string[] | undefined;

  const normalizedSql = normalizeSqlForAnalysis(sql);

  const allowedPrefixes = ['select', 'explain'];
  const startsWithAllowed = allowedPrefixes.some(prefix => normalizedSql.startsWith(prefix));

  if (!startsWithAllowed) {
    const dangerous = [
      'drop table',
      'drop database',
      'drop index',
      'drop view',
      'drop trigger',
      'truncate',
      'alter table',
      'create table',
      'create index',
      'create view',
      'create trigger',
      'create database',
      'attach database',
      'attach',
      'detach database',
      'detach',
      'pragma',
      '.load',
      '.import',
      '.system',
      '.shell',
      'load_extension',
      'grant',
      'revoke',
      'vacuum',
      'reindex',
    ];

    for (const entry of dangerous) {
      if (normalizedSql.includes(entry)) {
        throw new Error(`Dangerous operation not allowed: ${entry.trim()}`);
      }
    }

    if (normalizedSql.includes('delete from') || normalizedSql.includes('delete ')) {
      if (!hasValidWhereClause(normalizedSql, 'delete')) {
        throw new Error('DELETE operations must include a WHERE clause');
      }
    }

    if (normalizedSql.match(/update\s+\S+\s+set/)) {
      if (!hasValidWhereClause(normalizedSql, 'update')) {
        throw new Error('UPDATE operations must include a WHERE clause');
      }
    }

    if (!normalizedSql.startsWith('insert') &&
        !normalizedSql.includes('delete from') &&
        !normalizedSql.match(/update\s+\S+\s+set/)) {
      throw new Error('Only SELECT, INSERT, UPDATE (with WHERE), and DELETE (with WHERE) operations are allowed');
    }
  }

  const statementCount = sql.split(';').filter((statement) => statement.trim().length > 0).length;
  if (statementCount > 1) {
    throw new Error('Multiple SQL statements not allowed. Execute one query at a time.');
  }

  let stmt = context.db.prepare(sql);

  if (params && params.length > 0) {
    stmt = stmt.bind(...params);
  }

  if (normalizedSql.startsWith('select') || normalizedSql.startsWith('explain')) {
    const result = await stmt.all();
    const rows = result.results || [];

    if (rows.length === 0) {
      return 'No results found.';
    }

    const columns = Object.keys(rows[0] as object);
    const header = columns.join(' | ');
    const separator = columns.map(() => '---').join(' | ');
    const dataRows = rows.map((row: Record<string, unknown>) => columns.map((col) => String(row[col] ?? '')).join(' | '));

    return `${header}\n${separator}\n${dataRows.join('\n')}\n\n(${rows.length} rows)`;
  }

  const result = await stmt.run();

  return `Query executed successfully.\nChanges: ${result.meta?.changes || 0}`;
};

export const d1TablesHandler: ToolHandler = async (_args, context) => {
  const result = await context.db
    .prepare(
      `
    SELECT name, type FROM sqlite_master
    WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `
    )
    .all<{ name: string; type: string }>();

  const items = result.results || [];

  if (items.length === 0) {
    return 'No tables found in database.';
  }

  const tables = items.filter((item: { name: string; type: string }) => item.type === 'table');
  const views = items.filter((item: { name: string; type: string }) => item.type === 'view');

  let output = '';
  if (tables.length > 0) {
    output += `Tables (${tables.length}):\n`;
    output += tables.map((table: { name: string; type: string }) => `  - ${table.name}`).join('\n');
  }
  if (views.length > 0) {
    if (output) output += '\n\n';
    output += `Views (${views.length}):\n`;
    output += views.map((view: { name: string; type: string }) => `  - ${view.name}`).join('\n');
  }

  return output;
};

/** Validates table name to prevent SQL injection (alphanumeric + underscore only, max 128 chars). */
function sanitizeTableName(table: string): string {
  const trimmed = table.trim();

  if (!trimmed) {
    throw new Error('Table name cannot be empty');
  }

  if (trimmed.length > 128) {
    throw new Error('Table name too long (max 128 characters)');
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    throw new Error('Invalid table name: must contain only letters, numbers, and underscores, and start with a letter or underscore');
  }

  const lowerName = trimmed.toLowerCase();
  if (lowerName.startsWith('sqlite_')) {
    throw new Error('Cannot access SQLite internal tables');
  }

  const reservedKeywords = [
    'select', 'insert', 'update', 'delete', 'drop', 'create', 'alter',
    'table', 'index', 'view', 'trigger', 'database', 'pragma', 'attach',
    'detach', 'vacuum', 'reindex', 'grant', 'revoke', 'begin', 'commit',
    'rollback', 'savepoint', 'release', 'explain', 'analyze'
  ];
  if (reservedKeywords.includes(lowerName)) {
    throw new Error('Table name cannot be a SQL reserved keyword');
  }

  return trimmed;
}

export const d1DescribeHandler: ToolHandler = async (args, context) => {
  const table = args.table as string;

  const safeName = sanitizeTableName(table);

  const tableExists = await context.db
    .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?`)
    .bind(safeName)
    .first<{ name: string }>();

  if (!tableExists) {
    throw new Error(`Table not found: ${safeName}`);
  }

  // PRAGMA doesn't support parameterized queries; sanitizeTableName above ensures safety
  const columns = await context.db
    .prepare(`PRAGMA table_info("${safeName}")`)
    .all<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>();

  if (!columns.results || columns.results.length === 0) {
    throw new Error(`Could not retrieve column info for table: ${safeName}`);
  }

  const indexes = await context.db
    .prepare(`PRAGMA index_list("${safeName}")`)
    .all<{
      seq: number;
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>();

  let output = `Table: ${safeName}\n\nColumns:\n`;
  output += 'Name | Type | Nullable | Default | PK\n';
  output += '--- | --- | --- | --- | ---\n';

  for (const col of columns.results) {
    const nullable = col.notnull ? 'NOT NULL' : 'NULL';
    const dflt = col.dflt_value ?? '-';
    const pk = col.pk ? 'YES' : '-';
    output += `${col.name} | ${col.type} | ${nullable} | ${dflt} | ${pk}\n`;
  }

  if (indexes.results && indexes.results.length > 0) {
    output += '\nIndexes:\n';
    for (const idx of indexes.results) {
      const unique = idx.unique ? ' (UNIQUE)' : '';
      output += `  - ${idx.name}${unique}\n`;
    }
  }

  return output;
};

export const D1_TOOLS: ToolDefinition[] = [D1_QUERY, D1_TABLES, D1_DESCRIBE];

export const D1_HANDLERS: Record<string, ToolHandler> = {
  d1_query: d1QueryHandler,
  d1_tables: d1TablesHandler,
  d1_describe: d1DescribeHandler,
};
