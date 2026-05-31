export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inTrigger = false;
  let dollarQuoteTag: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const previous = index > 0 ? sql[index - 1] : "";
    const next = index + 1 < sql.length ? sql[index + 1] : "";

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
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (previous === "*" && char === "/") inBlockComment = false;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "-" && next === "-") {
      inLineComment = true;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "/" && next === "*") {
      inBlockComment = true;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "$") {
      const dollarQuoteMatch = sql.slice(index).match(
        /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/,
      );
      if (dollarQuoteMatch) {
        dollarQuoteTag = dollarQuoteMatch[0];
        current += dollarQuoteTag;
        index += dollarQuoteTag.length - 1;
        continue;
      }
    }

    // String/identifier quoting uses the SQL standard doubled-quote escape
    // (`''` and `""`), NOT a backslash escape: standard-conforming Postgres and
    // SQLite do not treat `\` as a quote escape. When the matching quote is
    // doubled we consume both characters and stay in-string; otherwise we
    // toggle. This matches the sibling tokenizer in d1-shared.ts so both parsers
    // agree on the same input.
    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && next === "'") {
        current += char + next;
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && next === '"') {
        current += char + next;
        index += 1;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
    }

    current += char;
    if (char === ";" && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (!trimmed || /^;+$/u.test(trimmed)) {
        current = "";
        continue;
      }
      if (!inTrigger && /\bCREATE\s+TRIGGER\b/i.test(trimmed)) {
        inTrigger = true;
      }
      if (inTrigger) {
        if (/\bEND;\s*$/i.test(trimmed)) {
          statements.push(trimmed);
          current = "";
          inTrigger = false;
        }
      } else {
        statements.push(trimmed.replace(/;+$/u, ""));
        current = "";
      }
    }
  }

  const trailing = current.trim();
  if (trailing && !/^;+$/u.test(trailing)) {
    statements.push(trailing.replace(/;+$/u, ""));
  }
  return statements;
}

export function stripLeadingSqlComments(statement: string): string {
  return statement
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

export function isRecoverableSqliteSchemaDuplication(
  error: unknown,
  normalizedStatement: string,
): boolean {
  const sqliteError = error as {
    message?: string;
    code?: string;
    rawCode?: number;
  };
  const message = sqliteError.message ?? "";
  if (!/already exists|duplicate column name/i.test(message)) {
    return false;
  }

  return /^(CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|ALTER TABLE\s+"[^"]+"\s+ADD COLUMN)/i
    .test(
      normalizedStatement,
    );
}

export function normalizeMigrationSql(fileName: string, sql: string): string {
  if (fileName === "0013_service_tables.sql") {
    return "";
  }

  return sql
    .split("\n")
    .filter((line) =>
      !(
        line.includes('"accounts_google_sub_key"') ||
        line.includes('"accounts_google_sub_idx"') ||
        line.includes('"accounts_takos_auth_id_idx"')
      )
    )
    .join("\n");
}

function rewriteCreateTableForPostgres(statement: string): string[] {
  const tableMatch = statement.match(/CREATE TABLE\s+"([^"]+)"/i);
  if (!tableMatch) return [statement];

  const tableName = tableMatch[1];
  const lines = statement.replace(/;$/, "").split("\n");
  const retainedLines: string[] = [];
  const foreignKeyStatements: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("CONSTRAINT ") && trimmed.includes(" FOREIGN KEY ")
    ) {
      foreignKeyStatements.push(
        `ALTER TABLE "${tableName}" ADD ${trimmed.replace(/,$/, "")};`,
      );
      continue;
    }
    retainedLines.push(line);
  }

  const createTableStatement = `${
    retainedLines.join("\n").replace(/,\s*\n\)\s*$/m, "\n)")
  };`;
  return [createTableStatement, ...foreignKeyStatements];
}

function terminateSqlStatement(statement: string): string {
  const trimmed = statement.trim();
  if (!trimmed) return "";
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

function isSqliteCreateTriggerStatement(statement: string): boolean {
  return /^CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+/i.test(statement) &&
    /\bBEGIN\b/i.test(statement) &&
    /\bEND;?\s*$/i.test(statement);
}

export function rewriteInsertOrIgnoreForPostgres(statement: string): string {
  if (!/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(statement)) {
    return statement;
  }

  const withoutKeyword = statement.replace(
    /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i,
    "INSERT INTO",
  );
  const trimmed = withoutKeyword.trimEnd();
  if (/ON\s+CONFLICT\b/i.test(trimmed)) {
    return withoutKeyword;
  }
  return `${trimmed.replace(/;?\s*$/, "")} ON CONFLICT DO NOTHING;`;
}

function rewriteCreateIndexForPostgres(statement: string): string {
  return statement
    .replace(
      /(^|\n)(\s*)CREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS\b)/i,
      "$1$2CREATE UNIQUE INDEX IF NOT EXISTS ",
    )
    .replace(
      /(^|\n)(\s*)CREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS\b)/i,
      "$1$2CREATE INDEX IF NOT EXISTS ",
    );
}

export function normalizePostgresMigrationSql(
  fileName: string,
  sql: string,
): string {
  if (fileName === "0015_deployments_service_id.sql") {
    return `ALTER TABLE "deployments" RENAME COLUMN "worker_id" TO "service_id";`;
  }

  if (fileName === "0022_apps_service_id.sql") {
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

  if (fileName === "0023_shortcut_group_items_service_id.sql") {
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

  if (fileName === "0024_mcp_servers_service_id.sql") {
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

  if (fileName === "0025_file_handlers_service_hostname.sql") {
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

  if (fileName === "0026_runs_service_id.sql") {
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

  if (fileName === "0031_runs_service_heartbeat.sql") {
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

  if (fileName === "0033_drop_legacy_worker_mirrors.sql") {
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

DROP TABLE IF EXISTS "worker_bindings" CASCADE;
DROP TABLE IF EXISTS "worker_common_env_links" CASCADE;
DROP TABLE IF EXISTS "workers" CASCADE;
`;
  }

  if (fileName === "0036_group_inventory_unification.sql") {
    return `
ALTER TABLE groups ADD COLUMN desired_spec_json TEXT;
ALTER TABLE groups ADD COLUMN observed_state_json TEXT;
ALTER TABLE groups ADD COLUMN backend_state_json TEXT;
ALTER TABLE groups ADD COLUMN reconcile_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE groups ADD COLUMN last_applied_at TEXT;

UPDATE groups
SET desired_spec_json = manifest_json
WHERE desired_spec_json IS NULL
  AND manifest_json IS NOT NULL;

UPDATE groups
SET backend_state_json = '{}'
WHERE backend_state_json IS NULL;

ALTER TABLE services ADD COLUMN group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_services_group_id ON services(group_id);

ALTER TABLE resources ADD COLUMN group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_resources_group_id ON resources(group_id);
ALTER TABLE resources ADD COLUMN manifest_key TEXT;
CREATE INDEX IF NOT EXISTS idx_resources_manifest_key ON resources(manifest_key);

INSERT INTO resources (
  id,
  owner_account_id,
  account_id,
  group_id,
  name,
  type,
  status,
  cf_id,
  cf_name,
  config,
  metadata,
  manifest_key,
  created_at,
  updated_at
)
SELECT
  ge.id,
  g.space_id,
  g.space_id,
  ge.group_id,
  ge.name,
  COALESCE(ge.config::jsonb ->> 'type', 'kv'),
  'active',
  ge.config::jsonb ->> 'cfResourceId',
  ge.config::jsonb ->> 'cfName',
  ge.config,
  '{}',
  ge.name,
  ge.created_at::timestamptz,
  ge.updated_at::timestamptz
FROM group_entities ge
JOIN groups g ON g.id = ge.group_id
WHERE ge.category = 'resource'
ON CONFLICT DO NOTHING;

INSERT INTO services (
  id,
  account_id,
  group_id,
  service_type,
  status,
  config,
  hostname,
  route_ref,
  slug,
  workload_kind,
  created_at,
  updated_at
)
SELECT
  ge.id,
  g.space_id,
  ge.group_id,
  CASE WHEN ge.category = 'worker' THEN 'app' ELSE 'service' END,
  'deployed',
  jsonb_build_object(
    'managedBy', 'group',
    'manifestName', ge.name,
    'componentKind', ge.category,
    'specFingerprint', '',
    'deployedAt', ge.config::jsonb -> 'deployedAt',
    'codeHash', ge.config::jsonb -> 'codeHash',
    'imageHash', ge.config::jsonb -> 'imageHash',
    'imageRef', ge.config::jsonb -> 'imageRef',
    'port', ge.config::jsonb -> 'port',
    'ipv4', ge.config::jsonb -> 'ipv4',
    'dispatchNamespace', ge.config::jsonb -> 'dispatchNamespace',
    'legacyConfig', ge.config::jsonb
  )::text,
  NULL,
  CASE WHEN ge.category = 'worker' THEN ge.config::jsonb ->> 'scriptName' ELSE NULL END,
  format('grp-%s-%s-%s', substr(ge.group_id, 1, 8), ge.category, replace(lower(ge.name), ' ', '-')),
  CASE WHEN ge.category = 'worker' THEN 'worker-bundle' ELSE 'container-image' END,
  ge.created_at::timestamptz,
  ge.updated_at::timestamptz
FROM group_entities ge
JOIN groups g ON g.id = ge.group_id
WHERE ge.category IN ('worker', 'container', 'service')
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS group_entities;
`;
  }

  if (fileName === "0037_resource_capability_cleanup.sql") {
    const jsonConfig =
      `CASE WHEN config IS JSON THEN config::jsonb ELSE '{}'::jsonb END`;
    const setCapability = (capability: string, implementation: string) =>
      `jsonb_set(jsonb_set(${jsonConfig}, '{resourceCapability}', to_jsonb('${capability}'::text), true), '{implementation}', to_jsonb('${implementation}'::text), true)::text`;
    return `
UPDATE resources
SET
  type = 'sql',
  config = ${setCapability("sql", "d1")}
WHERE type = 'd1';

UPDATE resources
SET
  type = 'object_store',
  config = ${setCapability("object_store", "r2")}
WHERE type = 'r2';

UPDATE resources
SET
  config = ${setCapability("kv", "kv")}
WHERE type = 'kv';

UPDATE resources
SET
  config = ${setCapability("queue", "queue")}
WHERE type = 'queue';

UPDATE resources
SET
  type = 'vector_index',
  config = ${setCapability("vector_index", "vectorize")}
WHERE type = 'vectorize';

UPDATE resources
SET
  type = 'analytics_store',
  config = ${setCapability("analytics_store", "analytics_engine")}
WHERE type IN ('analyticsEngine', 'analytics_engine');

UPDATE resources
SET
  type = 'secret',
  config = ${setCapability("secret", "secret_ref")}
WHERE type IN ('secretRef', 'secret_ref');

UPDATE resources
SET
  type = 'workflow_runtime',
  config = ${setCapability("workflow_runtime", "workflow_binding")}
WHERE type IN ('workflow', 'workflow_binding');

UPDATE resources
SET
  type = 'durable_namespace',
  config = ${setCapability("durable_namespace", "durable_object_namespace")}
WHERE type IN ('durableObject', 'durable_object', 'durable_object_namespace');

UPDATE service_bindings SET binding_type = 'sql' WHERE binding_type = 'd1';
UPDATE service_bindings SET binding_type = 'object_store' WHERE binding_type IN ('r2', 'r2_bucket');
UPDATE service_bindings SET binding_type = 'vector_index' WHERE binding_type = 'vectorize';
UPDATE service_bindings SET binding_type = 'analytics_store' WHERE binding_type IN ('analyticsEngine', 'analytics_engine');
UPDATE service_bindings SET binding_type = 'workflow_runtime' WHERE binding_type = 'workflow';
UPDATE service_bindings SET binding_type = 'durable_namespace' WHERE binding_type = 'durable_object_namespace';
`;
  }

  if (fileName === "0038_group_provider_cleanup.sql") {
    return `
UPDATE groups
SET desired_spec_json = CASE
  WHEN desired_spec_json IS NOT NULL
    AND desired_spec_json IS JSON
    AND desired_spec_json::jsonb ? 'manifest'
    THEN (desired_spec_json::jsonb -> 'manifest')::text
  WHEN desired_spec_json IS NULL AND manifest_json IS NOT NULL
    THEN manifest_json
  ELSE desired_spec_json
END;

ALTER TABLE groups DROP COLUMN manifest_json;
ALTER TABLE groups DROP COLUMN observed_state_json;
`;
  }

  if (fileName === "0062_group_deployment_snapshot_build_sources_v2.sql") {
    return `
UPDATE group_deployment_snapshots
SET build_sources_json = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'service_name', value ->> 'service_name',
        'artifact_path', value ->> 'artifact_path'
      )
    ),
    '[]'::jsonb
  )::text
  FROM jsonb_array_elements(group_deployment_snapshots.build_sources_json::jsonb) AS item(value)
  WHERE value ? 'service_name'
    AND value ? 'artifact_path'
)
WHERE build_sources_json IS NOT NULL
  AND build_sources_json IS JSON
  AND jsonb_typeof(build_sources_json::jsonb) = 'array';
`;
  }

  if (fileName === "0055_repair_service_fk_rename_artifacts.sql") {
    return "";
  }

  if (
    fileName === "0020_service_adjacent_service_id_columns.sql" ||
    fileName === "0019_service_side_columns.sql"
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
`;
  }

  if (
    fileName === "0016_workers_deployments_fk_repair.sql" ||
    fileName === "0017_deployment_events_deployments_fk_repair.sql" ||
    fileName === "0018_drop_worker_binding_mirrors.sql" ||
    fileName === "0019_service_side_columns.sql"
  ) {
    return "";
  }

  const transformed = normalizeMigrationSql(fileName, sql)
    .replace(/^\s*PRAGMA\s+[^;]+;?\s*$/gim, "")
    .replace(/\bDATETIME\b/g, "TIMESTAMPTZ")
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
    if (isSqliteCreateTriggerStatement(statement)) continue;
    const postgresStatement = rewriteCreateIndexForPostgres(
      rewriteInsertOrIgnoreForPostgres(statement),
    );
    const [primaryStatement, ...foreignKeys] = rewriteCreateTableForPostgres(
      postgresStatement,
    );
    rewrittenStatements.push(primaryStatement);
    deferredForeignKeys.push(...foreignKeys);
  }

  return [...rewrittenStatements, ...deferredForeignKeys]
    .map(terminateSqlStatement)
    .filter(Boolean)
    .join("\n\n");
}
