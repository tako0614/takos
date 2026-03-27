/**
 * Shared type definitions for admin-cli command modules.
 */

export type DeployEnvironment = 'production' | 'staging';

export type GlobalOptions = {
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

export type ResolvedConfig = {
  environment: DeployEnvironment;
  accountId: string;
  apiToken: string;
  d1DatabaseId?: string;
  r2Buckets: Record<string, string>;
};

export type D1Statement = {
  results?: unknown[];
  meta?: {
    changes?: number;
  };
  success?: boolean;
  error?: string;
};

export type AuditEntry = {
  command: string;
  env: DeployEnvironment;
  start: string;
  end: string;
  success: boolean;
  count: number | null;
  error?: string;
};
