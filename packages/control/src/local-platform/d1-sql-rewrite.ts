export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inTrigger = false;
  let dollarQuoteTag: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const previous = index > 0 ? sql[index - 1] : '';
    const next = index + 1 < sql.length ? sql[index + 1] : '';

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        current += dollarQuoteTag;
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      } else {
        current += char;
      }
      continue;
    }

    if (inLineComment) {
      current += char;
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (previous === '*' && char === '/') inBlockComment = false;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '-' && next === '-') {
      inLineComment = true;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '/' && next === '*') {
      inBlockComment = true;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '$') {
      const dollarQuoteMatch = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (dollarQuoteMatch) {
        dollarQuoteTag = dollarQuoteMatch[0];
        current += dollarQuoteTag;
        index += dollarQuoteTag.length - 1;
        continue;
      }
    }

    if (char === '\'' && !inDoubleQuote && previous !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && previous !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    }

    current += char;
    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (!trimmed || /^;+$/u.test(trimmed)) {
        current = '';
        continue;
      }
      if (!inTrigger && /\bCREATE\s+TRIGGER\b/i.test(trimmed)) {
        inTrigger = true;
      }
      if (inTrigger) {
        if (/\bEND;\s*$/i.test(trimmed)) {
          statements.push(trimmed);
          current = '';
          inTrigger = false;
        }
      } else {
        statements.push(trimmed.replace(/;+$/u, ''));
        current = '';
      }
    }
  }

  const trailing = current.trim();
  if (trailing && !/^;+$/u.test(trailing)) {
    statements.push(trailing.replace(/;+$/u, ''));
  }
  return statements;
}

export function stripLeadingSqlComments(statement: string): string {
  return statement
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();
}

export function isRecoverableSqliteSchemaDuplication(error: unknown, normalizedStatement: string): boolean {
  const sqliteError = error as { message?: string; code?: string; rawCode?: number };
  const message = sqliteError.message ?? '';
  if (!/already exists|duplicate column name/i.test(message)) {
    return false;
  }

  return /^(CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|ALTER TABLE\s+"[^"]+"\s+ADD COLUMN)/i.test(
    normalizedStatement,
  );
}

export function normalizeMigrationSql(fileName: string, sql: string): string {
  if (
    fileName === '0011_service_registry_tables.sql' ||
    fileName === '0011_services_physical_tables.sql' ||
    fileName === '0013_service_tables.sql' ||
    fileName === '0013_service_table_shape_repair.sql' ||
    fileName === '0019_service_side_columns.sql'
  ) {
    return '';
  }

  return sql
    .split('\n')
    .filter((line) => !(
      line.includes('"accounts_google_sub_key"') ||
      line.includes('"accounts_google_sub_idx"') ||
      line.includes('"accounts_takos_auth_id_idx"')
    ))
    .join('\n');
}

function rewriteCreateTableForPostgres(statement: string): string[] {
  const tableMatch = statement.match(/CREATE TABLE\s+"([^"]+)"/i);
  if (!tableMatch) return [statement];

  const tableName = tableMatch[1];
  const lines = statement.replace(/;$/, '').split('\n');
  const retainedLines: string[] = [];
  const foreignKeyStatements: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('CONSTRAINT ') && trimmed.includes(' FOREIGN KEY ')) {
      foreignKeyStatements.push(
        `ALTER TABLE "${tableName}" ADD ${trimmed.replace(/,$/, '')};`,
      );
      continue;
    }
    retainedLines.push(line);
  }

  const createTableStatement = `${retainedLines.join('\n').replace(/,\s*\n\)\s*$/m, '\n)')};`;
  return [createTableStatement, ...foreignKeyStatements];
}

export function rewriteInsertOrIgnoreForPostgres(statement: string): string {
  if (!/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(statement)) {
    return statement;
  }

  const withoutKeyword = statement.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
  const trimmed = withoutKeyword.trimEnd();
  if (/ON\s+CONFLICT\b/i.test(trimmed)) {
    return withoutKeyword;
  }
  return `${trimmed.replace(/;?\s*$/, '')} ON CONFLICT DO NOTHING;`;
}

export function normalizePostgresMigrationSql(fileName: string, sql: string): string {
  if (fileName === '0015_deployments_service_id.sql') {
    return `ALTER TABLE "deployments" RENAME COLUMN "worker_id" TO "service_id";`;
  }

  if (fileName === '0022_apps_service_id.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'apps' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "apps" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_apps_worker_id";
CREATE INDEX IF NOT EXISTS "idx_apps_service_id" ON "apps" ("service_id");
`;
  }

  if (fileName === '0023_shortcut_group_items_service_id.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shortcut_group_items' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "shortcut_group_items" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
`;
  }

  if (fileName === '0024_mcp_servers_service_id.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mcp_servers' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "mcp_servers" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_mcp_servers_worker_id";
CREATE INDEX IF NOT EXISTS "idx_mcp_servers_service_id" ON "mcp_servers" ("service_id");
`;
  }

  if (fileName === '0025_file_handlers_service_hostname.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'file_handlers' AND column_name = 'worker_hostname'
  ) THEN
    ALTER TABLE "file_handlers" RENAME COLUMN "worker_hostname" TO "service_hostname";
  END IF;
END $$;
`;
  }

  if (fileName === '0026_runs_service_id.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'runs' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "runs" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_runs_worker_id";
CREATE INDEX IF NOT EXISTS "idx_runs_service_id" ON "runs" ("service_id");
`;
  }

  if (fileName === '0031_runs_service_heartbeat.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'runs' AND column_name = 'worker_heartbeat'
  ) THEN
    ALTER TABLE "runs" RENAME COLUMN "worker_heartbeat" TO "service_heartbeat";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_runs_worker_heartbeat";
CREATE INDEX IF NOT EXISTS "idx_runs_service_heartbeat" ON "runs" ("service_heartbeat");
`;
  }

  if (fileName === '0033_drop_legacy_worker_mirrors.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'services'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS "trg_services_mirror_insert_to_workers" ON "services"';
    EXECUTE 'DROP TRIGGER IF EXISTS "trg_services_mirror_update_to_workers" ON "services"';
    EXECUTE 'DROP TRIGGER IF EXISTS "trg_services_mirror_delete_to_workers" ON "services"';
  END IF;
END $$;

DROP TABLE IF EXISTS "worker_bindings";
DROP TABLE IF EXISTS "worker_common_env_links";
DROP TABLE IF EXISTS "workers";
`;
  }

  if (
    fileName === '0020_service_adjacent_service_id_columns.sql'
    || fileName === '0019_service_side_columns.sql'
  ) {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'common_env_audit_logs' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "common_env_audit_logs" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_common_env_audit_logs_worker_created_at";
CREATE INDEX IF NOT EXISTS "idx_common_env_audit_logs_service_created_at"
  ON "common_env_audit_logs" ("service_id", "created_at");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'common_env_reconcile_jobs' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "common_env_reconcile_jobs" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_common_env_reconcile_jobs_account_worker_status";
CREATE INDEX IF NOT EXISTS "idx_common_env_reconcile_jobs_account_service_status"
  ON "common_env_reconcile_jobs" ("account_id", "service_id", "status");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'custom_domains' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "custom_domains" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_custom_domains_worker_id";
CREATE INDEX IF NOT EXISTS "idx_custom_domains_service_id"
  ON "custom_domains" ("service_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'managed_takos_tokens' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "managed_takos_tokens" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_managed_takos_tokens_worker_env";
DROP INDEX IF EXISTS "idx_managed_takos_tokens_worker_id";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_managed_takos_tokens_service_env"
  ON "managed_takos_tokens" ("service_id", "env_name");
CREATE INDEX IF NOT EXISTS "idx_managed_takos_tokens_service_id"
  ON "managed_takos_tokens" ("service_id");
`;
  }

  if (
    fileName === '0016_workers_deployments_fk_repair.sql' ||
    fileName === '0017_deployment_events_deployments_fk_repair.sql' ||
    fileName === '0018_drop_worker_binding_mirrors.sql' ||
    fileName === '0019_service_side_columns.sql'
  ) {
    return '';
  }

  const transformed = normalizeMigrationSql(fileName, sql)
    .replace(/^\s*PRAGMA\s+[^;]+;?\s*$/gim, '')
    .replace(/\bDATETIME\b/g, 'TIMESTAMPTZ')
    .replace(
      /strftime\('%Y-%m-%dT%H:%M:%fZ',\s*'now'\)/gi,
      `to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    )
    .replace(
      /datetime\('now'\)/gi,
      `to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`,
    )
    .replace(
      /"([^"]+)"\s+INTEGER\s+NOT\s+NULL\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi,
      '"$1" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY',
    )
    .replace(
      /"([^"]+)"\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi,
      '"$1" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY',
    );

  const rewrittenStatements: string[] = [];
  const deferredForeignKeys: string[] = [];

  for (const statement of splitSqlStatements(transformed)) {
    const postgresStatement = rewriteInsertOrIgnoreForPostgres(statement);
    const [primaryStatement, ...foreignKeys] = rewriteCreateTableForPostgres(postgresStatement);
    rewrittenStatements.push(primaryStatement);
    deferredForeignKeys.push(...foreignKeys);
  }

  return [...rewrittenStatements, ...deferredForeignKeys].join('\n\n');
}
