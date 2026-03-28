/**
 * SQL safety, tenant access policy, and R2 prefix validation.
 */

import type { GlobalOptions } from './admin-types.ts';
import { APPROVAL_ID_PATTERN, TENANT_R2_PREFIXES, TENANT_SQL_TABLE_TOKENS } from './constants.ts';
import { fail } from './cli-helpers.ts';
import { escapeRegExp } from './sql-helpers.ts';

// ---------------------------------------------------------------------------
// SQL safety and tenant access policy
// ---------------------------------------------------------------------------

export function normalizeSqlForAnalysis(sql: string): string {
  let normalized = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  normalized = normalized.replace(/--[^\n\r]*/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ');
  return normalized.trim().toLowerCase();
}

export function hasValidWhereClause(normalizedSql: string, operation: 'delete' | 'update'): boolean {
  if (operation === 'delete') {
    return /delete\s+from\s+\S+\s+where\s+/.test(normalizedSql);
  }
  return /update\s+\S+\s+set\s+[\s\S]+\s+where\s+/.test(normalizedSql);
}

export function validateQuerySafety(sql: string): void {
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

export function detectTenantSqlTokens(sql: string): string[] {
  const normalized = normalizeSqlForAnalysis(sql);
  return TENANT_SQL_TABLE_TOKENS.filter((token) => {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
    return pattern.test(normalized);
  });
}

export function requireApprovalId(options: GlobalOptions, contextLabel: string): string {
  const approvalId = String(options.approvalId || '').trim();
  if (!approvalId) {
    fail(`${contextLabel} requires --approval-id.`);
  }
  if (!APPROVAL_ID_PATTERN.test(approvalId)) {
    fail(`Invalid --approval-id format: ${approvalId}`);
  }
  return approvalId;
}

export function enforceTenantSqlAccessPolicy(sql: string, options: GlobalOptions): void {
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

// ---------------------------------------------------------------------------
// R2 prefix helpers
// ---------------------------------------------------------------------------

export function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) {
    return '';
  }
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function isLikelyTenantR2Path(pathOrPrefix: string): boolean {
  const normalized = normalizePrefix(pathOrPrefix).toLowerCase();
  if (!normalized) {
    // Full bucket scan can include tenant data; require explicit scoped prefix.
    return true;
  }
  return TENANT_R2_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function enforceTenantR2AccessPolicy(options: GlobalOptions, operation: string, pathOrPrefix: string): void {
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
