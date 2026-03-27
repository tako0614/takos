import type { Env } from '../../../shared/types';
import { logOAuthEvent } from '../../../application/services/oauth/audit';
import { logWarn } from '../../../shared/utils/logger';

/** Minimal context shape accepted by tryLogOAuthEvent — works with any Hono env that includes Env bindings. */
type MinimalOAuthContext = {
  env: Env;
  req: { header: (name: string) => string | undefined };
};

export { escapeHtml } from '../auth/html';

export function isValidLogoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    // Malformed URL -- treat as invalid
    return false;
  }
}

/**
 * Extract a single string value from a parsed form body field.
 * Handles both single values and arrays (takes the first element).
 */
export type FormValue = string | File;
export type FormBody = Record<string, FormValue | FormValue[]>;

export function getBodyValue(
  value: FormValue | FormValue[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    const [first] = value;
    return typeof first === 'string' ? first : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/** DB user record shape returned by findUnique */
export interface DbUserRecord {
  id: string;
  email: string | null;
  name: string;
  slug: string;
  bio: string | null;
  picture: string | null;
  setupCompleted: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** Map a DB user record to the legacy snake_case shape used in OAuth routes */
export function mapDbUser(u: DbUserRecord) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    username: u.slug,
    bio: u.bio,
    picture: u.picture,
    setup_completed: u.setupCompleted,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
  };
}

function getRequestIp(c: MinimalOAuthContext) {
  const forwarded = c.req.header('x-forwarded-for') || c.req.header('X-Forwarded-For');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || null;
  }
  return c.req.header('cf-connecting-ip') || c.req.header('CF-Connecting-IP') || null;
}

function getUserAgent(c: MinimalOAuthContext) {
  return c.req.header('user-agent') || c.req.header('User-Agent') || null;
}

export async function tryLogOAuthEvent(
  c: MinimalOAuthContext,
  input: Parameters<typeof logOAuthEvent>[1]
) {
  try {
    await logOAuthEvent(c.env.DB, {
      ...input,
      ipAddress: input.ipAddress ?? getRequestIp(c),
      userAgent: input.userAgent ?? getUserAgent(c),
    });
  } catch (err) {
    logWarn('OAuth audit log failed', { module: 'routes/oauth/request-utils', error: err instanceof Error ? err.message : String(err) });
  }
}
