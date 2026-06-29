import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { bytesToHex } from "../../../shared/utils/encoding-utils.ts";
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

// Single-owner model: an account does NOT present a user-chosen public handle.
// `accounts.slug` is kept only as a stable internal owner key (it also anchors
// Space resolution). Use a predictable owner slug; only disambiguate when the
// base is already taken so the `unique(slug)` constraint still holds on legacy
// multi-account data.
const OWNER_ACCOUNT_SLUG = "owner";

async function resolveOwnerAccountSlug(
  db: SqlDatabaseBinding,
): Promise<string> {
  const drizzleDb = getDb(db);
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0
      ? OWNER_ACCOUNT_SLUG
      : `${OWNER_ACCOUNT_SLUG}-${suffix}`;
    const existing = await drizzleDb.select({ id: accounts.id }).from(accounts)
      .where(eq(accounts.slug, candidate)).get();
    if (!existing) {
      return candidate;
    }
  }
  return `${OWNER_ACCOUNT_SLUG}-${generateId(8)}`;
}

export async function provisionOidcUser(
  dbBinding: SqlDatabaseBinding,
  profile: OidcUserProfile,
): Promise<ProvisionedAuthUser> {
  const db = getDb(dbBinding);

  // Account identity is keyed STRICTLY on the (issuer, sub) pair via
  // authIdentities (the caller already matched on it before reaching here, so
  // this function only ever runs for a brand-new subject). Email is a
  // transferable / reusable profile attribute and MUST NOT auto-link a new
  // subject onto an existing account: an IdP that reissues a verified email
  // under a new sub (email change, address re-registration) would otherwise let
  // an attacker log in AS the original account. Each new subject therefore gets
  // its OWN account.
  let email = profile.email ?? null;
  if (email) {
    const emailOwner = await db.select({ id: accounts.id }).from(accounts)
      .where(eq(accounts.email, email)).get();
    if (emailOwner) {
      // The address already belongs to a different account (a different
      // subject). Leave it on its original owner and provision this subject
      // without an email rather than colliding with or hijacking that account.
      email = null;
    }
  }

  const userId = await generateUniqueUserId(dbBinding);
  const displayName = profile.name?.trim() ||
    `Takosumi Account ${profile.subject.slice(0, 8)}`;
  const username = await resolveOwnerAccountSlug(dbBinding);
  const timestamp = new Date().toISOString();

  await db.insert(accounts).values({
    id: userId,
    type: "user",
    status: "active",
    email,
    name: displayName,
    slug: username,
    picture: profile.picture ?? null,
    setupCompleted: false,
    // Match the application-level default used by the other account insert
    // site (`identity/space-crud-write.ts`). The DB-level default is a legacy
    // literal that is not present in the model catalog and must not be relied
    // on. See schema-accounts.ts.
    aiModel: "gpt-5.5",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    id: userId,
    email,
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
