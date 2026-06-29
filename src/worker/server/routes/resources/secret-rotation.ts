import { eq } from "drizzle-orm";
import { type TtlMs, ttlMs } from "@takos/worker-platform-utils/ttl";
import { generateId } from "../../../shared/utils/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import {
  resources,
  secretRotationEvents,
  secretVersions,
} from "../../../infra/db/schema.ts";
import { toResourceCapability } from "../../../application/services/resources/capabilities.ts";
import {
  decryptResourceSecretValue,
  encryptResourceSecretValue,
} from "../../../application/services/resources/secret-crypto.ts";
import {
  deletePortableManagedResource,
  getPortableSecretValue,
} from "./portable-runtime.ts";
import type { requireDbBinding, ResourceRecord } from "./route-internals.ts";

export const SECRET_ROTATION_GRACE_PERIOD_MS: TtlMs = ttlMs(
  24 * 60 * 60 * 1000,
);

export function isSecretResource(resource: ResourceRecord): boolean {
  const capability = toResourceCapability(resource.type, resource.config);
  return capability === "secret";
}

function generateSecretTokenHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface SecretRotationState {
  previousValue: string | null;
  previousExpiresAt: string | null;
}

/**
 * Fetch the raw rotation-grace state for a resource. The public Resource API
 * type intentionally does not expose the previous secret material, so we
 * query the underlying row directly when needed.
 */
export async function getSecretRotationState(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resourceId: string,
  encryptionKey?: string | undefined,
): Promise<SecretRotationState> {
  const row = await getDb(dbBinding).select({
    previousSecretValue: resources.previousSecretValue,
    previousSecretExpiresAt: resources.previousSecretExpiresAt,
  }).from(resources).where(eq(resources.id, resourceId)).get();
  const stored = row?.previousSecretValue ?? null;
  // The grace-period previous value is stored encrypted at rest; decrypt for
  // callers that compare/return it (legacy plaintext passes through unchanged).
  const previousValue = stored
    ? await decryptResourceSecretValue(encryptionKey, resourceId, stored)
    : null;
  return {
    previousValue,
    previousExpiresAt: row?.previousSecretExpiresAt ?? null,
  };
}

/**
 * Lazy-clear the previous secret value if its grace period has elapsed.
 * Returns the post-clear state so callers can inspect or surface the value.
 */
async function clearExpiredPreviousSecret(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resourceId: string,
  state: SecretRotationState,
  now: Date = new Date(),
): Promise<SecretRotationState> {
  if (!state.previousExpiresAt) return state;
  const expiresAt = Date.parse(state.previousExpiresAt);
  if (Number.isNaN(expiresAt) || expiresAt > now.getTime()) return state;

  await getDb(dbBinding).update(resources)
    .set({
      previousSecretValue: null,
      previousSecretExpiresAt: null,
    })
    .where(eq(resources.id, resourceId))
    .run();
  return { previousValue: null, previousExpiresAt: null };
}

/**
 * Verify a presented secret value against both the current value and the
 * (still in-grace) previous value. Exposed so future authentication paths
 * can perform dual-value verification without re-reading the schema.
 */
export async function verifyResourceSecretValue(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resource: ResourceRecord,
  presented: string,
  encryptionKey?: string | undefined,
): Promise<boolean> {
  if (!presented) return false;
  const current = await readResourceSecretValue(
    dbBinding,
    resource,
    encryptionKey,
  );
  if (current && presented === current) return true;

  const initial = await getSecretRotationState(
    dbBinding,
    resource.id,
    encryptionKey,
  );
  const state = await clearExpiredPreviousSecret(
    dbBinding,
    resource.id,
    initial,
  );
  return state.previousValue !== null && presented === state.previousValue;
}

export async function readResourceSecretValue(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resource: ResourceRecord,
  encryptionKey?: string | undefined,
): Promise<string> {
  // Lazy-clear any expired previous secret value while we are touching this
  // row. This keeps the grace-period state from lingering past 24h even if
  // no rotate call comes through.
  const initial = await getSecretRotationState(dbBinding, resource.id);
  await clearExpiredPreviousSecret(dbBinding, resource.id, initial);

  const backendName = resource.backend_name;
  if (backendName && backendName !== "cloudflare") {
    return await getPortableSecretValue({
      id: resource.id,
      backend_name: backendName,
      backing_resource_id: resource.backing_resource_id,
      backing_resource_name: resource.backing_resource_name,
      ...(resource.config ? { config: resource.config } : {}),
    });
  }
  // Cloudflare backend: the secret value lives (encrypted) in backing_resource_id.
  return await decryptResourceSecretValue(
    encryptionKey,
    resource.id,
    resource.backing_resource_id ?? "",
  );
}

export interface SecretRotationResult {
  value: string;
  rotatedAt: string;
  previousValueExpiresAt: string;
  valueDigest: string;
  previousValueDigest?: string;
}

async function digestSecretValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function secretCloudPartition(resource: ResourceRecord): string {
  const backendName = resource.backend_name;
  if (
    backendName === "cloudflare" || backendName === "aws" ||
    backendName === "gcp" || backendName === "k8s" ||
    backendName === "selfhosted"
  ) {
    return backendName;
  }
  return "global";
}

export async function recordSecretRotationAudit(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resource: ResourceRecord,
  actorAccountId: string,
  result: SecretRotationResult,
): Promise<void> {
  const db = getDb(dbBinding);
  const currentVersionId = generateId();
  const previousVersionId = result.previousValueDigest ? generateId() : null;
  const cloudPartition = secretCloudPartition(resource);
  const metadata = JSON.stringify({
    backendName: resource.backend_name ?? "cloudflare",
    capability: resource.capability ?? null,
  });
  const rotationPolicy = JSON.stringify({
    gracePeriodMs: SECRET_ROTATION_GRACE_PERIOD_MS,
  });

  if (previousVersionId && result.previousValueDigest) {
    await db.insert(secretVersions).values({
      id: previousVersionId,
      resourceId: resource.id,
      name: resource.name,
      version: previousVersionId,
      status: "previous",
      valueDigest: result.previousValueDigest,
      cloudPartition,
      rotationPolicy,
      metadata,
      activatedAt: resource.updated_at ?? result.rotatedAt,
      expiresAt: result.previousValueExpiresAt,
      supersededByVersionId: currentVersionId,
      createdByAccountId: actorAccountId,
    }).run();
  }

  await db.insert(secretVersions).values({
    id: currentVersionId,
    resourceId: resource.id,
    name: resource.name,
    version: currentVersionId,
    status: "current",
    valueDigest: result.valueDigest,
    cloudPartition,
    rotationPolicy,
    metadata,
    activatedAt: result.rotatedAt,
    createdByAccountId: actorAccountId,
  }).run();

  await db.insert(secretRotationEvents).values({
    id: generateId(),
    resourceId: resource.id,
    secretVersionId: currentVersionId,
    eventType: "secret.rotation.executed",
    actorAccountId,
    reason: "manual",
    details: JSON.stringify({
      currentVersionId,
      previousVersionId,
      previousValueExpiresAt: result.previousValueExpiresAt,
      cloudPartition,
    }),
  }).run();
}

export async function rotateResourceSecretValue(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resource: ResourceRecord,
  encryptionKey?: string | undefined,
): Promise<SecretRotationResult> {
  const rotatedAt = new Date().toISOString();
  const previousValueExpiresAt = new Date(
    Date.parse(rotatedAt) + SECRET_ROTATION_GRACE_PERIOD_MS,
  ).toISOString();
  const newValue = generateSecretTokenHex();
  const backendName = resource.backend_name;

  // 24h grace period: capture the current value before mutating, then store
  // it as `previous_secret_value` with an expiry of `now + 24h`. Any read or
  // rotate operation after the expiry will lazy-clear these columns. Future
  // verification paths should use `verifyResourceSecretValue` to check both
  // the current and grace-period value.
  if (backendName && backendName !== "cloudflare") {
    // For portable backends we must capture the existing value BEFORE the
    // delete-and-regenerate cycle, otherwise the old material is lost.
    let oldValue = "";
    try {
      oldValue = await getPortableSecretValue({
        id: resource.id,
        backend_name: backendName,
        backing_resource_id: resource.backing_resource_id,
        backing_resource_name: resource.backing_resource_name,
        ...(resource.config ? { config: resource.config } : {}),
      });
    } catch (_err) {
      // If the previous value is unavailable for some reason (e.g. the
      // marker file was hand-deleted), proceed with rotation but skip the
      // grace-period record — we cannot retain a value we never had.
      oldValue = "";
    }

    // Delete + lazy-regenerate via the existing portable secret store path.
    await deletePortableManagedResource(
      {
        id: resource.id,
        backend_name: backendName,
        backing_resource_id: resource.backing_resource_id,
        backing_resource_name: resource.backing_resource_name,
        ...(resource.config ? { config: resource.config } : {}),
      },
      "secret",
    );
    const regenerated = await getPortableSecretValue({
      id: resource.id,
      backend_name: backendName,
      backing_resource_id: resource.backing_resource_id,
      backing_resource_name: resource.backing_resource_name,
      ...(resource.config ? { config: resource.config } : {}),
    });
    await getDb(dbBinding).update(resources)
      .set({
        updatedAt: rotatedAt,
        // Store the grace-period previous value encrypted at rest.
        previousSecretValue: oldValue
          ? await encryptResourceSecretValue(encryptionKey, resource.id, oldValue)
          : null,
        previousSecretExpiresAt: oldValue ? previousValueExpiresAt : null,
      })
      .where(eq(resources.id, resource.id))
      .run();
    return {
      value: regenerated,
      rotatedAt,
      previousValueExpiresAt,
      valueDigest: await digestSecretValue(regenerated),
      ...(oldValue
        ? { previousValueDigest: await digestSecretValue(oldValue) }
        : {}),
    };
  }

  // Platform backend: the secret value lives (encrypted) in backing_resource_id.
  const oldValue = await decryptResourceSecretValue(
    encryptionKey,
    resource.id,
    resource.backing_resource_id ?? "",
  );
  await getDb(dbBinding).update(resources)
    .set({
      backingResourceId: await encryptResourceSecretValue(
        encryptionKey,
        resource.id,
        newValue,
      ),
      updatedAt: rotatedAt,
      previousSecretValue: oldValue
        ? await encryptResourceSecretValue(encryptionKey, resource.id, oldValue)
        : null,
      previousSecretExpiresAt: oldValue ? previousValueExpiresAt : null,
    })
    .where(eq(resources.id, resource.id))
    .run();
  return {
    value: newValue,
    rotatedAt,
    previousValueExpiresAt,
    valueDigest: await digestSecretValue(newValue),
    ...(oldValue
      ? { previousValueDigest: await digestSecretValue(oldValue) }
      : {}),
  };
}
