/**
 * Application Constants
 *
 * Centralized constants for consistent configuration across the application.
 */

import { type TtlMs, ttlMs } from "@takos/worker-platform-utils/ttl";

/**
 * Workers adapter compatibility date
 *
 * This date determines which Workers runtime features are available for the
 * Cloudflare adapter. Provider-neutral runtimes should ignore it.
 *
 * @see https://developers.cloudflare.com/workers/configuration/compatibility-dates/
 */
export const CF_COMPATIBILITY_DATE = "2024-12-01";

// ============================================================================
// Production Domains
// ============================================================================

/**
 * Production domain for the Takos product.
 *
 * Used by external API clients as the default API endpoint.
 * Local-development domain defaults live in local-platform/runtime-types.ts.
 */
export const PRODUCTION_DOMAIN = "takos.jp";

// ============================================================================
// Standard Error Messages
// ============================================================================

/**
 * Centralized error messages used across route handlers.
 * Using constants avoids typo drift and makes bulk updates trivial.
 */
export const ERR = {
  // ── Not Found ──────────────────────────────────────────────────────────
  USER_NOT_FOUND: "User not found",
  REPOSITORY_NOT_FOUND: "Repository not found",
  WORKSPACE_NOT_FOUND: "Workspace not found",
  SESSION_NOT_FOUND: "Session not found",
  RESOURCE_NOT_FOUND: "Resource not found",
  RELEASE_NOT_FOUND: "Release not found",
  TOKEN_NOT_FOUND: "Token not found",
  COMMIT_NOT_FOUND: "Commit not found",
  INVOICE_NOT_FOUND: "Invoice not found",

  // ── Auth / Permission ──────────────────────────────────────────────────
  PERMISSION_DENIED: "Permission denied",
} as const;

// ============================================================================
// Session Heartbeat
// ============================================================================

export const HEARTBEAT_TIMEOUT_MS: TtlMs = ttlMs(2 * 60 * 1000);
export const STARTUP_GRACE_MS: TtlMs = ttlMs(30 * 1000);
