import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import {
  agentResourceDeletionOutbox,
  agentResourceTombstones,
  getDb,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import { stringifyCanonicalJson } from "../../../shared/utils/canonical-json.ts";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { cancelRunsReferencingAgentResource } from "../runs/run-context-revocation.ts";

export const AGENT_RESOURCE_KINDS = [
  "explicit_memory",
  "turn_projection",
  "skill_revision",
  "artifact",
] as const;
export type AgentResourceKind = (typeof AGENT_RESOURCE_KINDS)[number];

export type PreparedAgentResourceDeletion = {
  id: string;
  accountId: string;
  resourceKind: AgentResourceKind;
  resourceId: string;
  sourceDigest: string;
  deletedByAccountId: string | null;
  deletedAt: string;
  vectorIdsJson: string;
  offloadObjectKeysJson: string;
};

export type AgentResourceDeletionBatchSummary = {
  selected: number;
  claimed: number;
  completed: number;
  retrying: number;
  failed: number;
};

export type AgentResourceTombstoneIdentity = {
  id: string;
  accountId: string;
  resourceKind: AgentResourceKind;
  resourceId: string;
};

const MAX_TARGETS_PER_RESOURCE = 100;
const MAX_VECTOR_ID_CHARACTERS = 512;
const MAX_OBJECT_KEY_CHARACTERS = 1024;
const DEFAULT_BATCH_LIMIT = 25;
const MAX_BATCH_LIMIT = 50;
const MAX_ATTEMPTS = 8;
const CLAIM_STALE_MS = 10 * 60 * 1000;
const MAX_ERROR_CHARACTERS = 500;

class InvalidDeletionTargetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDeletionTargetsError";
  }
}

function canonicalTargetList(
  value: readonly string[] | undefined,
  label: string,
  maxCharacters: number,
): string[] {
  const targets = value ?? [];
  if (targets.length > MAX_TARGETS_PER_RESOURCE) {
    throw new TypeError(`${label} exceeds the deletion target limit`);
  }
  const normalized = targets.map((target) => {
    if (
      typeof target !== "string" || !target || target.trim() !== target ||
      target.length > maxCharacters
    ) {
      throw new TypeError(`Invalid ${label} deletion target`);
    }
    return target;
  });
  const canonical = Array.from(new Set(normalized)).sort();
  if (canonical.length !== normalized.length) {
    throw new TypeError(`Duplicate ${label} deletion target`);
  }
  return canonical;
}

function canonicalJson(value: unknown): string {
  const result = stringifyCanonicalJson(value);
  if (result === undefined) {
    throw new TypeError("Agent resource deletion source is not serializable");
  }
  return result;
}

export async function prepareAgentResourceDeletion(input: {
  accountId: string;
  resourceKind: AgentResourceKind;
  resourceId: string;
  source: unknown;
  deletedByAccountId: string | null;
  deletedAt: string;
  vectorIds?: readonly string[];
  offloadObjectKeys?: readonly string[];
}): Promise<PreparedAgentResourceDeletion> {
  if (
    !isValidOpaqueId(input.accountId) ||
    !isValidOpaqueId(input.resourceId) ||
    (input.deletedByAccountId !== null &&
      !isValidOpaqueId(input.deletedByAccountId)) ||
    !AGENT_RESOURCE_KINDS.includes(input.resourceKind) ||
    new Date(input.deletedAt).toISOString() !== input.deletedAt
  ) {
    throw new TypeError("Invalid Agent resource deletion identity");
  }
  const vectorIds = canonicalTargetList(
    input.vectorIds,
    "vector id",
    MAX_VECTOR_ID_CHARACTERS,
  );
  const offloadObjectKeys = canonicalTargetList(
    input.offloadObjectKeys,
    "offload object key",
    MAX_OBJECT_KEY_CHARACTERS,
  );
  const identityJson = canonicalJson({
    accountId: input.accountId,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
  });
  const sourceJson = canonicalJson(input.source);
  return {
    id: `ardt_${await computeSHA256(identityJson)}`,
    accountId: input.accountId,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    sourceDigest: `sha256:${await computeSHA256(sourceJson)}`,
    deletedByAccountId: input.deletedByAccountId,
    deletedAt: input.deletedAt,
    vectorIdsJson: JSON.stringify(vectorIds),
    offloadObjectKeysJson: JSON.stringify(offloadObjectKeys),
  };
}

/**
 * Resolve a durable deletion identity after the source row has disappeared.
 *
 * Resource IDs are normally globally opaque, but the schema deliberately
 * scopes uniqueness to the owning account. Refuse an ambiguous cross-account
 * match instead of guessing which deletion authority the caller meant.
 */
export async function findAgentResourceTombstone(
  dbBinding: SqlDatabaseLike,
  resourceKind: AgentResourceKind,
  resourceId: string,
): Promise<AgentResourceTombstoneIdentity | null> {
  if (
    !AGENT_RESOURCE_KINDS.includes(resourceKind) ||
    !isValidOpaqueId(resourceId)
  ) {
    throw new TypeError("Invalid Agent resource tombstone identity");
  }
  const rows = await getDb(dbBinding).select({
    id: agentResourceTombstones.id,
    accountId: agentResourceTombstones.accountId,
    resourceKind: agentResourceTombstones.resourceKind,
    resourceId: agentResourceTombstones.resourceId,
  }).from(agentResourceTombstones).where(and(
    eq(agentResourceTombstones.resourceKind, resourceKind),
    eq(agentResourceTombstones.resourceId, resourceId),
  )).limit(2).all();
  if (rows.length !== 1) return null;
  return rows[0] as AgentResourceTombstoneIdentity;
}

function parseTargetList(
  json: string,
  label: string,
  maxCharacters: number,
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidDeletionTargetsError(`Malformed ${label} target JSON`);
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_TARGETS_PER_RESOURCE) {
    throw new InvalidDeletionTargetsError(`Invalid ${label} target list`);
  }
  const values: string[] = [];
  for (const target of parsed) {
    if (
      typeof target !== "string" || !target || target.trim() !== target ||
      target.length > maxCharacters
    ) {
      throw new InvalidDeletionTargetsError(`Invalid ${label} target`);
    }
    values.push(target);
  }
  const canonical = Array.from(new Set(values)).sort();
  if (
    canonical.length !== values.length ||
    canonical.some((target, index) => target !== values[index])
  ) {
    throw new InvalidDeletionTargetsError(
      `Non-canonical ${label} target list`,
    );
  }
  return canonical;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BATCH_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BATCH_LIMIT) {
    throw new TypeError(`Deletion outbox limit must be 1..${MAX_BATCH_LIMIT}`);
  }
  return value;
}

function dueCondition(now: string, staleBefore: string) {
  return or(
    eq(agentResourceDeletionOutbox.deliveryStatus, "pending"),
    and(
      eq(agentResourceDeletionOutbox.deliveryStatus, "retry_wait"),
      or(
        isNull(agentResourceDeletionOutbox.nextAttemptAt),
        lte(agentResourceDeletionOutbox.nextAttemptAt, now),
      ),
    ),
    and(
      eq(agentResourceDeletionOutbox.deliveryStatus, "processing"),
      lt(agentResourceDeletionOutbox.claimedAt, staleBefore),
    ),
  );
}

function retryAt(attempts: number, nowMs: number): string {
  const delayMs = Math.min(60 * 60 * 1000, 60_000 * 2 ** (attempts - 1));
  return new Date(nowMs + delayMs).toISOString();
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_CHARACTERS);
}

async function deleteExactTargets(
  env: Pick<Env, "VECTORIZE" | "TAKOS_OFFLOAD">,
  vectorIds: string[],
  offloadObjectKeys: string[],
): Promise<void> {
  if (vectorIds.length > 0) {
    if (!env.VECTORIZE) {
      throw new Error("Vector deletion binding is unavailable");
    }
    for (let index = 0; index < vectorIds.length; index += 100) {
      await env.VECTORIZE.deleteByIds(vectorIds.slice(index, index + 100));
    }
  }
  if (offloadObjectKeys.length > 0) {
    if (!env.TAKOS_OFFLOAD) {
      throw new Error("Offload deletion binding is unavailable");
    }
    await env.TAKOS_OFFLOAD.delete(offloadObjectKeys);
  }
}

/**
 * Drain exact, content-free cleanup targets after the SQL tombstone is durable.
 *
 * Provider deletion is idempotent. A provider success followed by a lost SQL
 * acknowledgement is therefore safe to retry; the outbox never authorizes a
 * provider listing, prefix deletion, or target inferred after the tombstone.
 */
export async function runAgentResourceDeletionOutboxBatch(
  env: Pick<Env, "DB" | "VECTORIZE" | "TAKOS_OFFLOAD">,
  options: { limit?: number; ids?: readonly string[] } = {},
): Promise<AgentResourceDeletionBatchSummary> {
  const limit = boundedLimit(options.limit);
  const ids = canonicalTargetList(
    options.ids,
    "outbox id",
    128,
  );
  if (ids.length > MAX_BATCH_LIMIT) {
    throw new TypeError(
      `Deletion outbox id filter must be at most ${MAX_BATCH_LIMIT}`,
    );
  }
  const db = getDb(env.DB);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const staleBefore = new Date(nowMs - CLAIM_STALE_MS).toISOString();
  const conditions = [dueCondition(now, staleBefore)];
  if (ids.length > 0) {
    conditions.push(inArray(agentResourceDeletionOutbox.id, ids));
  }
  const candidates = await db.select({
    id: agentResourceDeletionOutbox.id,
  }).from(agentResourceDeletionOutbox)
    .where(and(...conditions))
    .orderBy(
      agentResourceDeletionOutbox.updatedAt,
      agentResourceDeletionOutbox.id,
    )
    .limit(limit)
    .all();

  const summary: AgentResourceDeletionBatchSummary = {
    selected: candidates.length,
    claimed: 0,
    completed: 0,
    retrying: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    const claimToken = generateId();
    const claimed = await db.update(agentResourceDeletionOutbox).set({
      deliveryStatus: "processing",
      claimToken,
      claimedAt: now,
      nextAttemptAt: null,
      attempts: sql`${agentResourceDeletionOutbox.attempts} + 1`,
      updatedAt: now,
    }).where(and(
      eq(agentResourceDeletionOutbox.id, candidate.id),
      dueCondition(now, staleBefore),
    )).returning({
      id: agentResourceDeletionOutbox.id,
      accountId: agentResourceDeletionOutbox.accountId,
      resourceKind: agentResourceDeletionOutbox.resourceKind,
      resourceId: agentResourceDeletionOutbox.resourceId,
      vectorIds: agentResourceDeletionOutbox.vectorIds,
      offloadObjectKeys: agentResourceDeletionOutbox.offloadObjectKeys,
      attempts: agentResourceDeletionOutbox.attempts,
    }).get();
    if (!claimed) continue;
    summary.claimed++;

    try {
      if (!AGENT_RESOURCE_KINDS.includes(
        claimed.resourceKind as AgentResourceKind,
      )) {
        throw new InvalidDeletionTargetsError(
          "Invalid Agent resource kind in deletion outbox",
        );
      }
      const revocation = await cancelRunsReferencingAgentResource(
        env.DB,
        {
          id: claimed.id,
          accountId: claimed.accountId,
          resourceKind: claimed.resourceKind as AgentResourceKind,
          resourceId: claimed.resourceId,
        },
        env.TAKOS_OFFLOAD,
      );
      if (revocation.remaining) {
        throw new Error("Active RunContext revocation is still converging");
      }
      const vectorIds = parseTargetList(
        claimed.vectorIds,
        "vector id",
        MAX_VECTOR_ID_CHARACTERS,
      );
      const offloadObjectKeys = parseTargetList(
        claimed.offloadObjectKeys,
        "offload object key",
        MAX_OBJECT_KEY_CHARACTERS,
      );
      await deleteExactTargets(env, vectorIds, offloadObjectKeys);
      const completedAt = new Date().toISOString();
      const completed = await db.update(agentResourceDeletionOutbox).set({
        deliveryStatus: "done",
        claimToken: null,
        claimedAt: null,
        nextAttemptAt: null,
        completedAt,
        lastError: null,
        updatedAt: completedAt,
      }).where(and(
        eq(agentResourceDeletionOutbox.id, claimed.id),
        eq(agentResourceDeletionOutbox.deliveryStatus, "processing"),
        eq(agentResourceDeletionOutbox.claimToken, claimToken),
      )).returning({ id: agentResourceDeletionOutbox.id }).get();
      if (completed) summary.completed++;
    } catch (error) {
      const permanent = error instanceof InvalidDeletionTargetsError ||
        claimed.attempts >= MAX_ATTEMPTS;
      const updatedAt = new Date().toISOString();
      const released = await db.update(agentResourceDeletionOutbox).set({
        deliveryStatus: permanent ? "failed" : "retry_wait",
        claimToken: null,
        claimedAt: null,
        nextAttemptAt: permanent
          ? null
          : retryAt(claimed.attempts, Date.parse(updatedAt)),
        lastError: boundedError(error),
        updatedAt,
      }).where(and(
        eq(agentResourceDeletionOutbox.id, claimed.id),
        eq(agentResourceDeletionOutbox.deliveryStatus, "processing"),
        eq(agentResourceDeletionOutbox.claimToken, claimToken),
      )).returning({ id: agentResourceDeletionOutbox.id }).get();
      if (released) {
        if (permanent) summary.failed++;
        else summary.retrying++;
      }
    }
  }

  return summary;
}
