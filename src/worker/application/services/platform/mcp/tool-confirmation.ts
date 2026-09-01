import { and, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import {
  getDb,
  mcpConfirmationRunGrants,
  mcpToolConfirmationIdentities,
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
import {
  isBoundedMcpToolConfirmationArguments,
  MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_BYTES,
  MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_NAME_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_SCHEMA_HASH_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_SERVER_ID_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATIONS_PER_RESPONSE,
} from "../../../../shared/types/mcp-tool-confirmations.ts";
import {
  loadRunExecutionAuthority,
  type RunExecutionAuthority,
} from "../../runs/run-authority.ts";
import { resolveActorPrincipalId } from "../../identity/principals.ts";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const CONFIRMATION_IDENTITY_VERSION = 1 as const;
const CONFIRMATION_IDENTITY_EXTENSION_VERSION = 1 as const;

export type McpToolConfirmationStatus =
  | "pending"
  | "approved"
  | "denied"
  | "consumed"
  | "expired";

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
  | { kind: "handoff"; confirmationId: string; expiresAt: string }
  | { kind: "pending"; confirmationId: string; expiresAt: string }
  | { kind: "denied"; confirmationId: string; expiresAt: string };

export type McpToolConfirmationDecision =
  | { status: "denied" }
  | {
    status: "approved";
    confirmationGrantId: string;
    requestedThreadId: string;
    expiresAt: string;
  };

export type PreparedMcpConfirmationRunGrant = {
  confirmationId: string;
  principalId: string;
  workspaceId: string;
  threadId: string;
  originIdentityHash: string;
};

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

async function keyedDigest(
  value: string,
  masterSecret: string,
  domain: string,
): Promise<string> {
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
    new TextEncoder().encode(`${domain}\0${value}`),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hashCanonicalArguments(
  canonical: string,
  masterSecret: string,
): Promise<string> {
  // The database must not expose a plain dictionary-testable digest of
  // potentially sensitive arguments. The canonical plaintext never leaves
  // this process.
  return await keyedDigest(
    canonical,
    masterSecret,
    "takos:mcp-confirmation:arguments:v1",
  );
}

type ConfirmationIdentityFields = {
  accountId: string;
  userId: string;
  principalId: string;
  serverId: string;
  toolName: string;
  schemaHash: string;
  argumentsHash: string;
  requestedRunId: string;
  requestedThreadId: string;
  runContextRevision: 1;
  runContextDigest: string;
  runGrantDigest: string;
  identityExtensionVersion: 1;
  activeContextRevision: number;
  activeContextDigest: string;
  requestedToolCallId: string;
};

type LegacyConfirmationIdentityFields = Omit<
  ConfirmationIdentityFields,
  | "identityExtensionVersion"
  | "activeContextRevision"
  | "activeContextDigest"
>;

async function hashConfirmationIdentity(
  fields: ConfirmationIdentityFields,
  masterSecret: string,
): Promise<string> {
  return await keyedDigest(
    canonicalMcpJson({
      identityVersion: CONFIRMATION_IDENTITY_VERSION,
      ...fields,
    }),
    masterSecret,
    "takos:mcp-confirmation:identity:v2",
  );
}

async function hashLegacyConfirmationIdentity(
  fields: LegacyConfirmationIdentityFields,
  masterSecret: string,
): Promise<string> {
  return await keyedDigest(
    canonicalMcpJson({
      identityVersion: CONFIRMATION_IDENTITY_VERSION,
      ...fields,
    }),
    masterSecret,
    "takos:mcp-confirmation:identity:v1",
  );
}

async function invocationIdentity(
  argumentsValue: Record<string, unknown>,
  masterSecret: string,
) {
  if (!isBoundedMcpToolConfirmationArguments(argumentsValue)) {
    throw new BadRequestError(
      "MCP tool arguments exceed the confirmation shape limit",
    );
  }
  const canonical = canonicalMcpJson(argumentsValue);
  const bytes = new TextEncoder().encode(canonical).byteLength;
  if (bytes > MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_BYTES) {
    throw new BadRequestError(
      `MCP tool arguments exceed the ${MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_BYTES}-byte confirmation limit`,
    );
  }
  return {
    canonical,
    hash: await hashCanonicalArguments(canonical, masterSecret),
  };
}

function requireBoundedConfirmationField(
  value: unknown,
  field: string,
  maxCharacters: number,
): void {
  if (
    typeof value !== "string" || !value.trim() ||
    value.length > maxCharacters
  ) {
    throw new BadRequestError(`Invalid MCP confirmation ${field}`);
  }
}

function requireAuthorityDigest(value: string, field: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new BadRequestError(`Invalid MCP confirmation ${field}`);
  }
}

function validateConfirmationRequest(params: {
  accountId: string;
  userId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  schemaHash: string;
  runId: string;
  threadId: string;
  runAuthority: RunExecutionAuthority;
  toolCallId: string;
}): void {
  requireBoundedConfirmationField(
    params.accountId,
    "Workspace id",
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  requireBoundedConfirmationField(
    params.userId,
    "user id",
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  requireBoundedConfirmationField(
    params.serverId,
    "server id",
    MAX_MCP_TOOL_CONFIRMATION_SERVER_ID_CHARACTERS,
  );
  requireBoundedConfirmationField(
    params.serverName,
    "server name",
    MAX_MCP_TOOL_CONFIRMATION_NAME_CHARACTERS,
  );
  requireBoundedConfirmationField(
    params.toolName,
    "tool name",
    MAX_MCP_TOOL_CONFIRMATION_NAME_CHARACTERS,
  );
  requireBoundedConfirmationField(
    params.runId,
    "Run id",
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  requireBoundedConfirmationField(
    params.threadId,
    "Thread id",
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  requireBoundedConfirmationField(
    params.toolCallId,
    "tool call id",
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  if (
    params.schemaHash.length !==
      MAX_MCP_TOOL_CONFIRMATION_SCHEMA_HASH_CHARACTERS ||
    !/^[a-f0-9]+$/.test(params.schemaHash)
  ) {
    throw new BadRequestError("Invalid MCP confirmation schema hash");
  }
  const authority = params.runAuthority;
  if (
    authority.runId !== params.runId ||
    authority.workspaceId !== params.accountId ||
    authority.threadId !== params.threadId
  ) {
    throw new ConflictError(
      "MCP confirmation request is not bound to the current Run authority",
    );
  }
  requireAuthorityDigest(
    authority.attestation.contextDigest,
    "context digest",
  );
  requireAuthorityDigest(
    authority.baseAttestation.contextDigest,
    "base context digest",
  );
  requireAuthorityDigest(
    authority.attestation.runGrantDigest,
    "RunGrant digest",
  );
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
        lt(mcpToolConfirmations.expiresAt, now),
      ),
    );
}

function identityFields(params: {
  accountId: string;
  userId: string;
  serverId: string;
  toolName: string;
  schemaHash: string;
  runId: string;
  threadId: string;
  runAuthority: RunExecutionAuthority;
  toolCallId: string;
}, argumentsHash: string): ConfirmationIdentityFields {
  return {
    accountId: params.accountId,
    userId: params.userId,
    principalId: params.runAuthority.principalId,
    serverId: params.serverId,
    toolName: params.toolName,
    schemaHash: params.schemaHash,
    argumentsHash,
    requestedRunId: params.runId,
    requestedThreadId: params.threadId,
    runContextRevision: 1,
    runContextDigest: params.runAuthority.baseAttestation.contextDigest,
    runGrantDigest: params.runAuthority.attestation.runGrantDigest,
    identityExtensionVersion: CONFIRMATION_IDENTITY_EXTENSION_VERSION,
    activeContextRevision: params.runAuthority.attestation.contextRevision,
    activeContextDigest: params.runAuthority.attestation.contextDigest,
    requestedToolCallId: params.toolCallId,
  };
}

async function consumeExplicitRunGrant(params: {
  dbBinding: SqlDatabaseLike;
  confirmationId: string;
  request: {
    accountId: string;
    userId: string;
    serverId: string;
    toolName: string;
    schemaHash: string;
    runId: string;
    threadId: string;
    runAuthority: RunExecutionAuthority;
    toolCallId: string;
  };
  argumentsHash: string;
  masterSecret: string;
  now: string;
}): Promise<boolean> {
  const db = getDb(params.dbBinding);
  const row = await db.select({
    accountId: mcpToolConfirmations.accountId,
    userId: mcpToolConfirmations.userId,
    serverId: mcpToolConfirmations.serverId,
    toolName: mcpToolConfirmations.toolName,
    schemaHash: mcpToolConfirmations.schemaHash,
    argumentsHash: mcpToolConfirmations.argumentsHash,
    status: mcpToolConfirmations.status,
    expiresAt: mcpToolConfirmations.expiresAt,
    consumedRunId: mcpToolConfirmations.consumedRunId,
    requestedRunId: mcpToolConfirmations.requestedRunId,
    requestedThreadId: mcpToolConfirmations.requestedThreadId,
    identityVersion: mcpToolConfirmationIdentities.identityVersion,
    identityHash: mcpToolConfirmationIdentities.identityHash,
    identityPrincipalId: mcpToolConfirmationIdentities.principalId,
    identityRequestedRunId: mcpToolConfirmationIdentities.requestedRunId,
    identityRequestedThreadId: mcpToolConfirmationIdentities.requestedThreadId,
    identityContextRevision: mcpToolConfirmationIdentities.runContextRevision,
    identityContextDigest: mcpToolConfirmationIdentities.runContextDigest,
    identityRunGrantDigest: mcpToolConfirmationIdentities.runGrantDigest,
    identityExtensionVersion:
      mcpToolConfirmationIdentities.identityExtensionVersion,
    identityActiveContextRevision:
      mcpToolConfirmationIdentities.activeContextRevision,
    identityActiveContextDigest:
      mcpToolConfirmationIdentities.activeContextDigest,
    identityRequestedToolCallId:
      mcpToolConfirmationIdentities.requestedToolCallId,
    claimRunId: mcpConfirmationRunGrants.runId,
    claimPrincipalId: mcpConfirmationRunGrants.principalId,
    claimWorkspaceId: mcpConfirmationRunGrants.workspaceId,
    claimThreadId: mcpConfirmationRunGrants.threadId,
    claimContextRevision: mcpConfirmationRunGrants.runContextRevision,
    claimContextDigest: mcpConfirmationRunGrants.runContextDigest,
    claimRunGrantDigest: mcpConfirmationRunGrants.runGrantDigest,
    claimOriginIdentityHash: mcpConfirmationRunGrants.originIdentityHash,
    consumedToolCallId: mcpConfirmationRunGrants.consumedToolCallId,
  }).from(mcpConfirmationRunGrants)
    .innerJoin(
      mcpToolConfirmations,
      eq(
        mcpToolConfirmations.id,
        mcpConfirmationRunGrants.confirmationId,
      ),
    )
    .innerJoin(
      mcpToolConfirmationIdentities,
      eq(
        mcpToolConfirmationIdentities.confirmationId,
        mcpConfirmationRunGrants.confirmationId,
      ),
    )
    .where(eq(mcpConfirmationRunGrants.confirmationId, params.confirmationId))
    .get();
  if (!row) return false;

  const legacyIdentityFields: LegacyConfirmationIdentityFields = {
      accountId: row.accountId,
      userId: row.userId,
      principalId: row.identityPrincipalId,
      serverId: row.serverId,
      toolName: row.toolName,
      schemaHash: row.schemaHash,
      argumentsHash: row.argumentsHash,
      requestedRunId: row.identityRequestedRunId,
      requestedThreadId: row.identityRequestedThreadId,
      runContextRevision: 1,
      runContextDigest: row.identityContextDigest,
      runGrantDigest: row.identityRunGrantDigest,
      requestedToolCallId: row.identityRequestedToolCallId,
  };
  const authenticOriginHash = row.identityContextRevision !== 1
    ? null
    : row.identityExtensionVersion ===
          CONFIRMATION_IDENTITY_EXTENSION_VERSION &&
        Number.isSafeInteger(row.identityActiveContextRevision) &&
        Number(row.identityActiveContextRevision) >= 1 &&
        typeof row.identityActiveContextDigest === "string"
      ? await hashConfirmationIdentity({
        ...legacyIdentityFields,
        identityExtensionVersion: CONFIRMATION_IDENTITY_EXTENSION_VERSION,
        activeContextRevision: Number(row.identityActiveContextRevision),
        activeContextDigest: row.identityActiveContextDigest,
      }, params.masterSecret)
      : row.identityExtensionVersion === null &&
          row.identityActiveContextRevision === null &&
          row.identityActiveContextDigest === null
        ? await hashLegacyConfirmationIdentity(
          legacyIdentityFields,
          params.masterSecret,
        )
        : null;

  const authority = params.request.runAuthority;
  const exactInvocation = row.accountId === params.request.accountId &&
    row.userId === params.request.userId &&
    row.serverId === params.request.serverId &&
    row.toolName === params.request.toolName &&
    row.schemaHash === params.request.schemaHash &&
    row.argumentsHash === params.argumentsHash;
  const exactAuthority =
    row.identityVersion === CONFIRMATION_IDENTITY_VERSION &&
    row.identityContextRevision === 1 &&
    row.identityPrincipalId === authority.principalId &&
    row.identityRequestedRunId === row.requestedRunId &&
    row.identityRequestedThreadId === row.requestedThreadId &&
    authenticOriginHash === row.identityHash &&
    row.claimRunId === params.request.runId &&
    row.claimPrincipalId === authority.principalId &&
    row.claimWorkspaceId === params.request.accountId &&
    row.claimThreadId === params.request.threadId &&
    row.claimContextRevision === authority.baseAttestation.contextRevision &&
    row.claimContextDigest === authority.baseAttestation.contextDigest &&
    row.claimRunGrantDigest === authority.attestation.runGrantDigest &&
    row.claimOriginIdentityHash === row.identityHash;
  if (!exactInvocation || !exactAuthority) return false;

  if (row.consumedToolCallId !== null) {
    return row.consumedToolCallId === params.request.toolCallId &&
      row.status === "consumed" &&
      row.consumedRunId === params.request.runId;
  }
  if (row.status !== "approved" || row.expiresAt <= params.now) return false;

  const claimed = await db.update(mcpConfirmationRunGrants).set({
    consumedToolCallId: params.request.toolCallId,
    consumedAt: params.now,
  }).where(and(
    eq(mcpConfirmationRunGrants.confirmationId, params.confirmationId),
    eq(mcpConfirmationRunGrants.runId, params.request.runId),
    isNull(mcpConfirmationRunGrants.consumedToolCallId),
  )).returning({ confirmationId: mcpConfirmationRunGrants.confirmationId })
    .get();
  if (!claimed) {
    const winner = await db.select({
      toolCallId: mcpConfirmationRunGrants.consumedToolCallId,
    }).from(mcpConfirmationRunGrants).where(and(
      eq(mcpConfirmationRunGrants.confirmationId, params.confirmationId),
      eq(mcpConfirmationRunGrants.runId, params.request.runId),
    )).get();
    return winner?.toolCallId === params.request.toolCallId;
  }

  const consumed = await db.update(mcpToolConfirmations).set({
    status: "consumed",
    consumedRunId: params.request.runId,
    consumedAt: params.now,
    updatedAt: params.now,
  }).where(and(
    eq(mcpToolConfirmations.id, params.confirmationId),
    eq(mcpToolConfirmations.status, "approved"),
    gt(mcpToolConfirmations.expiresAt, params.now),
  )).returning({ id: mcpToolConfirmations.id }).get();
  if (consumed) return true;

  const current = await db.select({
    status: mcpToolConfirmations.status,
    consumedRunId: mcpToolConfirmations.consumedRunId,
  }).from(mcpToolConfirmations).where(
    eq(mcpToolConfirmations.id, params.confirmationId),
  ).get();
  if (
    current?.status === "consumed" &&
    current.consumedRunId === params.request.runId
  ) {
    return true;
  }
  throw new ConflictError(
    "MCP confirmation changed while its one-time Run grant was consumed",
  );
}

/**
 * Consume the current Run's exact one-time grant, or create/reuse a decision
 * bound to the exact origin Run revision and tool-call identity.
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
    runAuthority: RunExecutionAuthority;
    toolCallId: string;
  },
): Promise<McpToolConfirmationRequirement> {
  validateConfirmationRequest(params);
  const masterSecret = requireEncryptionKey(env);
  const now = new Date().toISOString();
  await expireOldConfirmations(dbBinding, params.accountId, params.userId, now);
  const invocation = await invocationIdentity(params.arguments, masterSecret);

  for (const confirmationId of params.runAuthority.confirmationGrantIds) {
    if (
      await consumeExplicitRunGrant({
        dbBinding,
        confirmationId,
        request: params,
        argumentsHash: invocation.hash,
        masterSecret,
        now,
      })
    ) {
      return { kind: "approved", confirmationId };
    }
  }

  const exactIdentity = identityFields(params, invocation.hash);
  const identityHash = await hashConfirmationIdentity(
    exactIdentity,
    masterSecret,
  );
  const db = getDb(dbBinding);
  const readExact = async () =>
    await db.select({
      id: mcpToolConfirmations.id,
      status: mcpToolConfirmations.status,
      expiresAt: mcpToolConfirmations.expiresAt,
    }).from(mcpToolConfirmationIdentities)
      .innerJoin(
        mcpToolConfirmations,
        eq(
          mcpToolConfirmations.id,
          mcpToolConfirmationIdentities.confirmationId,
        ),
      )
      .where(and(
        eq(mcpToolConfirmationIdentities.identityHash, identityHash),
        gt(mcpToolConfirmations.expiresAt, now),
        inArray(mcpToolConfirmations.status, [
          "approved",
          "pending",
          "denied",
        ]),
      ))
      .get();

  const exact = await readExact();
  if (exact?.status === "approved") {
    return {
      kind: "handoff",
      confirmationId: exact.id,
      expiresAt: exact.expiresAt,
    };
  }
  if (exact?.status === "denied") {
    return {
      kind: "denied",
      confirmationId: exact.id,
      expiresAt: exact.expiresAt,
    };
  }
  if (exact?.status === "pending") {
    return {
      kind: "pending",
      confirmationId: exact.id,
      expiresAt: exact.expiresAt,
    };
  }

  const id = generateId(20);
  const expiresAt = new Date(
    Date.parse(now) + CONFIRMATION_TTL_MS,
  ).toISOString();
  const argumentsCiphertext = await encryptToken(
    invocation.canonical,
    masterSecret,
    confirmationSalt(id),
  );
  try {
    await db.batch([
      db.insert(mcpToolConfirmations).values({
        id,
        accountId: params.accountId,
        userId: params.userId,
        serverId: params.serverId,
        serverName: params.serverName,
        toolName: params.toolName,
        schemaHash: params.schemaHash,
        argumentsHash: invocation.hash,
        argumentsCiphertext,
        requestedRunId: params.runId,
        requestedThreadId: params.threadId,
        status: "pending",
        expiresAt,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(mcpToolConfirmationIdentities).values({
        confirmationId: id,
        identityVersion: CONFIRMATION_IDENTITY_VERSION,
        principalId: exactIdentity.principalId,
        requestedRunId: exactIdentity.requestedRunId,
        requestedThreadId: exactIdentity.requestedThreadId,
        runContextRevision: exactIdentity.runContextRevision,
        runContextDigest: exactIdentity.runContextDigest,
        runGrantDigest: exactIdentity.runGrantDigest,
        identityExtensionVersion: exactIdentity.identityExtensionVersion,
        activeContextRevision: exactIdentity.activeContextRevision,
        activeContextDigest: exactIdentity.activeContextDigest,
        requestedToolCallId: exactIdentity.requestedToolCallId,
        identityHash,
        createdAt: now,
      }),
    ]);
  } catch (error) {
    // Concurrent identical model calls collapse on the keyed identity. Only
    // swallow the insert error when the exact authoritative row now exists.
    const winner = await readExact();
    if (winner?.status === "pending") {
      return {
        kind: "pending",
        confirmationId: winner.id,
        expiresAt: winner.expiresAt,
      };
    }
    throw error;
  }
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
  if (!isBoundedMcpToolConfirmationArguments(value)) {
    throw new ConflictError("Stored MCP confirmation arguments are invalid");
  }
  return value;
}

export async function listActionableMcpToolConfirmations(
  dbBinding: SqlDatabaseLike,
  env: Env,
  params: { accountId: string; userId: string },
): Promise<McpToolConfirmationRecord[]> {
  requireBoundedConfirmationField(
    params.accountId,
    "Workspace id",
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  requireBoundedConfirmationField(
    params.userId,
    "user id",
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  const now = new Date().toISOString();
  await expireOldConfirmations(dbBinding, params.accountId, params.userId, now);
  const rows = await getDb(dbBinding)
    .select({
      confirmation: mcpToolConfirmations,
      claimedRunId: mcpConfirmationRunGrants.runId,
    })
    .from(mcpToolConfirmations)
    .innerJoin(
      mcpToolConfirmationIdentities,
      eq(
        mcpToolConfirmationIdentities.confirmationId,
        mcpToolConfirmations.id,
      ),
    )
    .leftJoin(
      mcpConfirmationRunGrants,
      eq(
        mcpConfirmationRunGrants.confirmationId,
        mcpToolConfirmations.id,
      ),
    )
    .where(
      and(
        eq(mcpToolConfirmations.accountId, params.accountId),
        eq(mcpToolConfirmations.userId, params.userId),
        gt(mcpToolConfirmations.expiresAt, now),
        or(
          eq(mcpToolConfirmations.status, "pending"),
          and(
            eq(mcpToolConfirmations.status, "approved"),
            isNull(mcpConfirmationRunGrants.runId),
          ),
        ),
      ),
    )
    .orderBy(desc(mcpToolConfirmations.createdAt))
    .limit(MAX_MCP_TOOL_CONFIRMATIONS_PER_RESPONSE + 1)
    .all();
  return await Promise.all(
    rows.map(async ({ confirmation: row }) => ({
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
): Promise<McpToolConfirmationDecision> {
  requireBoundedConfirmationField(
    params.accountId,
    "Workspace id",
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  requireBoundedConfirmationField(
    params.userId,
    "user id",
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  requireBoundedConfirmationField(
    params.confirmationId,
    "id",
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  if (params.decision !== "approve" && params.decision !== "deny") {
    throw new BadRequestError("Invalid MCP confirmation decision");
  }
  const now = new Date().toISOString();
  const db = getDb(dbBinding);
  const row = await db.select({
    id: mcpToolConfirmations.id,
    status: mcpToolConfirmations.status,
    expiresAt: mcpToolConfirmations.expiresAt,
    requestedThreadId: mcpToolConfirmations.requestedThreadId,
    claimedRunId: mcpConfirmationRunGrants.runId,
  }).from(mcpToolConfirmations)
    .innerJoin(
      mcpToolConfirmationIdentities,
      eq(
        mcpToolConfirmationIdentities.confirmationId,
        mcpToolConfirmations.id,
      ),
    )
    .leftJoin(
      mcpConfirmationRunGrants,
      eq(
        mcpConfirmationRunGrants.confirmationId,
        mcpToolConfirmations.id,
      ),
    )
    .where(
      and(
        eq(mcpToolConfirmations.id, params.confirmationId),
        eq(mcpToolConfirmations.accountId, params.accountId),
        eq(mcpToolConfirmations.userId, params.userId),
      ),
    ).get();
  if (!row) throw new NotFoundError("MCP tool confirmation");
  if (
    params.decision === "approve" && row.status === "approved" &&
    row.expiresAt > now && row.claimedRunId === null
  ) {
    return {
      status: "approved",
      confirmationGrantId: row.id,
      requestedThreadId: row.requestedThreadId,
      expiresAt: row.expiresAt,
    };
  }
  if (params.decision === "deny" && row.status === "denied") {
    return { status: "denied" };
  }
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
  return status === "denied" ? { status } : {
    status,
    confirmationGrantId: row.id,
    requestedThreadId: row.requestedThreadId,
    expiresAt: row.expiresAt,
  };
}

/**
 * Validate an approved confirmation before it is atomically claimed by a new
 * user-originated Run. The origin authority is reloaded from canonical rows;
 * an edited/stale identity never reaches the Run creation batch.
 */
export async function prepareMcpConfirmationRunGrant(
  dbBinding: SqlDatabaseLike,
  env: Env,
  params: {
    confirmationId: string;
    accountId: string;
    userId: string;
    threadId: string;
    runId: string;
    now: string;
  },
): Promise<PreparedMcpConfirmationRunGrant> {
  for (
    const [field, value] of [
      ["id", params.confirmationId],
      ["Workspace id", params.accountId],
      ["user id", params.userId],
      ["Thread id", params.threadId],
      ["Run id", params.runId],
    ] as const
  ) {
    requireBoundedConfirmationField(
      value,
      field,
      MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
    );
  }
  if (!Number.isFinite(Date.parse(params.now))) {
    throw new BadRequestError("Invalid MCP confirmation claim time");
  }

  const db = getDb(dbBinding);
  const row = await db.select({
    accountId: mcpToolConfirmations.accountId,
    userId: mcpToolConfirmations.userId,
    serverId: mcpToolConfirmations.serverId,
    toolName: mcpToolConfirmations.toolName,
    schemaHash: mcpToolConfirmations.schemaHash,
    argumentsHash: mcpToolConfirmations.argumentsHash,
    requestedRunId: mcpToolConfirmations.requestedRunId,
    requestedThreadId: mcpToolConfirmations.requestedThreadId,
    status: mcpToolConfirmations.status,
    expiresAt: mcpToolConfirmations.expiresAt,
    decidedAt: mcpToolConfirmations.decidedAt,
    consumedRunId: mcpToolConfirmations.consumedRunId,
    identityVersion: mcpToolConfirmationIdentities.identityVersion,
    principalId: mcpToolConfirmationIdentities.principalId,
    identityRunId: mcpToolConfirmationIdentities.requestedRunId,
    identityThreadId: mcpToolConfirmationIdentities.requestedThreadId,
    contextRevision: mcpToolConfirmationIdentities.runContextRevision,
    contextDigest: mcpToolConfirmationIdentities.runContextDigest,
    runGrantDigest: mcpToolConfirmationIdentities.runGrantDigest,
    identityExtensionVersion:
      mcpToolConfirmationIdentities.identityExtensionVersion,
    activeContextRevision: mcpToolConfirmationIdentities.activeContextRevision,
    activeContextDigest: mcpToolConfirmationIdentities.activeContextDigest,
    requestedToolCallId: mcpToolConfirmationIdentities.requestedToolCallId,
    identityHash: mcpToolConfirmationIdentities.identityHash,
    claimedRunId: mcpConfirmationRunGrants.runId,
  }).from(mcpToolConfirmations)
    .innerJoin(
      mcpToolConfirmationIdentities,
      eq(
        mcpToolConfirmationIdentities.confirmationId,
        mcpToolConfirmations.id,
      ),
    )
    .leftJoin(
      mcpConfirmationRunGrants,
      eq(
        mcpConfirmationRunGrants.confirmationId,
        mcpToolConfirmations.id,
      ),
    )
    .where(eq(mcpToolConfirmations.id, params.confirmationId))
    .get();
  if (!row) throw new ConflictError("MCP confirmation grant is not available");
  if (
    row.accountId !== params.accountId || row.userId !== params.userId ||
    row.requestedThreadId !== params.threadId ||
    row.status !== "approved" || row.decidedAt === null ||
    row.consumedRunId !== null || row.expiresAt <= params.now ||
    row.identityVersion !== CONFIRMATION_IDENTITY_VERSION ||
    row.requestedRunId !== row.identityRunId ||
    row.requestedThreadId !== row.identityThreadId ||
    (row.claimedRunId !== null && row.claimedRunId !== params.runId)
  ) {
    throw new ConflictError("MCP confirmation grant is not valid for this Run");
  }

  const principalId = await resolveActorPrincipalId(dbBinding, params.userId);
  if (!principalId || principalId !== row.principalId) {
    throw new ConflictError("MCP confirmation principal is no longer active");
  }
  const originAuthority = await loadRunExecutionAuthority({
    db: dbBinding,
    runId: row.requestedRunId,
  }).catch(() => null);
  const extendedIdentity = row.identityExtensionVersion ===
      CONFIRMATION_IDENTITY_EXTENSION_VERSION &&
    Number.isSafeInteger(row.activeContextRevision) &&
    Number(row.activeContextRevision) >= 1 &&
    typeof row.activeContextDigest === "string";
  const legacyIdentity = row.identityExtensionVersion === null &&
    row.activeContextRevision === null && row.activeContextDigest === null;
  if (
    !originAuthority ||
    originAuthority.principalId !== principalId ||
    originAuthority.workspaceId !== params.accountId ||
    originAuthority.threadId !== params.threadId ||
    row.contextRevision !== 1 ||
    originAuthority.baseAttestation.contextRevision !== row.contextRevision ||
    originAuthority.baseAttestation.contextDigest !== row.contextDigest ||
    (!extendedIdentity && !legacyIdentity) ||
    (extendedIdentity &&
      (originAuthority.attestation.contextRevision !==
          row.activeContextRevision ||
        originAuthority.attestation.contextDigest !==
          row.activeContextDigest)) ||
    (legacyIdentity &&
      (originAuthority.attestation.contextRevision !== row.contextRevision ||
        originAuthority.attestation.contextDigest !== row.contextDigest)) ||
    originAuthority.attestation.runGrantDigest !== row.runGrantDigest
  ) {
    throw new ConflictError(
      "MCP confirmation origin authority is no longer valid",
    );
  }

  const legacyFields: LegacyConfirmationIdentityFields = {
    accountId: row.accountId,
    userId: row.userId,
    principalId: row.principalId,
    serverId: row.serverId,
    toolName: row.toolName,
    schemaHash: row.schemaHash,
    argumentsHash: row.argumentsHash,
    requestedRunId: row.requestedRunId,
    requestedThreadId: row.requestedThreadId,
    runContextRevision: 1,
    runContextDigest: row.contextDigest,
    runGrantDigest: row.runGrantDigest,
    requestedToolCallId: row.requestedToolCallId,
  };
  const expectedHash = extendedIdentity
    ? await hashConfirmationIdentity({
      ...legacyFields,
      identityExtensionVersion: CONFIRMATION_IDENTITY_EXTENSION_VERSION,
      activeContextRevision: Number(row.activeContextRevision),
      activeContextDigest: row.activeContextDigest as string,
    }, requireEncryptionKey(env))
    : await hashLegacyConfirmationIdentity(
      legacyFields,
      requireEncryptionKey(env),
    );
  if (expectedHash !== row.identityHash) {
    throw new ConflictError("MCP confirmation identity is not authentic");
  }

  return {
    confirmationId: params.confirmationId,
    principalId,
    workspaceId: params.accountId,
    threadId: params.threadId,
    originIdentityHash: row.identityHash,
  };
}

export async function releaseUnconsumedMcpConfirmationRunGrant(
  dbBinding: SqlDatabaseLike,
  runId: string,
): Promise<void> {
  await getDb(dbBinding).delete(mcpConfirmationRunGrants).where(and(
    eq(mcpConfirmationRunGrants.runId, runId),
    isNull(mcpConfirmationRunGrants.consumedToolCallId),
  ));
}

export async function getMcpConfirmationRunGrantClaim(
  dbBinding: SqlDatabaseLike,
  confirmationId: string,
): Promise<string | null> {
  const row = await getDb(dbBinding).select({
    runId: mcpConfirmationRunGrants.runId,
  }).from(mcpConfirmationRunGrants).where(
    eq(mcpConfirmationRunGrants.confirmationId, confirmationId),
  ).get();
  return row?.runId ?? null;
}
