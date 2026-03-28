/**
 * Auth Utilities for takos-control
 *
 * Provides session management and security utilities.
 * Works with Google OAuth as the sole auth provider.
 */

import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, authSessions, oauthStates } from '../../../infra/db';
import { eq, and, gt, lt, desc, notInArray, sql } from 'drizzle-orm';
import { logInfo } from '../../../shared/utils/logger';
import { bytesToHex } from '../../../shared/utils/encoding-utils';

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/** ISO-8601 string offset from now by `offsetMs` milliseconds. */
function offsetISO(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** Allowed table/column pairs for expired-row cleanup. */
const CLEANUP_ALLOWLIST: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['oauth_states', new Set(['expires_at'])],
]);

/** Delete rows older than `now()` from a table's datetime column. */
async function cleanupExpiredRows(
  db: D1Database,
  table: string,
  column: string,
): Promise<void> {
  const allowedColumns = CLEANUP_ALLOWLIST.get(table);
  if (!allowedColumns || !allowedColumns.has(column)) {
    throw new Error(`cleanupExpiredRows: disallowed table/column "${table}"/"${column}"`);
  }
  // Dynamic table/column name -- must stay as raw SQL
  await db.prepare(`DELETE FROM ${table} WHERE ${column} < ?`).bind(new Date().toISOString()).run();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REDIRECT_DOMAINS = ['localhost', '127.0.0.1'] as const;
const OAUTH_STATE_HEX_PATTERN = /^[a-f0-9]{64}$/;
const REDIRECT_DOMAIN_SPLIT_PATTERN = /[\s,]+/;
export const PASSWORD_PBKDF2_ITERATIONS = 100000;

function normalizeRedirectDomain(domain: string): string | null {
  const normalized = domain.trim().toLowerCase().replace(/^\.+/, '');
  if (!normalized) {
    return null;
  }

  if (
    normalized.includes('://') ||
    normalized.includes('/') ||
    normalized.includes(':') ||
    normalized.includes('?') ||
    normalized.includes('#')
  ) {
    return null;
  }

  return normalized;
}

function parseConfiguredRedirectDomains(configuredDomains?: string | null): string[] {
  if (!configuredDomains) {
    return [];
  }

  const parsed = configuredDomains
    .split(REDIRECT_DOMAIN_SPLIT_PATTERN)
    .map((domain) => normalizeRedirectDomain(domain))
    .filter((domain): domain is string => !!domain);

  return Array.from(new Set(parsed));
}

function resolveAllowedRedirectDomains(
  configuredDomains?: string | null,
  fallbackDomains: readonly string[] = DEFAULT_REDIRECT_DOMAINS
): string[] {
  const parsedFallbackDomains = fallbackDomains
    .map((domain) => normalizeRedirectDomain(domain))
    .filter((domain): domain is string => !!domain);

  const configured = parseConfiguredRedirectDomains(configuredDomains);

  return Array.from(new Set([...parsedFallbackDomains, ...configured]));
}

/**
 * Generate a random UUID (internal to auth-utils)
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Timing-safe string comparison to prevent timing attacks (internal to auth-utils)
 */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    result |= charA ^ charB;
  }
  return result === 0;
}

/**
 * Validate redirect URI against allowed domains
 */
export function isValidRedirectUri(
  uri: string,
  configuredAllowedDomains?: string | null,
  fallbackDomains: readonly string[] = DEFAULT_REDIRECT_DOMAINS
): boolean {
  try {
    const url = new URL(uri);
    const hostname = url.hostname.toLowerCase();
    const allowedDomains = resolveAllowedRedirectDomains(configuredAllowedDomains, fallbackDomains);

    if (allowedDomains.length === 0) {
      return false;
    }

    for (const domain of allowedDomains) {
      const isLocalhost = domain === 'localhost' || domain === '127.0.0.1';
      if (isLocalhost) {
        if (hostname !== domain) {
          continue;
        }
        return url.protocol === 'http:' || url.protocol === 'https:';
      }

      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return url.protocol === 'https:';
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Generate secure OAuth state (64 hex characters)
 */
export function generateOAuthState(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Validate OAuth state format before DB access.
 */
export function isValidOAuthState(state: string): boolean {
  return OAUTH_STATE_HEX_PATTERN.test(state);
}

/**
 * Validate avatar URL (must be HTTPS)
 */
export function isValidAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Hash a password using PBKDF2 with SHA-256
 * Returns salt:hash format
 *
 * Used by thread-shares for share password protection.
 */
export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PASSWORD_PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

/**
 * Verify a password against stored hash
 *
 * Used by thread-shares for share password verification.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const hexPairs = saltHex.match(/.{2}/g);
  if (!hexPairs) return false;
  const salt = new Uint8Array(hexPairs.map((byte) => parseInt(byte, 16)));
  const data = new TextEncoder().encode(password);
  const keyMaterial = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PASSWORD_PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );

  return timingSafeEqual(bytesToHex(new Uint8Array(bits)), hashHex);
}

/**
 * Hash a token using SHA-256
 */
export async function hashToken(token: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Generate a session token (64 hex characters)
 */
export function generateSessionToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Create a D1-based auth session (for service API token validation)
 */
export async function createAuthSession(
  d1: D1Database,
  userId: string,
  userAgent?: string,
  ipAddress?: string
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const tokenHash = await hashToken(token);
  const sessionId = generateId();
  const expiresAt = offsetISO(30 * 24 * 60 * 60 * 1000); // 30 days

  const db = getDb(d1);
  await db.insert(authSessions).values({
    id: sessionId,
    accountId: userId,
    tokenHash,
    userAgent: userAgent || null,
    ipAddress: ipAddress || null,
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  return { token, expiresAt };
}

/**
 * Validate a D1-based auth session
 */
export async function validateAuthSession(
  d1: D1Database,
  token: string
): Promise<{ valid: boolean; userId?: string; expiresAt?: string }> {
  const tokenHash = await hashToken(token);
  const db = getDb(d1);

  const session = await db.select({
    accountId: authSessions.accountId,
    expiresAt: authSessions.expiresAt,
  })
    .from(authSessions)
    .where(and(
      eq(authSessions.tokenHash, tokenHash),
      gt(authSessions.expiresAt, new Date().toISOString()),
    ))
    .get();

  if (!session) {
    return { valid: false };
  }

  return {
    valid: true,
    userId: session.accountId,
    expiresAt: session.expiresAt,
  };
}

/**
 * Delete a D1-based auth session
 */
export async function deleteAuthSession(d1: D1Database, token: string): Promise<void> {
  const tokenHash = await hashToken(token);
  const db = getDb(d1);
  await db.delete(authSessions)
    .where(eq(authSessions.tokenHash, tokenHash));
}

/**
 * Clean up old sessions for a user (keep last N sessions)
 */
export async function cleanupUserSessions(
  d1: D1Database,
  userId: string,
  keepCount: number = 5
): Promise<void> {
  const db = getDb(d1);
  const sessions = await db.select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.accountId, userId))
    .orderBy(desc(authSessions.createdAt))
    .limit(keepCount)
    .all();

  const keepIds = sessions.map(s => s.id);
  if (keepIds.length > 0) {
    await db.delete(authSessions)
      .where(and(
        eq(authSessions.accountId, userId),
        notInArray(authSessions.id, keepIds),
      ));
  }
}

/**
 * Store OAuth state in D1 for CSRF protection
 */
export async function storeOAuthState(
  d1: D1Database,
  redirectUri: string,
  returnTo?: string,
  cliCallback?: string
): Promise<string> {
  const state = generateOAuthState();
  const stateId = generateId();
  const expiresAt = offsetISO(10 * 60 * 1000); // 10 minutes

  const db = getDb(d1);
  await db.insert(oauthStates).values({
    id: stateId,
    state,
    redirectUri,
    returnTo: returnTo || null,
    cliCallback: cliCallback || null,
    expiresAt,
  });

  await cleanupExpiredRows(d1, 'oauth_states', 'expires_at');

  return state;
}

type ConsumedOAuthState = {
  redirectUri: string;
  returnTo: string | null;
  cliCallback: string | null;
  expiresAt: string;
};

async function consumeOAuthState(
  d1: D1Database,
  state: string
): Promise<ConsumedOAuthState | null> {
  const row = await d1.prepare(`
    DELETE FROM oauth_states
    WHERE state = ?
    RETURNING redirect_uri, return_to, cli_callback, expires_at
  `).bind(state).first<{
    redirect_uri: string;
    return_to: string | null;
    cli_callback: string | null;
    expires_at: string;
  }>();

  if (!row) {
    return null;
  }

  return {
    redirectUri: row.redirect_uri,
    returnTo: row.return_to,
    cliCallback: row.cli_callback,
    expiresAt: row.expires_at,
  };
}

/**
 * Validate and consume OAuth state from D1
 */
export async function validateOAuthState(
  db: D1Database,
  state: string
): Promise<{ valid: boolean; redirectUri?: string; returnTo?: string; cliCallback?: string }> {
  if (!isValidOAuthState(state)) {
    return { valid: false };
  }

  const consumedState = await consumeOAuthState(db, state);

  if (!consumedState) {
    return { valid: false };
  }

  const expiresAt = Date.parse(consumedState.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { valid: false };
  }

  return {
    valid: true,
    redirectUri: consumedState.redirectUri,
    returnTo: consumedState.returnTo || undefined,
    cliCallback: consumedState.cliCallback || undefined,
  };
}

/**
 * Audit log helper (logs to console, can be extended to store in DB)
 */
export async function auditLog(
  event: string,
  details: Record<string, unknown>
): Promise<void> {
  logInfo(`${event}`, { module: 'audit', detail: JSON.stringify(details) });
}
