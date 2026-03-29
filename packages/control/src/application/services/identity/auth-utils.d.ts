/**
 * Auth Utilities for takos-control
 *
 * Provides session management and security utilities.
 * Works with Google OAuth as the sole auth provider.
 */
import type { D1Database } from '../../../shared/types/bindings.ts';
export declare const PASSWORD_PBKDF2_ITERATIONS = 100000;
/**
 * Validate redirect URI against allowed domains
 */
export declare function isValidRedirectUri(uri: string, configuredAllowedDomains?: string | null, fallbackDomains?: readonly string[]): boolean;
/**
 * Generate secure OAuth state (64 hex characters)
 */
export declare function generateOAuthState(): string;
/**
 * Validate OAuth state format before DB access.
 */
export declare function isValidOAuthState(state: string): boolean;
/**
 * Validate avatar URL (must be HTTPS)
 */
export declare function isValidAvatarUrl(url: string): boolean;
/**
 * Hash a password using PBKDF2 with SHA-256
 * Returns salt:hash format
 *
 * Used by thread-shares for share password protection.
 */
export declare function hashPassword(password: string): Promise<string>;
/**
 * Verify a password against stored hash
 *
 * Used by thread-shares for share password verification.
 */
export declare function verifyPassword(password: string, stored: string): Promise<boolean>;
/**
 * Hash a token using SHA-256
 */
export declare function hashToken(token: string): Promise<string>;
/**
 * Generate a session token (64 hex characters)
 */
export declare function generateSessionToken(): string;
/**
 * Create a D1-based auth session (for service API token validation)
 */
export declare function createAuthSession(d1: D1Database, userId: string, userAgent?: string, ipAddress?: string): Promise<{
    token: string;
    expiresAt: string;
}>;
/**
 * Validate a D1-based auth session
 */
export declare function validateAuthSession(d1: D1Database, token: string): Promise<{
    valid: boolean;
    userId?: string;
    expiresAt?: string;
}>;
/**
 * Delete a D1-based auth session
 */
export declare function deleteAuthSession(d1: D1Database, token: string): Promise<void>;
/**
 * Clean up old sessions for a user (keep last N sessions)
 */
export declare function cleanupUserSessions(d1: D1Database, userId: string, keepCount?: number): Promise<void>;
/**
 * Store OAuth state in D1 for CSRF protection
 */
export declare function storeOAuthState(d1: D1Database, redirectUri: string, returnTo?: string, cliCallback?: string): Promise<string>;
/**
 * Validate and consume OAuth state from D1
 */
export declare function validateOAuthState(db: D1Database, state: string): Promise<{
    valid: boolean;
    redirectUri?: string;
    returnTo?: string;
    cliCallback?: string;
}>;
/**
 * Audit log helper (logs to console, can be extended to store in DB)
 */
export declare function auditLog(event: string, details: Record<string, unknown>): Promise<void>;
//# sourceMappingURL=auth-utils.d.ts.map