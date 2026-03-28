import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import { generateId, slugifyName } from '../../../shared/utils';
import { bytesToHex } from '../../../shared/utils/encoding-utils';
import { validateUsername } from '../../../shared/utils/reserved-usernames';
import { getDb } from '../../../infra/db';
import { accounts } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';

const ALLOWED_RETURN_PATHS: readonly string[] = [
  '/',
  '/spaces',
  '/space-settings',
  '/tools',
  '/apps',
  '/profile',
  '/setup',
  '/hub',
  '/store',
  '/explore',
  '/source',
] as const;

const ALLOWED_RETURN_PATTERNS: readonly RegExp[] = [
  /^\/spaces\/[a-zA-Z0-9_-]+$/,
  /^\/spaces\/[a-zA-Z0-9_-]+\/threads$/,
  /^\/spaces\/[a-zA-Z0-9_-]+\/threads\/[a-zA-Z0-9_-]+$/,
  /^\/spaces\/[a-zA-Z0-9_-]+\/settings$/,
  /^\/space-settings\/[a-zA-Z0-9_-]+$/,
  /^\/spaces\/[a-zA-Z0-9_-]+\/tools$/,
  /^\/spaces\/[a-zA-Z0-9_-]+\/files$/,
  /^\/tools\/packages\/[a-zA-Z0-9_-]+$/,
  /^\/hub\/[a-z]+$/,
  /^\/store\/[a-zA-Z0-9_-]+$/,
  /^\/source\/[a-zA-Z0-9_-]+$/,
  /^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/,
] as const;

function generateUserId(): string {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return bytesToHex(buffer);
}

export async function generateUniqueUserId(db: SqlDatabaseBinding): Promise<string> {
  const maxAttempts = 5;
  const drizzleDb = getDb(db);
  for (let i = 0; i < maxAttempts; i++) {
    const id = generateUserId();
    const existing = await drizzleDb.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) {
      return id;
    }
  }
  const timestamp = Date.now().toString(36);
  return timestamp + generateUserId().slice(timestamp.length);
}

type GoogleOAuthProfile = {
  id: string;
  email: string;
  name: string;
  picture: string;
  verified_email: boolean;
};

type ProvisionedGoogleOAuthUser = {
  id: string;
  email: string;
  name: string;
  username: string;
  bio: null;
  picture: string;
  setup_completed: boolean;
  created_at: string;
  updated_at: string;
};

function normalizeUsernameBase(value: string): string {
  const slug = slugifyName(value).replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  const base = slug || 'user';
  if (base.length >= 3) {
    return base.slice(0, 24);
  }
  return `${base}user`.slice(0, 24);
}

async function generateUniqueUsername(db: SqlDatabaseBinding, profile: GoogleOAuthProfile): Promise<string> {
  const emailBase = normalizeUsernameBase(profile.email.split('@')[0] || '');
  const nameBase = normalizeUsernameBase(profile.name || '');
  const fallbackBase = 'user';
  const bases = Array.from(new Set([emailBase, nameBase, fallbackBase]));

  for (const base of bases) {
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0
        ? base
        : `${base}-${suffix}`.slice(0, 30).replace(/[-_]+$/g, '');
      if (validateUsername(candidate) !== null) {
        continue;
      }
      const drizzleDb = getDb(db);
      const existing = await drizzleDb.select({ id: accounts.id }).from(accounts).where(
        eq(accounts.slug, candidate)
      ).get();
      if (!existing) {
        return candidate;
      }
    }
  }

  return `user-${generateId(8)}`.slice(0, 30);
}

export async function provisionGoogleOAuthUser(
  dbBinding: SqlDatabaseBinding,
  profile: GoogleOAuthProfile
): Promise<ProvisionedGoogleOAuthUser> {
  const userId = await generateUniqueUserId(dbBinding);
  const username = await generateUniqueUsername(dbBinding, profile);
  const timestamp = new Date().toISOString();

  const db = getDb(dbBinding);
  await db.insert(accounts).values({
    id: userId,
    type: 'user',
    status: 'active',
    email: profile.email,
    name: profile.name,
    slug: username,
    picture: profile.picture || null,
    setupCompleted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    id: userId,
    email: profile.email,
    name: profile.name,
    username,
    bio: null,
    picture: profile.picture,
    setup_completed: false,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';

  let normalized: string;
  try {
    normalized = decodeURIComponent(value);
  } catch {
    // Malformed percent-encoding -- redirect to root for safety
    return '/';
  }

  if (normalized.includes('..') || normalized.includes('//')) return '/';

  const pathToMatch = normalized === '/' ? '/' : normalized.replace(/\/+$/, '');

  if (ALLOWED_RETURN_PATHS.includes(pathToMatch)) {
    return pathToMatch;
  }

  for (const pattern of ALLOWED_RETURN_PATTERNS) {
    if (pattern.test(pathToMatch)) {
      return pathToMatch;
    }
  }

  return '/';
}

export function validateCliCallbackUrl(callbackUrl: string): { valid: boolean; error?: string; sanitizedUrl?: string } {
  try {
    const url = new URL(callbackUrl);

    if (url.protocol !== 'http:') {
      return { valid: false, error: 'Callback protocol must be http' };
    }

    const allowedHosts = ['127.0.0.1', 'localhost'];
    if (!allowedHosts.includes(url.hostname)) {
      return { valid: false, error: 'Callback must be localhost or 127.0.0.1' };
    }

    const port = parseInt(url.port || '80');
    if (port < 32768 || port > 65535) {
      return { valid: false, error: 'Callback port must be between 32768-65535 (ephemeral port range)' };
    }

    if (url.username || url.password) {
      return { valid: false, error: 'Callback URL cannot contain credentials' };
    }

    if (url.pathname.includes('..') || url.pathname.includes('//')) {
      return { valid: false, error: 'Invalid callback path' };
    }

    const sanitizedUrl = `http://${url.hostname}:${port}${url.pathname}`;
    return { valid: true, sanitizedUrl };
  } catch {
    // URL constructor throws on malformed callback URLs
    return { valid: false, error: 'Invalid callback URL format' };
  }
}
