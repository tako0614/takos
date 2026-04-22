/**
 * Barrel re-exports for admin-cli shared modules.
 *
 * All types, constants, utilities, TOML helpers, config resolution,
 * validation, and execution helpers are re-exported from their
 * respective focused modules.
 */

// types.ts
export type {
  AuditEntry,
  D1Statement,
  DeployEnvironment,
  GlobalOptions,
  ResolvedConfig,
} from "./admin-types.ts";

// constants.ts
export {
  APPROVAL_ID_PATTERN,
  AUDIT_LOG_DIR,
  AUDIT_LOG_FILE,
  CONTROL_APP_DIR,
  DEFAULT_QUERY_LIMIT,
  DEFAULT_R2_PAGE_SIZE,
  MAX_QUERY_LIMIT,
  MAX_R2_PAGE_SIZE,
  SCRIPTS_DIR,
  TENANT_R2_PREFIXES,
  TENANT_SQL_TABLE_TOKENS,
  VALID_USER_ID_PATTERN,
  WRANGLER_TOML_PATH,
} from "./constants.ts";

// cli-utils.ts
export {
  fail,
  parsePositiveInt,
  print,
  takeFlag,
  takeOption,
} from "./cli-utils.ts";

// sql-utils.ts
export { escapeRegExp, sqlLiteral, sqlNullable } from "./sql-utils.ts";

// common-utils.ts
export { appendAuditLog, nowIso, randomId } from "./common-utils.ts";

// toml.ts
export {
  parseTomlKeyValueBlock,
  parseTomlPrimitive,
  readTomlArraySections,
  readTomlSection,
  readWranglerToml,
} from "./toml.ts";

// config-resolution.ts
export {
  inferAccountId,
  inferD1DatabaseId,
  inferDefaultR2Buckets,
  inferR2BucketAliases,
  parseGlobalOptions,
  resolveConfig,
  resolveEnvironment,
} from "./config-resolution.ts";

// validation.ts
export {
  detectTenantSqlTokens,
  enforceTenantR2AccessPolicy,
  enforceTenantSqlAccessPolicy,
  hasValidWhereClause,
  isLikelyTenantR2Path,
  normalizePrefix,
  normalizeSqlForAnalysis,
  requireApprovalId,
  validateQuerySafety,
} from "./validation.ts";

// execution.ts
export {
  createClient,
  ensureValidUserId,
  executeD1Sql,
  extractChangeCount,
  extractResults,
  requireD1DatabaseId,
  resolveBucketName,
} from "./execution.ts";
