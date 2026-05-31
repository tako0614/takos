import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { generateId, slugifyName } from "../../../shared/utils/index.ts";
import { bytesToHex } from "../../../shared/utils/encoding-utils.ts";
import { validateUsername } from "../../../shared/utils/domain-validation.ts";
import { getDb } from "../../../infra/db/index.ts";
import { accounts } from "../../../infra/db/schema.ts";
import { eq } from "drizzle-orm";

const ALLOWED_RETURN_PATHS: readonly string[] = [
  "/",
  "/spaces",
  "/space-settings",
  "/tools",
  "/apps",
  "/profile",
  "/setup",
  "/hub",
  "/store",
  "/explore",
  "/source",
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

export async function generateUniqueUserId(
  db: SqlDatabaseBinding,
): Promise<string> {
  const maxAttempts = 5;
  const drizzleDb = getDb(db);
  for (let i = 0; i < maxAttempts; i++) {
    const id = generateUserId();
    const existing = await drizzleDb.select({ id: accounts.id }).from(accounts)
      .where(eq(accounts.id, id)).get();
    if (!existing) {
      return id;
    }
  }
  const timestamp = Date.now().toString(36);
  return timestamp + generateUserId().slice(timestamp.length);
}

type OidcUserProfile = {
  subject: string;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
};

type ProvisionedAuthUser = {
  id: string;
  email: string | null;
  name: string;
  username: string;
  bio: string | null;
  picture: string | null;
  setup_completed: boolean;
  created_at: string;
  updated_at: string;
};

function authUserFromAccountRow(row: {
  id: string;
  email: string | null;
  name: string;
  slug: string;
  bio: string | null;
  picture: string | null;
  setupCompleted: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}): ProvisionedAuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    username: row.slug,
    bio: row.bio,
    picture: row.picture,
    setup_completed: row.setupCompleted,
    created_at: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : row.createdAt,
    updated_at: row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : row.updatedAt,
  };
}

function normalizeUsernameBase(value: string): string {
  const slug = slugifyName(value).replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  const base = slug || "user";
  if (base.length >= 3) {
    return base.slice(0, 24);
  }
  return `${base}user`.slice(0, 24);
}

async function generateUniqueUsername(
  db: SqlDatabaseBinding,
  profile: {
    email?: string | null;
    name?: string | null;
    subject?: string | null;
  },
): Promise<string> {
  const emailBase = normalizeUsernameBase(profile.email?.split("@")[0] ?? "");
  const nameBase = normalizeUsernameBase(profile.name ?? "");
  const subjectBase = normalizeUsernameBase(profile.subject ?? "");
  const fallbackBase = "user";
  const bases = Array.from(
    new Set([emailBase, nameBase, subjectBase, fallbackBase]),
  );

  for (const base of bases) {
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0
        ? base
        : `${base}-${suffix}`.slice(0, 30).replace(/[-_]+$/g, "");
      if (validateUsername(candidate) !== null) {
        continue;
      }
      const drizzleDb = getDb(db);
      const existing = await drizzleDb.select({ id: accounts.id }).from(
        accounts,
      ).where(
        eq(accounts.slug, candidate),
      ).get();
      if (!existing) {
        return candidate;
      }
    }
  }

  return `user-${generateId(8)}`.slice(0, 30);
}

export async function provisionOidcUser(
  dbBinding: SqlDatabaseBinding,
  profile: OidcUserProfile,
): Promise<ProvisionedAuthUser> {
  const db = getDb(dbBinding);
  if (profile.email) {
    const existingAccount = await db.select({
      id: accounts.id,
      email: accounts.email,
      name: accounts.name,
      slug: accounts.slug,
      status: accounts.status,
      bio: accounts.bio,
      picture: accounts.picture,
      setupCompleted: accounts.setupCompleted,
      createdAt: accounts.createdAt,
      updatedAt: accounts.updatedAt,
    }).from(accounts).where(eq(accounts.email, profile.email)).get();

    if (existingAccount) {
      if (existingAccount.status !== "active") {
        throw new Error("Existing account for OIDC email is not active");
      }
      return authUserFromAccountRow(existingAccount);
    }
  }

  const userId = await generateUniqueUserId(dbBinding);
  const displayName = profile.name?.trim() ||
    `Takosumi Account ${profile.subject.slice(0, 8)}`;
  const username = await generateUniqueUsername(dbBinding, {
    email: profile.email,
    name: displayName,
    subject: profile.subject,
  });
  const timestamp = new Date().toISOString();

  await db.insert(accounts).values({
    id: userId,
    type: "user",
    status: "active",
    email: profile.email ?? null,
    name: displayName,
    slug: username,
    picture: profile.picture ?? null,
    setupCompleted: false,
    // Match the application-level default used by the other account insert
    // site (`identity/space-crud-write.ts`). The DB-level default is a legacy
    // literal that is not present in the model catalog and must not be relied
    // on. See schema-accounts.ts.
    aiModel: "gpt-5.4-nano",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    id: userId,
    email: profile.email ?? null,
    name: displayName,
    username,
    bio: null,
    picture: profile.picture ?? null,
    setup_completed: false,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let normalized: string;
  try {
    normalized = decodeURIComponent(value);
  } catch {
    // Malformed percent-encoding -- redirect to root for safety
    return "/";
  }

  if (normalized.includes("..") || normalized.includes("//")) return "/";

  const pathToMatch = normalized === "/" ? "/" : normalized.replace(/\/+$/, "");

  if (ALLOWED_RETURN_PATHS.includes(pathToMatch)) {
    return pathToMatch;
  }

  for (const pattern of ALLOWED_RETURN_PATTERNS) {
    if (pattern.test(pathToMatch)) {
      return pathToMatch;
    }
  }

  return "/";
}

export function validateCliCallbackUrl(
  callbackUrl: string,
): { valid: boolean; error?: string; sanitizedUrl?: string } {
  try {
    const url = new URL(callbackUrl);

    if (url.protocol !== "http:") {
      return { valid: false, error: "Callback protocol must be http" };
    }

    const allowedHosts = ["127.0.0.1", "localhost"];
    if (!allowedHosts.includes(url.hostname)) {
      return { valid: false, error: "Callback must be localhost or 127.0.0.1" };
    }

    const port = parseInt(url.port || "80");
    if (port < 32768 || port > 65535) {
      return {
        valid: false,
        error:
          "Callback port must be between 32768-65535 (ephemeral port range)",
      };
    }

    if (url.username || url.password) {
      return { valid: false, error: "Callback URL cannot contain credentials" };
    }

    if (url.pathname.includes("..") || url.pathname.includes("//")) {
      return { valid: false, error: "Invalid callback path" };
    }

    const sanitizedUrl = `http://${url.hostname}:${port}${url.pathname}`;
    return { valid: true, sanitizedUrl };
  } catch {
    // URL constructor throws on malformed callback URLs
    return { valid: false, error: "Invalid callback URL format" };
  }
}
