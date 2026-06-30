import { and, eq } from "drizzle-orm";
import type {
  MobileProductKind,
  MobilePushHostRegistration,
  MobilePushHostUnregistrationResponse,
} from "takosumi-contract/mobile";

import { getDb, mobilePushRegistrations } from "../../../infra/db/index.ts";
import type { SqlDatabaseLike } from "../../../infra/db/client.ts";
import { generateId } from "../../../shared/utils/index.ts";

export interface RegisterMobilePushRegistrationInput {
  readonly accountId: string;
  readonly product: MobileProductKind;
  readonly token: string;
  readonly environment?: string | null;
  readonly hostUrl?: string | null;
}

export type RegisteredMobilePushRegistration = MobilePushHostRegistration;

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function registerMobilePushRegistration(
  dbBinding: SqlDatabaseLike,
  input: RegisterMobilePushRegistrationInput,
): Promise<RegisteredMobilePushRegistration> {
  const db = getDb(dbBinding);
  const now = new Date().toISOString();
  const environment = input.environment?.trim() || "production";
  const hostUrl = input.hostUrl?.trim() || null;
  const tokenHash = await sha256Hex(input.token);

  await db
    .insert(mobilePushRegistrations)
    .values({
      id: generateId(16),
      accountId: input.accountId,
      product: input.product,
      token: input.token,
      tokenHash,
      environment,
      hostUrl,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [
        mobilePushRegistrations.accountId,
        mobilePushRegistrations.product,
        mobilePushRegistrations.tokenHash,
      ],
      set: {
        token: input.token,
        environment,
        hostUrl,
        updatedAt: now,
        lastSeenAt: now,
      },
    });

  const row = await db
    .select({
      id: mobilePushRegistrations.id,
      product: mobilePushRegistrations.product,
      environment: mobilePushRegistrations.environment,
      hostUrl: mobilePushRegistrations.hostUrl,
      createdAt: mobilePushRegistrations.createdAt,
      lastSeenAt: mobilePushRegistrations.lastSeenAt,
    })
    .from(mobilePushRegistrations)
    .where(
      and(
        eq(mobilePushRegistrations.accountId, input.accountId),
        eq(mobilePushRegistrations.product, input.product),
        eq(mobilePushRegistrations.tokenHash, tokenHash),
      ),
    )
    .get();

  if (!row) {
    throw new Error("Failed to register mobile push token");
  }

  return {
    id: row.id,
    product: input.product,
    environment: row.environment,
    host_url: row.hostUrl,
    registered_at: row.createdAt,
    last_seen_at: row.lastSeenAt,
  };
}

export async function unregisterMobilePushRegistration(
  dbBinding: SqlDatabaseLike,
  input: RegisterMobilePushRegistrationInput,
): Promise<MobilePushHostUnregistrationResponse> {
  const db = getDb(dbBinding);
  const environment = input.environment?.trim() || "production";
  const tokenHash = await sha256Hex(input.token);

  await db
    .delete(mobilePushRegistrations)
    .where(
      and(
        eq(mobilePushRegistrations.accountId, input.accountId),
        eq(mobilePushRegistrations.product, input.product),
        eq(mobilePushRegistrations.environment, environment),
        eq(mobilePushRegistrations.tokenHash, tokenHash),
      ),
    );

  return { unregistered: true };
}
