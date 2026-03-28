/**
 * Barrel re-exports for admin-cli shared modules.
 *
 * All types, constants, utilities, TOML helpers, config resolution,
 * validation, and execution helpers are re-exported from their
 * respective focused modules.
 */

// types.ts
export type { DeployEnvironment, GlobalOptions, ResolvedConfig, D1Statement, AuditEntry } from './admin-types.ts';

// constants.ts
export {
  SCRIPTS_DIR,
  CONTROL_APP_DIR,
  WRANGLER_TOML_PATH,
  AUDIT_LOG_DIR,
  AUDIT_LOG_FILE,
  VALID_USER_ID_PATTERN,
  APPROVAL_ID_PATTERN,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  DEFAULT_R2_PAGE_SIZE,
  MAX_R2_PAGE_SIZE,
  TENANT_SQL_TABLE_TOKENS,
  TENANT_R2_PREFIXES,
} from './constants.ts';

// cli-utils.ts
export { print, fail, takeFlag, takeOption, parsePositiveInt } from './cli-utils.ts';

// sql-utils.ts
export { sqlLiteral, sqlNullable, escapeRegExp } from './sql-utils.ts';

// common-utils.ts
export { nowIso, randomId, appendAuditLog } from './common-utils.ts';

// toml.ts
export {
  parseTomlPrimitive,
  parseTomlKeyValueBlock,
  readTomlSection,
  readTomlArraySections,
  readWranglerToml,
} from './toml.ts';

// config-resolution.ts
export {
  inferDefaultR2Buckets,
  inferR2BucketAliases,
  inferD1DatabaseId,
  inferAccountId,
  resolveEnvironment,
  parseGlobalOptions,
  resolveConfig,
} from './config-resolution.ts';

// validation.ts
export {
  normalizeSqlForAnalysis,
  hasValidWhereClause,
  validateQuerySafety,
  detectTenantSqlTokens,
  requireApprovalId,
  enforceTenantSqlAccessPolicy,
  normalizePrefix,
  isLikelyTenantR2Path,
  enforceTenantR2AccessPolicy,
} from './validation.ts';

// execution.ts
export {
  requireD1DatabaseId,
  createClient,
  executeD1Sql,
  extractResults,
  extractChangeCount,
  resolveBucketName,
  ensureValidUserId,
} from './execution.ts';
