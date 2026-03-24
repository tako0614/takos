#!/usr/bin/env npx tsx
/**
 * Unified admin CLI for takos-control.
 *
 * - D1 operations use Cloudflare D1 Management API.
 * - R2 operations use Cloudflare R2 Management API.
 * - Moderation commands support ban/unban/show-user.
 *
 * Usage examples:
 *   npx tsx scripts/admin-cli.ts d1 ping --env production
 *   npx tsx scripts/admin-cli.ts d1 query "SELECT COUNT(*) AS c FROM users"
 *   npx tsx scripts/admin-cli.ts r2 list offload --prefix backups/d1
 *   npx tsx scripts/admin-cli.ts moderation ban USER_ID --reason "abuse"
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CloudflareApiClient } from '@takos/control-core/application/services/cloudflare/api-client';
import { sanitizeErrorMessage } from '@takos/control-core/application/services/wfp/client';

type DeployEnvironment = 'production' | 'staging';

type GlobalOptions = {
  environment: DeployEnvironment;
  isJson: boolean;
  approvalId?: string;
  scopeWorkspaceId?: string;
  scopeUserId?: string;
  scopeR2Prefix?: string;
  accountIdOverride?: string;
  apiTokenOverride?: string;
  databaseIdOverride?: string;
};

type ResolvedConfig = {
  environment: DeployEnvironment;
  accountId: string;
  apiToken: string;
  d1DatabaseId?: string;
  r2Buckets: Record<string, string>;
};

type D1Statement = {
  results?: unknown[];
  meta?: {
    changes?: number;
  };
  success?: boolean;
  error?: string;
};

type AuditEntry = {
  command: string;
  env: DeployEnvironment;
  start: string;
  end: string;
  success: boolean;
  count: number | null;
  error?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WRANGLER_TOML_PATH = path.resolve(__dirname, '../wrangler.toml');
const AUDIT_LOG_DIR = process.env.TAKOS_DB_AUDIT_LOG_DIR?.trim() || path.join(os.homedir(), '.takos', 'audit');
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, 'admin-cli-operations.jsonl');

const VALID_USER_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
const APPROVAL_ID_PATTERN = /^[A-Za-z0-9._:-]{6,128}$/;
const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 500;
const DEFAULT_R2_PAGE_SIZE = 100;
const MAX_R2_PAGE_SIZE = 1000;
const TENANT_SQL_TABLE_TOKENS = [
  'threads',
  'messages',
  'runs',
  'artifacts',
  'run_events',
  'files',
  'blobs',
  'snapshots',
  'space_stats',
  'usage_events',
  'usage_rollups',
  'repositories',
  'resources',
  'service_bindings',
  'deployments',
  'spaces',
];
const TENANT_R2_PREFIXES = [
  'threads/',
  'spaces/',
  'tenants/',
  'users/',
  'messages/',
  'runs/',
  'artifacts/',
  'snapshots/',
  'blobs/',
  'repos/',
  'deployments/',
];

// ---------------------------------------------------------------------------
// Secrets management — Worker config map
// ---------------------------------------------------------------------------

type WorkerSecretSpec = {
  alias: string;
  config: string;
  required: string[];
  optional: string[];
  /** Secrets that should use the same value as another worker's secret (source alias) */
  shared?: Record<string, string>;
};

const WORKER_SECRETS: WorkerSecretSpec[] = [
  {
    alias: 'web',
    config: 'wrangler.toml',
    required: [
      'GOOGLE_CLIENT_SECRET',
      'PLATFORM_PRIVATE_KEY', 'PLATFORM_PUBLIC_KEY',
      'CF_API_TOKEN',
      'ENCRYPTION_KEY',
    ],
    optional: [
      'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'SERPER_API_KEY',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
      'AUDIT_IP_HASH_KEY',
    ],
  },
  {
    alias: 'worker',
    config: 'wrangler.worker.toml',
    required: ['ENCRYPTION_KEY'],
    optional: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'SERPER_API_KEY', 'CF_API_TOKEN'],
  },
  {
    alias: 'runtime-host',
    config: 'wrangler.runtime-host.toml',
    required: [],
    optional: ['JWT_PUBLIC_KEY'],
  },
  {
    alias: 'executor',
    config: 'wrangler.executor.toml',
    required: [],
    optional: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'SERPER_API_KEY'],
  },
  {
    alias: 'dispatch',
    config: 'wrangler.dispatch.toml',
    required: [],
    optional: [],
  },
];

/** Known legacy secrets that should be removed */
const LEGACY_SECRETS = new Set([
  'BUILD_SERVICE_TOKEN',
  'JWT_SECRET',
  'SERVICE_API_KEY',
  'SERVICE_SIGNING_ACTIVE_KID',
  'SERVICE_SIGNING_KEYS',
  'YURUCOMMU_HOSTED_API_KEY',
  'HOSTED_SERVICE_SECRET',
]);

const SECRETS_DIR_BASE = path.resolve(__dirname, '../.secrets');

function print(message: string, isJson: boolean): void {
  if (!isJson) {
    console.log(message);
  }
}

function fail(message: string): never {
  throw new Error(message);
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return randomBytes(16).toString('hex');
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullable(value: string | null | undefined): string {
  if (value == null) {
    return 'NULL';
  }
  return sqlLiteral(value);
}

function appendAuditLog(entry: AuditEntry): void {
  try {
    fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: failed to write audit log (${AUDIT_LOG_FILE}): ${message}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTomlPrimitive(rawValue: string): string {
  const trimmed = rawValue.trim();
  const noComment = trimmed.replace(/\s+#.*$/, '').trim();
  if ((noComment.startsWith('"') && noComment.endsWith('"')) || (noComment.startsWith("'") && noComment.endsWith("'"))) {
    return noComment.slice(1, -1);
  }
  return noComment;
}

function parseTomlKeyValueBlock(block: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const lineRegex = /^\s*([A-Za-z0-9_]+)\s*=\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(block)) !== null) {
    parsed[match[1]] = parseTomlPrimitive(match[2]);
  }
  return parsed;
}

function readTomlSection(text: string, sectionName: string): Record<string, string> | null {
  const sectionRegex = new RegExp(
    `^\\[${escapeRegExp(sectionName)}\\]\\s*\\n([\\s\\S]*?)(?=^\\[[^\\[]|^\\[\\[|(?![\\s\\S]))`,
    'm'
  );
  const section = text.match(sectionRegex);
  if (!section) {
    return null;
  }
  return parseTomlKeyValueBlock(section[1]);
}

function readTomlArraySections(text: string, arraySectionName: string): Array<Record<string, string>> {
  const arrayRegex = new RegExp(
    `^\\[\\[${escapeRegExp(arraySectionName)}\\]\\]\\s*\\n([\\s\\S]*?)(?=^\\[\\[|^\\[[^\\[]|(?![\\s\\S]))`,
    'gm'
  );

  const entries: Array<Record<string, string>> = [];
  let match: RegExpExecArray | null;
  while ((match = arrayRegex.exec(text)) !== null) {
    entries.push(parseTomlKeyValueBlock(match[1]));
  }
  return entries;
}

function readWranglerToml(): string | null {
  try {
    return fs.readFileSync(WRANGLER_TOML_PATH, 'utf8');
  } catch {
    return null;
  }
}

function inferDefaultR2Buckets(environment: DeployEnvironment): Record<string, string> {
  const suffix = environment === 'staging' ? '-staging' : '';
  return {
    bundles: `takos-worker-bundles${suffix}`,
    builds: `takos-tenant-builds${suffix}`,
    source: `takos-tenant-source${suffix}`,
    git: `takos-git-objects${suffix}`,
    offload: `takos-offload${suffix}`,
  };
}

function inferR2BucketAliases(
  environment: DeployEnvironment,
  wranglerToml: string | null,
): Record<string, string> {
  const aliases = inferDefaultR2Buckets(environment);

  if (!wranglerToml) {
    return aliases;
  }

  const envPrefix = environment === 'production' ? 'env.production' : 'env.staging';
  const envEntries = readTomlArraySections(wranglerToml, `${envPrefix}.r2_buckets`);
  const rootEntries = readTomlArraySections(wranglerToml, 'r2_buckets');
  const entries = envEntries.length > 0 ? envEntries : rootEntries;

  for (const entry of entries) {
    const bucketName = entry.bucket_name;
    const binding = entry.binding;
    if (!bucketName) {
      continue;
    }

    aliases[bucketName] = bucketName;

    if (binding) {
      aliases[binding.toLowerCase()] = bucketName;
      switch (binding) {
        case 'WORKER_BUNDLES':
          aliases.bundles = bucketName;
          break;
        case 'TENANT_BUILDS':
          aliases.builds = bucketName;
          break;
        case 'TENANT_SOURCE':
          aliases.source = bucketName;
          break;
        case 'GIT_OBJECTS':
          aliases.git = bucketName;
          break;
        case 'TAKOS_OFFLOAD':
          aliases.offload = bucketName;
          break;
        default:
          break;
      }
    }
  }

  return aliases;
}

function inferD1DatabaseId(
  environment: DeployEnvironment,
  wranglerToml: string | null,
): string | undefined {
  if (!wranglerToml) {
    return undefined;
  }

  const envPrefix = environment === 'production' ? 'env.production' : 'env.staging';
  const envEntries = readTomlArraySections(wranglerToml, `${envPrefix}.d1_databases`);
  const rootEntries = readTomlArraySections(wranglerToml, 'd1_databases');
  const entries = envEntries.length > 0 ? envEntries : rootEntries;

  const dbEntry = entries.find((entry) => entry.binding === 'DB') || entries[0];
  return dbEntry?.database_id;
}

function inferAccountId(
  environment: DeployEnvironment,
  wranglerToml: string | null,
): string | undefined {
  if (!wranglerToml) {
    return undefined;
  }

  const envPrefix = environment === 'production' ? 'env.production' : 'env.staging';
  const varsSection = readTomlSection(wranglerToml, `${envPrefix}.vars`) || readTomlSection(wranglerToml, 'vars');
  if (varsSection?.CF_ACCOUNT_ID) {
    return varsSection.CF_ACCOUNT_ID;
  }

  const accountIdMatch = wranglerToml.match(/^\s*account_id\s*=\s*(.+)$/m);
  if (!accountIdMatch) {
    return undefined;
  }

  return parseTomlPrimitive(accountIdMatch[1]);
}

function takeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

function takeOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const next = args[index + 1];
  if (!next || next.startsWith('--')) {
    fail(`Option ${flag} requires a value.`);
  }

  args.splice(index, 2);
  return next;
}

function parsePositiveInt(raw: string | undefined, optionName: string, defaultValue: number, maxValue: number): number {
  if (!raw) {
    return defaultValue;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${optionName} must be a positive integer.`);
  }

  return Math.min(value, maxValue);
}

function normalizeSqlForAnalysis(sql: string): string {
  let normalized = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  normalized = normalized.replace(/--[^\n\r]*/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ');
  return normalized.trim().toLowerCase();
}

function hasValidWhereClause(normalizedSql: string, operation: 'delete' | 'update'): boolean {
  if (operation === 'delete') {
    return /delete\s+from\s+\S+\s+where\s+/.test(normalizedSql);
  }
  return /update\s+\S+\s+set\s+[\s\S]+\s+where\s+/.test(normalizedSql);
}

function validateQuerySafety(sql: string): void {
  const normalized = normalizeSqlForAnalysis(sql);
  const statements = normalized.split(';').map((statement) => statement.trim()).filter(Boolean);
  const hasUnsafeStatement = statements.some((statement) => {
    const hasDelete = /\bdelete\s+from\b/.test(statement);
    const hasUpdate = /\bupdate\s+\S+\s+set\b/.test(statement);

    if (hasDelete && !hasValidWhereClause(statement, 'delete')) {
      return true;
    }
    if (hasUpdate && !hasValidWhereClause(statement, 'update')) {
      return true;
    }
    return false;
  });

  if (!hasUnsafeStatement) {
    return;
  }

  fail('Refusing to execute UPDATE/DELETE without WHERE.');
}

function detectTenantSqlTokens(sql: string): string[] {
  const normalized = normalizeSqlForAnalysis(sql);
  return TENANT_SQL_TABLE_TOKENS.filter((token) => {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
    return pattern.test(normalized);
  });
}

function requireApprovalId(options: GlobalOptions, contextLabel: string): string {
  const approvalId = String(options.approvalId || '').trim();
  if (!approvalId) {
    fail(`${contextLabel} requires --approval-id.`);
  }
  if (!APPROVAL_ID_PATTERN.test(approvalId)) {
    fail(`Invalid --approval-id format: ${approvalId}`);
  }
  return approvalId;
}

function enforceTenantSqlAccessPolicy(sql: string, options: GlobalOptions): void {
  const matchedTokens = detectTenantSqlTokens(sql);
  if (matchedTokens.length === 0) {
    return;
  }

  requireApprovalId(options, `Tenant/workspace D1 access (${matchedTokens.join(', ')})`);

  const scopeWorkspaceId = String(options.scopeWorkspaceId || '').trim();
  const scopeUserId = String(options.scopeUserId || '').trim();
  if (!scopeWorkspaceId && !scopeUserId) {
    fail('Tenant/workspace D1 access requires --scope-workspace-id or --scope-user-id.');
  }

  const normalized = normalizeSqlForAnalysis(sql);
  let hasBoundPredicate = false;

  if (scopeWorkspaceId) {
    if (!/\bworkspace_id\b/.test(normalized)) {
      fail('Tenant/workspace D1 access with --scope-workspace-id requires workspace_id predicate in SQL.');
    }
    if (!normalized.includes(scopeWorkspaceId.toLowerCase())) {
      fail(`SQL must include scoped workspace id literal: ${scopeWorkspaceId}`);
    }
    hasBoundPredicate = true;
  }

  if (scopeUserId) {
    if (!/\buser_id\b/.test(normalized)) {
      fail('Tenant/workspace D1 access with --scope-user-id requires user_id predicate in SQL.');
    }
    if (!normalized.includes(scopeUserId.toLowerCase())) {
      fail(`SQL must include scoped user id literal: ${scopeUserId}`);
    }
    hasBoundPredicate = true;
  }

  if (!hasBoundPredicate) {
    fail('Tenant/workspace D1 access requires scoped predicates.');
  }
}

function isLikelyTenantR2Path(pathOrPrefix: string): boolean {
  const normalized = normalizePrefix(pathOrPrefix).toLowerCase();
  if (!normalized) {
    // Full bucket scan can include tenant data; require explicit scoped prefix.
    return true;
  }
  return TENANT_R2_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function enforceTenantR2AccessPolicy(options: GlobalOptions, operation: string, pathOrPrefix: string): void {
  if (!isLikelyTenantR2Path(pathOrPrefix)) {
    return;
  }

  requireApprovalId(options, `Tenant/workspace R2 access (${operation})`);

  const scopePrefix = normalizePrefix(options.scopeR2Prefix || '');
  if (!scopePrefix) {
    fail(`Tenant/workspace R2 access (${operation}) requires --scope-r2-prefix.`);
  }

  const normalizedTarget = normalizePrefix(pathOrPrefix);
  if (!normalizedTarget) {
    fail(`R2 ${operation} requires a target prefix within --scope-r2-prefix (${scopePrefix}).`);
  }

  if (!(normalizedTarget === scopePrefix || normalizedTarget.startsWith(`${scopePrefix}/`))) {
    fail(`R2 ${operation} target must stay within --scope-r2-prefix (${scopePrefix}).`);
  }
}

function resolveEnvironment(args: string[]): DeployEnvironment {
  const envOption = takeOption(args, '--env');
  const hasStaging = takeFlag(args, '--staging');
  const hasRemote = takeFlag(args, '--remote');
  const hasLocal = takeFlag(args, '--local');

  if (hasLocal) {
    fail('Local mode is not supported by admin-cli. Use Cloudflare API targets (production/staging).');
  }

  if (envOption) {
    if (envOption !== 'production' && envOption !== 'staging') {
      fail(`Unsupported --env value: ${envOption}. Use production or staging.`);
    }
    return envOption;
  }

  if (hasStaging) {
    return 'staging';
  }

  if (hasRemote) {
    return 'production';
  }

  return 'production';
}

function parseGlobalOptions(rawArgs: string[]): { remainingArgs: string[]; options: GlobalOptions } {
  const args = [...rawArgs];

  const environment = resolveEnvironment(args);
  const isJson = takeFlag(args, '--json');
  const approvalId = takeOption(args, '--approval-id');
  const scopeWorkspaceId = takeOption(args, '--scope-workspace-id');
  const scopeUserId = takeOption(args, '--scope-user-id');
  const scopeR2Prefix = normalizePrefix(takeOption(args, '--scope-r2-prefix'));

  const accountIdOverride = takeOption(args, '--account-id');
  const apiTokenOverride = takeOption(args, '--api-token');
  const databaseIdOverride = takeOption(args, '--database-id');

  return {
    remainingArgs: args,
    options: {
      environment,
      isJson,
      approvalId,
      scopeWorkspaceId,
      scopeUserId,
      scopeR2Prefix,
      accountIdOverride,
      apiTokenOverride,
      databaseIdOverride,
    },
  };
}

function resolveConfig(options: GlobalOptions): ResolvedConfig {
  const wranglerToml = readWranglerToml();
  const accountId =
    options.accountIdOverride ||
    process.env.CF_ACCOUNT_ID ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    inferAccountId(options.environment, wranglerToml);

  const apiToken =
    options.apiTokenOverride ||
    process.env.CF_API_TOKEN ||
    process.env.CLOUDFLARE_API_TOKEN;

  const d1DatabaseId =
    options.databaseIdOverride ||
    process.env.TAKOS_D1_DATABASE_ID ||
    inferD1DatabaseId(options.environment, wranglerToml);

  if (!accountId) {
    fail('CF_ACCOUNT_ID is required (env var or wrangler.toml).');
  }

  if (!apiToken) {
    fail('CF_API_TOKEN (or CLOUDFLARE_API_TOKEN) is required.');
  }

  return {
    environment: options.environment,
    accountId,
    apiToken,
    d1DatabaseId,
    r2Buckets: inferR2BucketAliases(options.environment, wranglerToml),
  };
}

function requireD1DatabaseId(config: ResolvedConfig): string {
  if (!config.d1DatabaseId) {
    fail('D1 database_id is required (set TAKOS_D1_DATABASE_ID or configure wrangler.toml).');
  }
  return config.d1DatabaseId;
}

function createClient(config: ResolvedConfig): CloudflareApiClient {
  return new CloudflareApiClient({
    accountId: config.accountId,
    apiToken: config.apiToken,
  });
}

async function executeD1Sql(config: ResolvedConfig, sql: string): Promise<D1Statement[]> {
  const client = createClient(config);
  const databaseId = requireD1DatabaseId(config);
  return client.accountPost<D1Statement[]>(`/d1/database/${databaseId}/query`, { sql });
}

function extractResults(statements: D1Statement[]): unknown[] {
  const first = statements[0] ?? {};
  return Array.isArray(first.results) ? first.results : [];
}

function extractChangeCount(statements: D1Statement[]): number {
  const first = statements[0] ?? {};
  const changed = Number(first.meta?.changes ?? 0);
  if (Number.isFinite(changed) && changed > 0) {
    return changed;
  }
  return extractResults(statements).length;
}

async function cmdD1Ping(config: ResolvedConfig, options: GlobalOptions): Promise<number> {
  const result = await executeD1Sql(config, 'SELECT 1 AS ok');
  if (options.isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    print(`D1 ping succeeded (${config.environment})`, options.isJson);
    console.table(extractResults(result) as Record<string, unknown>[]);
  }
  return 1;
}

async function cmdD1Tables(config: ResolvedConfig, options: GlobalOptions): Promise<number> {
  const result = await executeD1Sql(
    config,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );

  const rows = extractResults(result);
  if (options.isJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.table(rows as Record<string, unknown>[]);
  }
  return rows.length;
}

async function cmdD1Query(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const localArgs = [...args];
  const sqlOption = takeOption(localArgs, '--sql');
  const sql = (sqlOption || localArgs.join(' ')).trim();
  if (!sql) {
    fail('SQL query is required. Usage: d1 query "<sql>"');
  }

  validateQuerySafety(sql);
  enforceTenantSqlAccessPolicy(sql, options);
  const result = await executeD1Sql(config, sql);
  const rows = extractResults(result);

  if (options.isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (rows.length > 0) {
    console.table(rows as Record<string, unknown>[]);
  } else {
    print('Query executed successfully.', options.isJson);
    print(`Affected rows: ${extractChangeCount(result)}`, options.isJson);
  }

  return extractChangeCount(result);
}

function resolveBucketName(config: ResolvedConfig, input: string): string {
  const key = input.toLowerCase();
  return config.r2Buckets[key] || config.r2Buckets[input] || input;
}

async function cmdR2List(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const localArgs = [...args];
  const bucketArg = localArgs.shift();
  if (!bucketArg) {
    fail('Bucket is required. Usage: r2 list <bucket> [--prefix <prefix>] [--cursor <cursor>]');
  }

  const prefix = takeOption(localArgs, '--prefix');
  const cursor = takeOption(localArgs, '--cursor');
  const limit = parsePositiveInt(takeOption(localArgs, '--limit'), '--limit', DEFAULT_R2_PAGE_SIZE, MAX_R2_PAGE_SIZE);
  enforceTenantR2AccessPolicy(options, 'list', prefix || '');

  const bucketName = resolveBucketName(config, bucketArg);
  const client = createClient(config);

  const query = new URLSearchParams();
  query.set('per_page', String(limit));
  if (prefix) query.set('prefix', prefix);
  if (cursor) query.set('cursor', cursor);

  const pathSuffix = query.toString().length > 0 ? `?${query.toString()}` : '';
  const result = await client.accountGet<{
    objects: Array<{ key: string; size: number; uploaded: string; etag: string }>;
    truncated: boolean;
    cursor?: string;
  }>(`/r2/buckets/${bucketName}/objects${pathSuffix}`);

  if (options.isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.table(result.objects || []);
    print(`truncated: ${result.truncated ? 'yes' : 'no'}`, options.isJson);
    if (result.cursor) {
      print(`next cursor: ${result.cursor}`, options.isJson);
    }
  }

  return (result.objects || []).length;
}

async function cmdR2Get(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const localArgs = [...args];
  const bucketArg = localArgs.shift();
  const key = localArgs.shift();
  if (!bucketArg || !key) {
    fail('Usage: r2 get <bucket> <key> [--output <path>]');
  }

  const outputPath = takeOption(localArgs, '--output');
  enforceTenantR2AccessPolicy(options, 'get', key);
  const bucketName = resolveBucketName(config, bucketArg);
  const client = createClient(config);

  const response = await client.fetchRaw(
    `/accounts/${config.accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`,
    { method: 'GET' },
  );

  if (!response.ok) {
    const text = await response.text();
    fail(`R2 get failed: ${response.status} ${sanitizeErrorMessage(text || response.statusText)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, buffer);

    if (options.isJson) {
      console.log(JSON.stringify({ bucket: bucketName, key, output: resolved, bytes: buffer.length }, null, 2));
    } else {
      print(`Saved ${buffer.length} bytes to ${resolved}`, options.isJson);
    }
    return 1;
  }

  if (options.isJson) {
    console.log(JSON.stringify({ bucket: bucketName, key, bytes: buffer.length, body: buffer.toString('utf8') }, null, 2));
  } else {
    process.stdout.write(buffer.toString('utf8'));
    if (!buffer.toString('utf8').endsWith('\n')) {
      process.stdout.write('\n');
    }
  }

  return 1;
}

async function putR2Object(
  config: ResolvedConfig,
  bucketName: string,
  key: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const client = createClient(config);
  const response = await client.fetchRaw(
    `/accounts/${config.accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: data,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    fail(`R2 put failed (${key}): ${response.status} ${sanitizeErrorMessage(text || response.statusText)}`);
  }
}

async function cmdR2Put(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const localArgs = [...args];
  const bucketArg = localArgs.shift();
  const key = localArgs.shift();
  const filePath = localArgs.shift();

  if (!bucketArg || !key || !filePath) {
    fail('Usage: r2 put <bucket> <key> <file> [--content-type <type>]');
  }

  const contentType = takeOption(localArgs, '--content-type') || 'application/octet-stream';
  enforceTenantR2AccessPolicy(options, 'put', key);
  const bucketName = resolveBucketName(config, bucketArg);
  const resolvedFilePath = path.resolve(filePath);

  if (!fs.existsSync(resolvedFilePath)) {
    fail(`File not found: ${resolvedFilePath}`);
  }

  const stat = fs.statSync(resolvedFilePath);
  if (!stat.isFile()) {
    fail(`Not a file: ${resolvedFilePath}`);
  }

  const data = fs.readFileSync(resolvedFilePath);
  await putR2Object(config, bucketName, key, data, contentType);

  if (options.isJson) {
    console.log(JSON.stringify({ bucket: bucketName, key, file: resolvedFilePath, bytes: data.length }, null, 2));
  } else {
    print(`Uploaded ${resolvedFilePath} -> ${bucketName}/${key} (${data.length} bytes)`, options.isJson);
  }

  return 1;
}

async function cmdR2Delete(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const localArgs = [...args];
  const bucketArg = localArgs.shift();
  const key = localArgs.shift();
  if (!bucketArg || !key) {
    fail('Usage: r2 delete <bucket> <key>');
  }

  enforceTenantR2AccessPolicy(options, 'delete', key);
  const bucketName = resolveBucketName(config, bucketArg);
  const client = createClient(config);
  const response = await client.fetchRaw(
    `/accounts/${config.accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  );

  if (!response.ok) {
    const text = await response.text();
    fail(`R2 delete failed: ${response.status} ${sanitizeErrorMessage(text || response.statusText)}`);
  }

  if (options.isJson) {
    console.log(JSON.stringify({ bucket: bucketName, key, deleted: true }, null, 2));
  } else {
    print(`Deleted ${bucketName}/${key}`, options.isJson);
  }

  return 1;
}

function collectFilesRecursive(rootDir: string): string[] {
  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) {
    return '';
  }
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '');
}

async function cmdR2UploadDir(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const localArgs = [...args];
  const bucketArg = localArgs.shift();
  const dirPath = localArgs.shift();
  const prefixArg = localArgs.shift();

  if (!bucketArg || !dirPath) {
    fail('Usage: r2 upload-dir <bucket> <dir> [prefix] [--content-type <type>]');
  }

  const contentType = takeOption(localArgs, '--content-type') || 'application/octet-stream';
  const bucketName = resolveBucketName(config, bucketArg);
  const resolvedDirPath = path.resolve(dirPath);
  const normalizedPrefix = normalizePrefix(prefixArg);
  enforceTenantR2AccessPolicy(options, 'upload-dir', normalizedPrefix);

  if (!fs.existsSync(resolvedDirPath)) {
    fail(`Directory not found: ${resolvedDirPath}`);
  }

  const stat = fs.statSync(resolvedDirPath);
  if (!stat.isDirectory()) {
    fail(`Not a directory: ${resolvedDirPath}`);
  }

  const files = collectFilesRecursive(resolvedDirPath);

  let uploaded = 0;
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    const rel = path.relative(resolvedDirPath, file).split(path.sep).join('/');
    const objectKey = normalizedPrefix ? `${normalizedPrefix}/${rel}` : rel;
    try {
      const data = fs.readFileSync(file);
      await putR2Object(config, bucketName, objectKey, data, contentType);
      uploaded += 1;
      if (!options.isJson) {
        print(`uploaded: ${objectKey}`, options.isJson);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ file: objectKey, error: sanitizeErrorMessage(message) });
      if (!options.isJson) {
        print(`failed: ${objectKey} (${message})`, options.isJson);
      }
    }
  }

  if (options.isJson) {
    console.log(JSON.stringify({
      bucket: bucketName,
      directory: resolvedDirPath,
      prefix: normalizedPrefix || null,
      uploaded,
      failed: errors.length,
      errors,
    }, null, 2));
  } else {
    print(`Upload summary: uploaded=${uploaded}, failed=${errors.length}`, options.isJson);
  }

  return uploaded;
}

function ensureValidUserId(userId: string, fieldName: string): void {
  if (!VALID_USER_ID_PATTERN.test(userId)) {
    fail(`Invalid ${fieldName}: ${userId}`);
  }
}

async function fetchUserRow(config: ResolvedConfig, userId: string): Promise<Record<string, unknown>> {
  const result = await executeD1Sql(
    config,
    `SELECT id, email, username, name FROM users WHERE id = ${sqlLiteral(userId)} LIMIT 1`,
  );

  const row = extractResults(result)[0] as Record<string, unknown> | undefined;
  if (!row) {
    fail(`User not found: ${userId}`);
  }
  return row;
}

async function fetchModerationRow(config: ResolvedConfig, userId: string): Promise<Record<string, unknown> | null> {
  const result = await executeD1Sql(
    config,
    `SELECT user_id, status, suspended_until, banned_at, warn_count, last_warn_at, reason, updated_at FROM user_moderation WHERE user_id = ${sqlLiteral(userId)} LIMIT 1`,
  );

  const row = extractResults(result)[0] as Record<string, unknown> | undefined;
  return row ?? null;
}

async function insertModerationAuditLog(input: {
  config: ResolvedConfig;
  actorUserId?: string;
  targetUser: Record<string, unknown>;
  actionType: 'ban' | 'unban';
  reason?: string;
  previousStatus: string;
  nextStatus: string;
  createdAt: string;
}): Promise<void> {
  const targetUserId = String(input.targetUser.id || '');
  const targetLabel = String(input.targetUser.username || input.targetUser.email || targetUserId);
  const details = JSON.stringify({
    source: 'admin-cli',
    previous_status: input.previousStatus,
    next_status: input.nextStatus,
    environment: input.config.environment,
  });

  const sql = `
    INSERT INTO moderation_audit_logs (
      id, actor_user_id, report_id, target_type, target_id, target_label,
      action_type, reason, details, created_at
    ) VALUES (
      ${sqlLiteral(randomId())},
      ${sqlNullable(input.actorUserId)},
      NULL,
      'user',
      ${sqlLiteral(targetUserId)},
      ${sqlLiteral(targetLabel)},
      ${sqlLiteral(input.actionType)},
      ${sqlNullable(input.reason)},
      ${sqlLiteral(details)},
      ${sqlLiteral(input.createdAt)}
    )
  `;

  await executeD1Sql(input.config, sql);
}

async function cmdModerationShowUser(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const userId = args[0];
  if (!userId) {
    fail('Usage: moderation show-user <user_id>');
  }
  ensureValidUserId(userId, 'user_id');

  const user = await fetchUserRow(config, userId);
  const moderation = await fetchModerationRow(config, userId);

  const output = {
    user,
    moderation: moderation || {
      user_id: userId,
      status: 'active',
      suspended_until: null,
      banned_at: null,
      warn_count: 0,
      last_warn_at: null,
      reason: null,
      updated_at: null,
    },
  };

  if (options.isJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    print('User:', options.isJson);
    console.table([output.user as Record<string, unknown>]);
    print('Moderation:', options.isJson);
    console.table([output.moderation as Record<string, unknown>]);
  }

  return 1;
}

async function validateActorUserId(config: ResolvedConfig, actorUserId: string | undefined): Promise<void> {
  if (!actorUserId) {
    return;
  }

  ensureValidUserId(actorUserId, 'actor_user_id');

  const result = await executeD1Sql(
    config,
    `SELECT id FROM users WHERE id = ${sqlLiteral(actorUserId)} LIMIT 1`,
  );

  if (!extractResults(result)[0]) {
    fail(`Actor user not found: ${actorUserId}`);
  }
}

async function cmdModerationBan(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const localArgs = [...args];
  const userId = localArgs.shift();
  if (!userId) {
    fail('Usage: moderation ban <user_id> [--reason <text>] [--actor-user-id <id>]');
  }
  ensureValidUserId(userId, 'user_id');

  const reason = takeOption(localArgs, '--reason');
  const actorUserId = takeOption(localArgs, '--actor-user-id');
  await validateActorUserId(config, actorUserId);

  const user = await fetchUserRow(config, userId);
  const previousModeration = await fetchModerationRow(config, userId);
  const previousStatus = String(previousModeration?.status || 'active');
  const timestamp = nowIso();

  const sql = `
    INSERT INTO user_moderation (user_id, status, banned_at, reason, updated_at)
    VALUES (
      ${sqlLiteral(userId)},
      'banned',
      ${sqlLiteral(timestamp)},
      ${sqlNullable(reason)},
      ${sqlLiteral(timestamp)}
    )
    ON CONFLICT(user_id) DO UPDATE SET
      status = 'banned',
      suspended_until = NULL,
      banned_at = excluded.banned_at,
      reason = excluded.reason,
      updated_at = excluded.updated_at
  `;

  await executeD1Sql(config, sql);

  await insertModerationAuditLog({
    config,
    actorUserId,
    targetUser: user,
    actionType: 'ban',
    reason,
    previousStatus,
    nextStatus: 'banned',
    createdAt: timestamp,
  });

  const moderation = await fetchModerationRow(config, userId);
  const output = { user, moderation, previous_status: previousStatus, updated_status: 'banned' };

  if (options.isJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    print(`User banned: ${userId}`, options.isJson);
    if (reason) {
      print(`reason: ${reason}`, options.isJson);
    }
    console.table([moderation as Record<string, unknown>]);
  }

  return 1;
}

async function cmdModerationUnban(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const localArgs = [...args];
  const userId = localArgs.shift();
  if (!userId) {
    fail('Usage: moderation unban <user_id> [--reason <text>] [--actor-user-id <id>]');
  }
  ensureValidUserId(userId, 'user_id');

  const reason = takeOption(localArgs, '--reason');
  const actorUserId = takeOption(localArgs, '--actor-user-id');
  await validateActorUserId(config, actorUserId);

  const user = await fetchUserRow(config, userId);
  const previousModeration = await fetchModerationRow(config, userId);
  const previousStatus = String(previousModeration?.status || 'active');
  const timestamp = nowIso();

  const sql = `
    INSERT INTO user_moderation (user_id, status, suspended_until, banned_at, reason, updated_at)
    VALUES (
      ${sqlLiteral(userId)},
      'active',
      NULL,
      NULL,
      ${sqlNullable(reason)},
      ${sqlLiteral(timestamp)}
    )
    ON CONFLICT(user_id) DO UPDATE SET
      status = 'active',
      suspended_until = NULL,
      banned_at = NULL,
      reason = excluded.reason,
      updated_at = excluded.updated_at
  `;

  await executeD1Sql(config, sql);

  await insertModerationAuditLog({
    config,
    actorUserId,
    targetUser: user,
    actionType: 'unban',
    reason,
    previousStatus,
    nextStatus: 'active',
    createdAt: timestamp,
  });

  const moderation = await fetchModerationRow(config, userId);
  const output = { user, moderation, previous_status: previousStatus, updated_status: 'active' };

  if (options.isJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    print(`User unbanned: ${userId}`, options.isJson);
    if (reason) {
      print(`reason: ${reason}`, options.isJson);
    }
    console.table([moderation as Record<string, unknown>]);
  }

  return 1;
}

async function cmdUsersList(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const localArgs = [...args];
  const limit = parsePositiveInt(takeOption(localArgs, '--limit'), '--limit', DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

  const sql = `
    SELECT id, name, email, username, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  const result = await executeD1Sql(config, sql);
  const rows = extractResults(result);

  if (options.isJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.table(rows as Record<string, unknown>[]);
    print(`Total: ${rows.length}`, options.isJson);
  }

  return rows.length;
}

async function cmdReposList(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const localArgs = [...args];
  const limit = parsePositiveInt(takeOption(localArgs, '--limit'), '--limit', DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

  const sql = `
    SELECT r.id, r.name, r.space_id, r.visibility, r.created_at,
           w.name AS space_name
    FROM repositories r
    LEFT JOIN spaces w ON r.space_id = w.id
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `;

  const result = await executeD1Sql(config, sql);
  const rows = extractResults(result);

  if (options.isJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.table(rows as Record<string, unknown>[]);
    print(`Total: ${rows.length}`, options.isJson);
  }

  return rows.length;
}

async function cmdReposBranches(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const repoIdentifier = args[0];
  if (!repoIdentifier) {
    fail('Usage: repos branches <repo_id_or_name>');
  }

  const repoLookup = await executeD1Sql(
    config,
    `SELECT id, name FROM repositories WHERE id = ${sqlLiteral(repoIdentifier)} OR name = ${sqlLiteral(repoIdentifier)} LIMIT 1`,
  );
  const repo = extractResults(repoLookup)[0] as Record<string, unknown> | undefined;

  if (!repo) {
    fail(`Repository not found: ${repoIdentifier}`);
  }

  const repoId = String(repo.id);
  const sql = `
    SELECT b.id, b.name, b.commit_sha, b.is_default, b.created_at, c.message AS commit_message
    FROM branches b
    LEFT JOIN commits c ON b.commit_sha = c.sha AND b.repo_id = c.repo_id
    WHERE b.repo_id = ${sqlLiteral(repoId)}
    ORDER BY b.is_default DESC, b.name
  `;

  const result = await executeD1Sql(config, sql);
  const rows = extractResults(result);

  if (options.isJson) {
    console.log(JSON.stringify({ repository: repo, branches: rows }, null, 2));
  } else {
    print(`Repository: ${String(repo.name)} (${repoId})`, options.isJson);
    console.table(rows as Record<string, unknown>[]);
    print(`Total: ${rows.length}`, options.isJson);
  }

  return rows.length;
}

// ---------------------------------------------------------------------------
// Secrets commands
// ---------------------------------------------------------------------------

function resolveSecretsDir(environment: DeployEnvironment): string {
  return path.join(SECRETS_DIR_BASE, environment);
}

function readSecretFile(dir: string, name: string): string | null {
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').trim();
}

function isPlaceholder(value: string): boolean {
  return (
    !value ||
    value.includes('REPLACE_WITH_') ||
    value.includes('your-') ||
    value === 'placeholder-secret' ||
    value === 'local-dev-jwt-secret'
  );
}

function wranglerEnvArgs(configFile: string, environment: DeployEnvironment): string[] {
  const args = ['--config', configFile];
  // production uses default env (no --env flag) in wrangler
  if (environment !== 'production') {
    args.push('--env', environment);
  }
  return args;
}

function runWranglerSecret(
  action: 'put' | 'delete',
  secretName: string,
  configFile: string,
  environment: DeployEnvironment,
  value?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      'exec', 'wrangler', 'secret', action, secretName,
      ...wranglerEnvArgs(configFile, environment),
    ];

    const child = spawn('pnpm', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      cwd: path.resolve(__dirname, '..'),
    });

    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    if (action === 'put' && value != null) {
      child.stdin.write(`${value}\n`);
    }
    child.stdin.end();

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) { resolve(); return; }
      reject(new Error(`wrangler secret ${action} ${secretName} failed (exit ${code ?? '?'}): ${stderr.trim()}`));
    });
  });
}

async function listWranglerSecrets(
  configFile: string,
  environment: DeployEnvironment,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const args = [
      'exec', 'wrangler', 'secret', 'list',
      ...wranglerEnvArgs(configFile, environment),
    ];

    const child = spawn('pnpm', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      cwd: path.resolve(__dirname, '..'),
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        // Worker may not exist yet
        if (stderr.includes('not found')) { resolve([]); return; }
        reject(new Error(`wrangler secret list failed: ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { name: string }[];
        resolve(parsed.map((s) => s.name));
      } catch {
        resolve([]);
      }
    });
  });
}

async function cmdSecretsStatus(_config: ResolvedConfig, options: GlobalOptions): Promise<number> {
  const env = options.environment;
  const secretsDir = resolveSecretsDir(env);
  const hasDir = fs.existsSync(secretsDir);

  type WorkerStatus = {
    worker: string;
    config: string;
    deployed: string[];
    required: string[];
    optional: string[];
    missing: string[];
    legacy: string[];
    localFiles: string[];
  };

  const statuses: WorkerStatus[] = [];

  for (const spec of WORKER_SECRETS) {
    if (spec.required.length === 0 && spec.optional.length === 0) continue;

    const deployed = await listWranglerSecrets(spec.config, env);
    const allExpected = new Set([...spec.required, ...spec.optional]);
    const missing = spec.required.filter((s) => !deployed.includes(s));
    const legacy = deployed.filter((s) => LEGACY_SECRETS.has(s));
    const localFiles = hasDir
      ? [...allExpected].filter((s) => fs.existsSync(path.join(secretsDir, s)))
      : [];

    statuses.push({
      worker: spec.alias,
      config: spec.config,
      deployed,
      required: spec.required,
      optional: spec.optional,
      missing,
      legacy,
      localFiles,
    });
  }

  if (options.isJson) {
    console.log(JSON.stringify(statuses, null, 2));
  } else {
    console.log(`\nSecrets status for [${env}]`);
    console.log(`Local secrets dir: ${secretsDir} ${hasDir ? '(exists)' : '(not found)'}\n`);

    for (const s of statuses) {
      const tag = s.missing.length > 0 ? ' ⚠' : ' ✓';
      console.log(`${tag} ${s.worker} (${s.config})`);
      console.log(`    deployed: ${s.deployed.length}  required: ${s.required.length}  optional: ${s.optional.length}`);
      if (s.missing.length > 0) {
        console.log(`    MISSING:  ${s.missing.join(', ')}`);
      }
      if (s.legacy.length > 0) {
        console.log(`    LEGACY:   ${s.legacy.join(', ')}`);
      }
      if (s.localFiles.length > 0) {
        console.log(`    local:    ${s.localFiles.join(', ')}`);
      }
    }
  }

  return statuses.length;
}

async function cmdSecretsSync(_config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const env = options.environment;
  const dryRun = takeFlag(args, '--dry-run');
  const workerFilter = takeOption(args, '--worker');
  const secretsDir = resolveSecretsDir(env);

  if (!fs.existsSync(secretsDir)) {
    fail(`Secrets directory not found: ${secretsDir}\nCreate it with: mkdir -p ${secretsDir}`);
  }

  const specs = workerFilter
    ? WORKER_SECRETS.filter((s) => s.alias === workerFilter)
    : WORKER_SECRETS;

  if (workerFilter && specs.length === 0) {
    fail(`Unknown worker alias: ${workerFilter}. Available: ${WORKER_SECRETS.map((s) => s.alias).join(', ')}`);
  }

  let totalPut = 0;

  for (const spec of specs) {
    const allSecrets = [...spec.required, ...spec.optional];
    if (allSecrets.length === 0) continue;

    const deployed = await listWranglerSecrets(spec.config, env);

    for (const secretName of allSecrets) {
      const value = readSecretFile(secretsDir, secretName);
      if (!value) continue;
      if (isPlaceholder(value)) {
        console.log(`  SKIP ${spec.alias}/${secretName} (placeholder value)`);
        continue;
      }

      const exists = deployed.includes(secretName);
      const action = exists ? 'UPDATE' : 'CREATE';

      if (dryRun) {
        console.log(`  [dry-run] ${action} ${spec.alias}/${secretName}`);
      } else {
        process.stdout.write(`  ${action} ${spec.alias}/${secretName} ... `);
        await runWranglerSecret('put', secretName, spec.config, env, value);
        console.log('ok');
      }
      totalPut++;
    }
  }

  console.log(`\n${dryRun ? '[dry-run] Would sync' : 'Synced'} ${totalPut} secret(s)`);
  return totalPut;
}

async function cmdSecretsPut(_config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const env = options.environment;
  const secretName = args.shift();
  if (!secretName) fail('Usage: secrets put <SECRET_NAME> [--value-file <path>] [--worker <alias>]');

  const valueFile = takeOption(args, '--value-file');
  const workerFilter = takeOption(args, '--worker');

  let value: string;
  if (valueFile) {
    value = fs.readFileSync(valueFile, 'utf8').replace(/\r\n/g, '\n').trim();
  } else if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    value = Buffer.concat(chunks).toString('utf8').trim();
  } else {
    // Try .secrets/<env>/<name>
    const secretsDir = resolveSecretsDir(env);
    const fileValue = readSecretFile(secretsDir, secretName);
    if (fileValue && !isPlaceholder(fileValue)) {
      value = fileValue;
    } else {
      fail(`No value provided. Use --value-file, pipe stdin, or place in ${secretsDir}/${secretName}`);
    }
  }

  if (isPlaceholder(value)) fail('Refusing to upload placeholder value');

  const specs = workerFilter
    ? WORKER_SECRETS.filter((s) => s.alias === workerFilter)
    : WORKER_SECRETS.filter((s) => [...s.required, ...s.optional].includes(secretName));

  if (specs.length === 0) {
    fail(`No workers expect secret "${secretName}". Use --worker <alias> to force.`);
  }

  let count = 0;
  for (const spec of specs) {
    process.stdout.write(`  PUT ${spec.alias}/${secretName} ... `);
    await runWranglerSecret('put', secretName, spec.config, env, value);
    console.log('ok');
    count++;
  }

  return count;
}

async function cmdSecretsPrune(_config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const env = options.environment;
  const dryRun = takeFlag(args, '--dry-run');
  const workerFilter = takeOption(args, '--worker');

  const specs = workerFilter
    ? WORKER_SECRETS.filter((s) => s.alias === workerFilter)
    : WORKER_SECRETS;

  let totalDeleted = 0;

  for (const spec of specs) {
    const deployed = await listWranglerSecrets(spec.config, env);
    const legacySecrets = deployed.filter((s) => LEGACY_SECRETS.has(s));

    for (const secretName of legacySecrets) {
      if (dryRun) {
        console.log(`  [dry-run] DELETE ${spec.alias}/${secretName}`);
      } else {
        process.stdout.write(`  DELETE ${spec.alias}/${secretName} ... `);
        await runWranglerSecret('delete', secretName, spec.config, env);
        console.log('ok');
      }
      totalDeleted++;
    }
  }

  if (totalDeleted === 0) {
    console.log('No legacy secrets found.');
  } else {
    console.log(`\n${dryRun ? '[dry-run] Would prune' : 'Pruned'} ${totalDeleted} legacy secret(s)`);
  }

  return totalDeleted;
}

async function cmdSecretsGenerateJwt(_config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const env = options.environment;
  const prefix = takeOption(args, '--prefix') || 'service';
  const outputDir = takeOption(args, '--output-dir') || resolveSecretsDir(env);
  const upload = takeFlag(args, '--upload');

  const validPrefixes = ['platform'];
  if (!validPrefixes.includes(prefix)) {
    fail(`Invalid prefix: ${prefix}. Use: ${validPrefixes.join(', ')} (service JWT keys are no longer used)`);
  }

  const { generateKeyPairSync } = await import('crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const privateKeyName = 'PLATFORM_PRIVATE_KEY';
  const publicKeyName = 'PLATFORM_PUBLIC_KEY';

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, privateKeyName), String(privateKey), 'utf8');
  fs.writeFileSync(path.join(outputDir, publicKeyName), String(publicKey), 'utf8');
  console.log(`Generated ${prefix} JWT key pair:`);
  console.log(`  ${outputDir}/${privateKeyName}`);
  console.log(`  ${outputDir}/${publicKeyName}`);

  if (upload) {
    const specs = WORKER_SECRETS.filter(
      (s) => [...s.required, ...s.optional].includes(privateKeyName)
    );
    for (const spec of specs) {
      process.stdout.write(`  PUT ${spec.alias}/${privateKeyName} ... `);
      await runWranglerSecret('put', privateKeyName, spec.config, env, String(privateKey));
      console.log('ok');

      if ([...spec.required, ...spec.optional].includes(publicKeyName)) {
        process.stdout.write(`  PUT ${spec.alias}/${publicKeyName} ... `);
        await runWranglerSecret('put', publicKeyName, spec.config, env, String(publicKey));
        console.log('ok');
      }
    }
  }

  return 1;
}

function showHelp(): void {
  console.log(`
Unified Admin CLI (Cloudflare API based)

Usage:
  npx tsx scripts/admin-cli.ts <group> <command> [args] [options]

Global options:
  --env <production|staging>   Target environment (default: production)
  --json                       JSON output
  --approval-id <id>           Required for tenant/workspace data access
  --scope-workspace-id <id>    Required scope for tenant/workspace D1 access
  --scope-user-id <id>         Required scope for tenant/workspace D1 access
  --scope-r2-prefix <prefix>   Required scope prefix for tenant/workspace R2 access
  --account-id <id>            Override Cloudflare account ID
  --api-token <token>          Override Cloudflare API token
  --database-id <id>           Override D1 database_id
  --remote                     Alias of --env production
  --staging                    Alias of --env staging

Commands:
  config show
  d1 ping
  d1 tables
  d1 query "<sql>"

  r2 list <bucket> [--prefix <prefix>] [--cursor <cursor>] [--limit <n>]
  r2 get <bucket> <key> [--output <path>]
  r2 put <bucket> <key> <file> [--content-type <type>]
  r2 delete <bucket> <key>
  r2 upload-dir <bucket> <dir> [prefix] [--content-type <type>]

  users list [--limit <n>]
  repos list [--limit <n>]
  repos branches <repo_id_or_name>

  moderation show-user <user_id>
  moderation ban <user_id> [--reason <text>] [--actor-user-id <id>]
  moderation unban <user_id> [--reason <text>] [--actor-user-id <id>]

  secrets status
  secrets sync [--dry-run] [--worker <alias>]
  secrets put <SECRET_NAME> [--value-file <path>] [--worker <alias>]
  secrets prune [--dry-run] [--worker <alias>]
  secrets generate-jwt [--prefix platform|service] [--upload] [--output-dir <path>]

R2 bucket aliases:
  bundles, builds, source, git, offload

Worker aliases (for secrets):
  web, runner, indexer, workflow-runner, runtime-host, executor, dispatch, egress

Secrets directory structure:
  .secrets/<env>/<SECRET_NAME>   (one file per secret, .gitignored)
`);
}

async function cmdConfigShow(config: ResolvedConfig, options: GlobalOptions): Promise<number> {
  const payload = {
    environment: config.environment,
    account_id: config.accountId,
    d1_database_id: config.d1DatabaseId || null,
    wrangler_toml: WRANGLER_TOML_PATH,
    r2_aliases: config.r2Buckets,
  };

  if (options.isJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('Resolved configuration:');
    console.log(`  environment: ${payload.environment}`);
    console.log(`  account_id: ${payload.account_id}`);
    console.log(`  d1_database_id: ${payload.d1_database_id || '(unset)'}`);
    console.log(`  wrangler_toml: ${payload.wrangler_toml}`);
    console.log('  r2_aliases:');
    for (const [alias, bucket] of Object.entries(payload.r2_aliases).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`    ${alias} -> ${bucket}`);
    }
  }

  return 1;
}

function summarizeCommand(args: string[]): string {
  const sanitized = [...args];
  const tokenIndex = sanitized.indexOf('--api-token');
  if (tokenIndex >= 0 && sanitized[tokenIndex + 1]) {
    sanitized[tokenIndex + 1] = '[REDACTED]';
  }
  return sanitized.join(' ');
}

async function dispatchCommand(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  if (args.length === 0) {
    showHelp();
    return 0;
  }

  const [group, command, ...rest] = args;

  if (group === 'help' || group === '--help') {
    showHelp();
    return 0;
  }

  if (group === 'config') {
    if (command === 'show') {
      return cmdConfigShow(config, options);
    }
    fail('Unknown config command. Use: config show');
  }

  if (group === 'd1') {
    if (command === 'ping') {
      return cmdD1Ping(config, options);
    }
    if (command === 'tables') {
      return cmdD1Tables(config, options);
    }
    if (command === 'query') {
      return cmdD1Query(config, options, rest);
    }
    fail('Unknown d1 command. Use: d1 ping | d1 tables | d1 query');
  }

  if (group === 'r2') {
    if (command === 'list') {
      return cmdR2List(config, options, rest);
    }
    if (command === 'get') {
      return cmdR2Get(config, options, rest);
    }
    if (command === 'put') {
      return cmdR2Put(config, options, rest);
    }
    if (command === 'delete') {
      return cmdR2Delete(config, options, rest);
    }
    if (command === 'upload-dir') {
      return cmdR2UploadDir(config, options, rest);
    }
    fail('Unknown r2 command. Use: r2 list|get|put|delete|upload-dir');
  }

  if (group === 'users') {
    if (command === 'list') {
      return cmdUsersList(config, options, rest);
    }
    fail('Unknown users command. Use: users list');
  }

  if (group === 'repos') {
    if (command === 'list') {
      return cmdReposList(config, options, rest);
    }
    if (command === 'branches') {
      return cmdReposBranches(config, options, rest);
    }
    fail('Unknown repos command. Use: repos list|branches');
  }

  if (group === 'moderation') {
    if (command === 'show-user') {
      return cmdModerationShowUser(config, options, rest);
    }
    if (command === 'ban') {
      return cmdModerationBan(config, options, rest);
    }
    if (command === 'unban') {
      return cmdModerationUnban(config, options, rest);
    }
    fail('Unknown moderation command. Use: moderation show-user|ban|unban');
  }

  if (group === 'secrets') {
    if (command === 'status') {
      return cmdSecretsStatus(config, options);
    }
    if (command === 'sync') {
      return cmdSecretsSync(config, options, rest);
    }
    if (command === 'put') {
      return cmdSecretsPut(config, options, rest);
    }
    if (command === 'prune') {
      return cmdSecretsPrune(config, options, rest);
    }
    if (command === 'generate-jwt') {
      return cmdSecretsGenerateJwt(config, options, rest);
    }
    fail('Unknown secrets command. Use: secrets status|sync|put|prune|generate-jwt');
  }

  fail(`Unknown command group: ${group}`);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { remainingArgs, options } = parseGlobalOptions(rawArgs);

  if (
    remainingArgs.length === 0 ||
    remainingArgs[0] === 'help' ||
    remainingArgs.includes('--help') ||
    remainingArgs.includes('-h')
  ) {
    showHelp();
    return;
  }

  // secrets commands use wrangler CLI directly and don't need CF API config
  if (remainingArgs[0] === 'secrets') {
    const [, command, ...rest] = remainingArgs;
    const dummyConfig = { environment: options.environment, accountId: '', apiToken: '', r2Buckets: {} } as ResolvedConfig;
    if (command === 'status') { await cmdSecretsStatus(dummyConfig, options); return; }
    if (command === 'sync') { await cmdSecretsSync(dummyConfig, options, rest); return; }
    if (command === 'put') { await cmdSecretsPut(dummyConfig, options, rest); return; }
    if (command === 'prune') { await cmdSecretsPrune(dummyConfig, options, rest); return; }
    if (command === 'generate-jwt') { await cmdSecretsGenerateJwt(dummyConfig, options, rest); return; }
    fail('Unknown secrets command. Use: secrets status|sync|put|prune|generate-jwt');
  }

  const config = resolveConfig(options);
  const start = nowIso();
  const commandSummary = summarizeCommand([...remainingArgs]);
  let success = false;
  let count: number | null = null;
  let errorMessage: string | undefined;

  try {
    count = await dispatchCommand(config, options, remainingArgs);
    success = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorMessage = sanitizeErrorMessage(message);
    throw error;
  } finally {
    appendAuditLog({
      command: commandSummary,
      env: config.environment,
      start,
      end: nowIso(),
      success,
      count,
      error: errorMessage,
    });

    print(`Audit log: ${AUDIT_LOG_FILE}`, options.isJson);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${sanitizeErrorMessage(message)}`);
  process.exit(1);
});
