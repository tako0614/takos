import type {
  SqlDatabaseBinding,
  SqlResultBinding,
} from "../../../shared/types/bindings.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { stringifyCanonicalJson } from "../../../shared/utils/canonical-json.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import type { RunAuthorityAttestation } from "./run-authority.ts";

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BEGIN_NONCE_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const MAX_MODEL_TRANSPORT_ATTEMPTS = 64;

export type BeginRunModelCallInput = {
  runId: string;
  serviceId: string;
  leaseVersion: number;
  authority: RunAuthorityAttestation;
  requestDigest: string;
  transportAttempt: number;
  beginNonce: string;
};

export type BeginRunModelCallResult = {
  modelCallId: string;
  idempotent: boolean;
};

type StoredRunModelCall = {
  id: string;
  runId: string;
  contextRevision: number;
  contextDigest: string;
  runGrantDigest: string;
  requestDigest: string;
  transportAttempt: number;
  beginNonceDigest: string;
  serviceId: string;
  leaseVersion: number;
};

export class RunModelCallAlreadyBeganError extends Error {
  readonly code = "run_model_call_already_began" as const;

  constructor() {
    super("The same model request was already begun by another execution");
    this.name = "RunModelCallAlreadyBeganError";
  }
}

export class RunModelCallAuthorityChangedError extends Error {
  readonly code = "run_model_call_authority_changed" as const;

  constructor() {
    super("Run authority changed before the model request was recorded");
    this.name = "RunModelCallAuthorityChangedError";
  }
}

export class RunModelCallRecordInvalidError extends Error {
  readonly code = "run_model_call_record_invalid" as const;

  constructor() {
    super("Stored model-call authority record is inconsistent");
    this.name = "RunModelCallRecordInvalidError";
  }
}

export function isRunModelCallRequestDigest(
  value: unknown,
): value is string {
  return typeof value === "string" && SHA256_DIGEST_PATTERN.test(value);
}

export function isRunModelCallBeginNonce(value: unknown): value is string {
  return typeof value === "string" && BEGIN_NONCE_PATTERN.test(value);
}

export function isRunModelCallTransportAttempt(
  value: unknown,
): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 1 && value <= MAX_MODEL_TRANSPORT_ATTEMPTS;
}

function canonicalJson(value: unknown): string {
  const encoded = stringifyCanonicalJson(value);
  if (encoded === undefined) {
    throw new TypeError("Model-call identity is not JSON serializable");
  }
  return encoded;
}

async function modelCallId(
  input: Omit<BeginRunModelCallInput, "serviceId" | "leaseVersion" | "beginNonce">,
): Promise<string> {
  const digest = await computeSHA256(canonicalJson({
    runId: input.runId,
    contextRevision: input.authority.contextRevision,
    contextDigest: input.authority.contextDigest,
    runGrantDigest: input.authority.runGrantDigest,
    requestDigest: input.requestDigest,
    transportAttempt: input.transportAttempt,
  }));
  return `rmc_${digest}`;
}

function exactStoredCall(
  stored: StoredRunModelCall,
  expected: StoredRunModelCall,
): boolean {
  return Object.keys(expected).every((key) =>
    stored[key as keyof StoredRunModelCall] ===
      expected[key as keyof StoredRunModelCall]
  );
}

/**
 * Record one exact outbound provider request before the container sends it.
 *
 * The stable call id deliberately excludes lease identity and the ephemeral
 * begin nonce. An identical retry of the begin RPC under the same lease/nonce
 * is idempotent, while a replacement task cannot mint a new call for the same
 * request body and transport attempt. The INSERT ... SELECT repeats the active
 * lease, current pointer, immutable revision, and RunGrant predicates so the
 * earlier authority read cannot race this durable commit.
 */
export async function beginRunModelCallAtomically(
  db: SqlDatabaseBinding,
  input: BeginRunModelCallInput,
): Promise<BeginRunModelCallResult> {
  const id = await modelCallId(input);
  const beginNonceDigest =
    `sha256:${await computeSHA256(input.beginNonce)}`;
  const createdAt = new Date().toISOString();
  const inserted = await db.prepare(
    `INSERT INTO "run_model_calls" (
       "id", "run_id", "context_revision", "context_digest",
       "run_grant_digest", "request_digest", "transport_attempt",
       "begin_nonce_digest", "service_id", "lease_version", "created_at"
     )
     SELECT ?, r."id", ?, ?, ?, ?, ?, ?, ?, ?, ?
     FROM "runs" r
     JOIN "run_context_revisions" rc
       ON rc."run_id" = r."id" AND rc."revision" = ?
     JOIN "run_grants" rg ON rg."run_id" = r."id"
     WHERE r."id" = ?
       AND r."status" IN ('pending', 'queued', 'running')
       AND r."service_id" = ?
       AND r."lease_version" = ?
       AND r."current_context_revision" = ?
       AND rc."digest" = ?
       AND rc."run_grant_digest" = ?
       AND rg."digest" = ?
     ON CONFLICT DO NOTHING`,
  ).bind(
    id,
    input.authority.contextRevision,
    input.authority.contextDigest,
    input.authority.runGrantDigest,
    input.requestDigest,
    input.transportAttempt,
    beginNonceDigest,
    input.serviceId,
    input.leaseVersion,
    createdAt,
    input.authority.contextRevision,
    input.runId,
    input.serviceId,
    input.leaseVersion,
    input.authority.contextRevision,
    input.authority.contextDigest,
    input.authority.runGrantDigest,
    input.authority.runGrantDigest,
  ).run<Record<string, unknown>>();
  if (affectedRowCount(
    inserted as SqlResultBinding<Record<string, unknown>>,
  ) > 0) {
    return { modelCallId: id, idempotent: false };
  }

  const stored = await db.prepare(
    `SELECT
       "id", "run_id" AS "runId",
       "context_revision" AS "contextRevision",
       "context_digest" AS "contextDigest",
       "run_grant_digest" AS "runGrantDigest",
       "request_digest" AS "requestDigest",
       "transport_attempt" AS "transportAttempt",
       "begin_nonce_digest" AS "beginNonceDigest",
       "service_id" AS "serviceId", "lease_version" AS "leaseVersion"
     FROM "run_model_calls"
     WHERE "id" = ?
     LIMIT 1`,
  ).bind(id).first<StoredRunModelCall>();
  if (!stored) {
    const conflictingIdentity = await db.prepare(
      `SELECT "id"
       FROM "run_model_calls"
       WHERE "run_id" = ?
         AND "context_revision" = ?
         AND "request_digest" = ?
         AND "transport_attempt" = ?
       LIMIT 1`,
    ).bind(
      input.runId,
      input.authority.contextRevision,
      input.requestDigest,
      input.transportAttempt,
    ).first<{ id: string }>();
    if (conflictingIdentity) throw new RunModelCallRecordInvalidError();
    throw new RunModelCallAuthorityChangedError();
  }

  const expected: StoredRunModelCall = {
    id,
    runId: input.runId,
    contextRevision: input.authority.contextRevision,
    contextDigest: input.authority.contextDigest,
    runGrantDigest: input.authority.runGrantDigest,
    requestDigest: input.requestDigest,
    transportAttempt: input.transportAttempt,
    beginNonceDigest,
    serviceId: input.serviceId,
    leaseVersion: input.leaseVersion,
  };
  if (exactStoredCall(stored, expected)) {
    return { modelCallId: id, idempotent: true };
  }
  if (
    stored.runId === input.runId &&
    stored.contextRevision === input.authority.contextRevision &&
    stored.contextDigest === input.authority.contextDigest &&
    stored.runGrantDigest === input.authority.runGrantDigest &&
    stored.requestDigest === input.requestDigest &&
    stored.transportAttempt === input.transportAttempt
  ) {
    throw new RunModelCallAlreadyBeganError();
  }
  throw new RunModelCallRecordInvalidError();
}
