import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import {
  getDb,
  mcpToolConfirmations,
  type SqlDatabaseLike,
} from "../../../../infra/db/index.ts";
import type { Env } from "../../../../shared/types/index.ts";
import type { SelectOf } from "../../../../shared/types/drizzle-utils.ts";
import { generateId } from "../../../../shared/utils/index.ts";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";
import { decryptToken, encryptToken } from "./crypto.ts";
import { canonicalMcpJson } from "./tool-policy.ts";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const MAX_CONFIRMATION_ARGUMENT_BYTES = 64 * 1024;

export type McpToolConfirmationStatus =
  "pending" | "approved" | "denied" | "consumed" | "expired";

export interface McpToolConfirmationRecord {
  id: string;
  accountId: string;
  userId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  schemaHash: string;
  arguments: Record<string, unknown>;
  requestedRunId: string;
  requestedThreadId: string;
  status: McpToolConfirmationStatus;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
}

export type McpToolConfirmationRequirement =
  | { kind: "approved"; confirmationId: string }
  | { kind: "pending"; confirmationId: string; expiresAt: string }
  | { kind: "denied"; confirmationId: string; expiresAt: string };

function confirmationSalt(id: string): string {
  return `mcp:tool-confirmation:arguments:${id}`;
}

function requireEncryptionKey(env: Env): string {
  const key = env.ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new ServiceUnavailableError(
      "MCP invocation confirmation encryption is not configured",
    );
  }
  return key;
}

async function hashCanonicalArguments(
  canonical: string,
  masterSecret: string,
): Promise<string> {
  // The database must not expose a plain dictionary-testable digest of
  // potentially sensitive arguments. Bind the lookup identity to the same
  // operator secret that encrypts the payload; the canonical plaintext never
  // leaves this process.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(masterSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`takos:mcp-confirmation:v1\0${canonical}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function invocationIdentity(
  argumentsValue: Record<string, unknown>,
  masterSecret: string,
) {
  const canonical = canonicalMcpJson(argumentsValue);
  const bytes = new TextEncoder().encode(canonical).byteLength;
  if (bytes > MAX_CONFIRMATION_ARGUMENT_BYTES) {
    throw new BadRequestError(
      `MCP tool arguments exceed the ${MAX_CONFIRMATION_ARGUMENT_BYTES}-byte confirmation limit`,
    );
  }
  return {
    canonical,
    hash: await hashCanonicalArguments(canonical, masterSecret),
  };
}

function statusOf(row: SelectOf<typeof mcpToolConfirmations>) {
  return row.status as McpToolConfirmationStatus;
}

async function expireOldConfirmations(
  dbBinding: SqlDatabaseLike,
  accountId: string,
  userId: string,
  now: string,
): Promise<void> {
  await getDb(dbBinding)
    .update(mcpToolConfirmations)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(mcpToolConfirmations.accountId, accountId),
        eq(mcpToolConfirmations.userId, userId),
        inArray(mcpToolConfirmations.status, ["pending", "approved"]),
        // SQLite text timestamps are ISO-8601 and therefore sort
        // lexicographically in chronological order.
        lt(mcpToolConfirmations.expiresAt, now),
      ),
    );
}

/**
 * Consume one matching one-time approval, or create/reuse a pending decision.
 * The exact canonical arguments are encrypted and are never logged.
 */
export async function requireMcpToolInvocationConfirmation(
  dbBinding: SqlDatabaseLike,
  env: Env,
  params: {
    accountId: string;
    userId: string;
    serverId: string;
    serverName: string;
    toolName: string;
    schemaHash: string;
    arguments: Record<string, unknown>;
    runId: string;
    threadId: string;
  },
): Promise<McpToolConfirmationRequirement> {
  const masterSecret = requireEncryptionKey(env);
  const now = new Date().toISOString();
  await expireOldConfirmations(dbBinding, params.accountId, params.userId, now);
  const identity = await invocationIdentity(params.arguments, masterSecret);
  const db = getDb(dbBinding);
  const matches = await db
    .select()
    .from(mcpToolConfirmations)
    .where(
      and(
        eq(mcpToolConfirmations.accountId, params.accountId),
        eq(mcpToolConfirmations.userId, params.userId),
        eq(mcpToolConfirmations.serverId, params.serverId),
        eq(mcpToolConfirmations.toolName, params.toolName),
        eq(mcpToolConfirmations.schemaHash, params.schemaHash),
        eq(mcpToolConfirmations.argumentsHash, identity.hash),
        gt(mcpToolConfirmations.expiresAt, now),
        inArray(mcpToolConfirmations.status, ["approved", "pending", "denied"]),
      ),
    )
    .orderBy(desc(mcpToolConfirmations.createdAt))
    .all();

  const approved = matches.find((row) => statusOf(row) === "approved");
  if (approved) {
    const consumed = await db
      .update(mcpToolConfirmations)
      .set({
        status: "consumed",
        consumedRunId: params.runId,
        consumedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(mcpToolConfirmations.id, approved.id),
          eq(mcpToolConfirmations.status, "approved"),
        ),
      )
      .returning({ id: mcpToolConfirmations.id })
      .get();
    if (consumed) return { kind: "approved", confirmationId: consumed.id };
  }

  const denied = matches.find((row) => statusOf(row) === "denied");
  if (denied) {
    return {
      kind: "denied",
      confirmationId: denied.id,
      expiresAt: denied.expiresAt,
    };
  }
  const pending = matches.find((row) => statusOf(row) === "pending");
  if (pending) {
    return {
      kind: "pending",
      confirmationId: pending.id,
      expiresAt: pending.expiresAt,
    };
  }

  const id = generateId(20);
  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS).toISOString();
  const argumentsCiphertext = await encryptToken(
    identity.canonical,
    masterSecret,
    confirmationSalt(id),
  );
  await db.insert(mcpToolConfirmations).values({
    id,
    accountId: params.accountId,
    userId: params.userId,
    serverId: params.serverId,
    serverName: params.serverName,
    toolName: params.toolName,
    schemaHash: params.schemaHash,
    argumentsHash: identity.hash,
    argumentsCiphertext,
    requestedRunId: params.runId,
    requestedThreadId: params.threadId,
    status: "pending",
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  return { kind: "pending", confirmationId: id, expiresAt };
}

async function decryptArguments(
  env: Env,
  row: SelectOf<typeof mcpToolConfirmations>,
): Promise<Record<string, unknown>> {
  const plaintext = await decryptToken(
    row.argumentsCiphertext,
    requireEncryptionKey(env),
    confirmationSalt(row.id),
  );
  const value = JSON.parse(plaintext) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConflictError("Stored MCP confirmation arguments are invalid");
  }
  return value as Record<string, unknown>;
}

export async function listPendingMcpToolConfirmations(
  dbBinding: SqlDatabaseLike,
  env: Env,
  params: { accountId: string; userId: string },
): Promise<McpToolConfirmationRecord[]> {
  const now = new Date().toISOString();
  await expireOldConfirmations(dbBinding, params.accountId, params.userId, now);
  const rows = await getDb(dbBinding)
    .select()
    .from(mcpToolConfirmations)
    .where(
      and(
        eq(mcpToolConfirmations.accountId, params.accountId),
        eq(mcpToolConfirmations.userId, params.userId),
        eq(mcpToolConfirmations.status, "pending"),
        gt(mcpToolConfirmations.expiresAt, now),
      ),
    )
    .orderBy(desc(mcpToolConfirmations.createdAt))
    .all();
  return await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      accountId: row.accountId,
      userId: row.userId,
      serverId: row.serverId,
      serverName: row.serverName,
      toolName: row.toolName,
      schemaHash: row.schemaHash,
      arguments: await decryptArguments(env, row),
      requestedRunId: row.requestedRunId,
      requestedThreadId: row.requestedThreadId,
      status: statusOf(row),
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    })),
  );
}

export async function decideMcpToolConfirmation(
  dbBinding: SqlDatabaseLike,
  params: {
    accountId: string;
    userId: string;
    confirmationId: string;
    decision: "approve" | "deny";
  },
): Promise<McpToolConfirmationStatus> {
  const now = new Date().toISOString();
  const db = getDb(dbBinding);
  const row = await db
    .select()
    .from(mcpToolConfirmations)
    .where(
      and(
        eq(mcpToolConfirmations.id, params.confirmationId),
        eq(mcpToolConfirmations.accountId, params.accountId),
        eq(mcpToolConfirmations.userId, params.userId),
      ),
    )
    .get();
  if (!row) throw new NotFoundError("MCP tool confirmation");
  if (row.status !== "pending" || row.expiresAt <= now) {
    throw new ConflictError("MCP tool confirmation is no longer pending");
  }
  const status = params.decision === "approve" ? "approved" : "denied";
  const decided = await db
    .update(mcpToolConfirmations)
    .set({ status, decidedAt: now, updatedAt: now })
    .where(
      and(
        eq(mcpToolConfirmations.id, row.id),
        eq(mcpToolConfirmations.status, "pending"),
      ),
    )
    .returning({ id: mcpToolConfirmations.id })
    .get();
  if (!decided) {
    throw new ConflictError("MCP tool confirmation was decided concurrently");
  }
  return status;
}
