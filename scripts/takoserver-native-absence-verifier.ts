#!/usr/bin/env bun

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

/**
 * The native residual endpoint is a Takoserver control-plane read.  This
 * script deliberately lives beside the Takoserver fetch tracer instead of in
 * the product Worker: it is an opt-in post-destroy evidence seam and does not
 * change the Takos product contract.
 */

export const NATIVE_ABSENCE_VERIFICATION_KIND =
  "takosumi.external-destroy-verification@v1" as const;

/**
 * The child process result is intentionally narrower than the retained
 * Takosumi verification envelope.  Takosumi hashes this result and adds its
 * own executable digest, duration, and result digest after host verification.
 */
export const NATIVE_ABSENCE_VERIFIER_INPUT_KIND =
  "takosumi.external-destroy-verifier-input@v1" as const;
export const NATIVE_ABSENCE_VERIFIER_RESULT_KIND =
  "takosumi.external-destroy-verifier-result@v1" as const;
export const NATIVE_ABSENCE_VERIFIER_ID =
  "takos/takoserver-native-absence@v1" as const;

export const NATIVE_RESOURCE_KEYS = [
  "module_worker",
  "worker_bundle",
  "worker_version",
  "worker_deployment",
  "worker_endpoint",
] as const;

/** Stable result check names.  Keep this order as part of the child result. */
export const NATIVE_ABSENCE_CHECK_NAMES = NATIVE_RESOURCE_KEYS;

export type NativeResourceKey = (typeof NATIVE_RESOURCE_KEYS)[number];

const PROJECTED_OUTPUT_KEYS = [
  "config_value",
  "endpoint_hostname",
  "endpoint_url",
  "project_nonce",
  "project_uid",
  "resource_identities",
] as const;
const IDENTITY_KEYS = [
  "form_api_version",
  "form_definition_version",
  "form_kind",
  "form_schema_digest",
  "generation",
  "hostname",
  "name",
  "ready",
  "revision",
  "space",
  "uid",
  "url",
] as const;
const RESIDUAL_REQUIRED_KEYS = [
  "checkedAt",
  "deploymentCount",
  "effectCount",
  "source",
  "status",
] as const;
const RESIDUAL_OPTIONAL_KEYS = ["evidenceRef", "reason"] as const;
const RESIDUAL_REASONS = [
  "closure_pending",
  "effect_unresolved",
  "deployment_active",
  "deployment_unmarked",
  "provider_unavailable",
  "provider_readback_failed",
  "provider_identity_missing",
  "legacy_unattested",
] as const;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
export const TAKOSERVER_API_ORIGIN_ENV = "TAKOSERVER_API_ORIGIN" as const;
export const TAKOSERVER_ORGANIZATION_ID_ENV =
  "TAKOSERVER_ORGANIZATION_ID" as const;
export const TAKOSERVER_EVIDENCE_API_TOKEN_ENV =
  "TAKOSERVER_EVIDENCE_API_TOKEN" as const;
const UID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/u;
const ORGANIZATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const VERIFIER_ID_PATTERN = /^[a-z0-9][a-z0-9._/@-]{0,127}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export type JsonRecord = Record<string, unknown>;

export type ProjectedResourceIdentity = {
  readonly name: string;
  readonly space: string;
  readonly uid: string;
  readonly generation?: string;
  readonly revision?: string;
  readonly ready?: boolean;
  readonly form_api_version?: string;
  readonly form_kind?: string;
  readonly form_definition_version?: string;
  readonly form_schema_digest?: string;
  readonly hostname?: string | null;
  readonly url?: string | null;
};

export type ProjectedResourceIdentities = Record<
  NativeResourceKey,
  ProjectedResourceIdentity
>;

export type NativeResidualStatus = "absent" | "present" | "indeterminate";
export type NativeResidualSource = "intrinsic" | "provider";

export type NativeResidualObservation = {
  readonly status: NativeResidualStatus;
  readonly source: NativeResidualSource;
  readonly effectCount: number;
  readonly deploymentCount: number;
  readonly checkedAt: string;
  readonly evidenceRef?: string;
  readonly reason?: (typeof RESIDUAL_REASONS)[number];
};

export type NativeAbsenceResponse = {
  readonly residual: NativeResidualObservation;
};

export type NativeAbsenceEvidenceResource = {
  readonly name: string;
  readonly status: "absent";
  readonly source: NativeResidualSource;
  readonly effectCount: number;
  readonly deploymentCount: number;
  readonly checkedAt: string;
  readonly evidenceRef?: string;
};

export type NativeAbsenceVerificationEvidence = {
  readonly kind: typeof NATIVE_ABSENCE_VERIFICATION_KIND;
  readonly status: "passed";
  readonly organizationId: string;
  readonly space: string;
  readonly resourceCount: 5;
  readonly checkedCount: 5;
  readonly resources: Record<NativeResourceKey, NativeAbsenceEvidenceResource>;
};

export type NativeAbsenceVerifierInput = {
  readonly kind: typeof NATIVE_ABSENCE_VERIFIER_INPUT_KIND;
  readonly verifierId: typeof NATIVE_ABSENCE_VERIFIER_ID;
  readonly scriptDigest: string;
  readonly context: {
    readonly capsuleId: string;
    readonly destroyPlanRunId: string;
    readonly destroyApplyRunId: string;
  };
  readonly publicOutputs: JsonRecord;
};

export type NativeAbsenceVerifierCheck = {
  readonly name: NativeResourceKey;
  readonly status: "passed";
};

export type NativeAbsenceVerifierResult = {
  readonly kind: typeof NATIVE_ABSENCE_VERIFIER_RESULT_KIND;
  readonly verifierId: typeof NATIVE_ABSENCE_VERIFIER_ID;
  readonly scriptDigest: string;
  readonly checks: readonly NativeAbsenceVerifierCheck[];
};

export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class NativeAbsenceVerifierError extends Error {
  readonly failures?: readonly NativeAbsenceFailure[];

  constructor(message: string, failures?: readonly NativeAbsenceFailure[]) {
    super(message);
    this.name = "NativeAbsenceVerifierError";
    this.failures = failures;
  }
}

class NativeHttpStatusError extends NativeAbsenceVerifierError {
  readonly status: number;

  constructor(status: number) {
    super("native residual endpoint returned a non-success status");
    this.name = "NativeHttpStatusError";
    this.status = status;
  }
}

export type NativeAbsenceFailure = {
  readonly key: NativeResourceKey;
  readonly code:
    | "request_failed"
    | "timeout"
    | "http_status"
    | "malformed_response"
    | "unexpected_status";
  readonly status?: number;
};

function ownKeys(value: object): string[] {
  return Object.keys(value).sort();
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, subject: string): JsonRecord {
  if (!isRecord(value)) {
    throw new NativeAbsenceVerifierError(`${subject} must be an object`);
  }
  return value;
}

function requireString(value: unknown, subject: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new NativeAbsenceVerifierError(`${subject} must be a non-empty string`);
  }
  return value;
}

function assertClosedKeys(
  value: JsonRecord,
  required: readonly string[],
  optional: readonly string[],
  subject: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in value)) {
      throw new NativeAbsenceVerifierError(`${subject} is missing ${key}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new NativeAbsenceVerifierError(`${subject} contains unexpected ${key}`);
    }
  }
}

function assertSpace(value: unknown, subject: string): string {
  const space = requireString(value, subject);
  if (
    space !== space.trim() ||
    Array.from(space).length > 255 ||
    /[\/\p{Cc}]/u.test(space)
  ) {
    throw new NativeAbsenceVerifierError(`${subject} is not a canonical SpaceID`);
  }
  return space;
}

function assertName(value: unknown, subject: string): string {
  const name = requireString(value, subject);
  if (!NAME_PATTERN.test(name)) {
    throw new NativeAbsenceVerifierError(`${subject} is not a canonical resource name`);
  }
  return name;
}

function assertUid(value: unknown, subject: string): string {
  const uid = requireString(value, subject);
  if (!UID_PATTERN.test(uid)) {
    throw new NativeAbsenceVerifierError(`${subject} is not a canonical resource UID`);
  }
  return uid;
}

function assertOrganization(value: unknown): string {
  const organizationId = requireString(value, "organizationId");
  if (!ORGANIZATION_PATTERN.test(organizationId)) {
    throw new NativeAbsenceVerifierError("organizationId is not a canonical path segment");
  }
  return organizationId;
}

function assertVerifierId(value: unknown, subject = "verifierId"): string {
  const verifierId = requireString(value, subject);
  if (!VERIFIER_ID_PATTERN.test(verifierId)) {
    throw new NativeAbsenceVerifierError(`${subject} is not a canonical verifier id`);
  }
  return verifierId;
}

function assertScriptDigest(value: unknown, subject = "scriptDigest"): string {
  const digest = requireString(value, subject);
  if (!DIGEST_PATTERN.test(digest)) {
    throw new NativeAbsenceVerifierError(`${subject} is not a canonical script digest`);
  }
  return digest;
}

function assertOpaqueId(value: unknown, subject: string): string {
  const id = requireString(value, subject);
  if (!OPAQUE_ID_PATTERN.test(id)) {
    throw new NativeAbsenceVerifierError(`${subject} is not a bounded identifier`);
  }
  return id;
}

function extractProjectedIdentities(value: unknown): unknown {
  const root = requireRecord(value, "projected OpenTofu output");
  const rootKeys = ownKeys(root);
  const identityOnlyKeys = ["resource_identities"];
  const fullOutputKeys = [...PROJECTED_OUTPUT_KEYS].sort();
  if (
    rootKeys.join(",") === identityOnlyKeys.join(",") ||
    rootKeys.join(",") === fullOutputKeys.join(",")
  ) {
    if (rootKeys.join(",") === fullOutputKeys.join(",")) {
      for (const key of PROJECTED_OUTPUT_KEYS) {
        const output = requireRecord(root[key], `tofu output ${key}`);
        assertClosedKeys(output, ["sensitive", "type", "value"], [], `tofu output ${key}`);
        if (output.sensitive !== false) {
          throw new NativeAbsenceVerifierError(`tofu output ${key} must not be sensitive`);
        }
        if (
          output.type === null ||
          output.type === undefined ||
          (typeof output.type === "string" && output.type.length === 0) ||
          (Array.isArray(output.type) && output.type.length === 0)
        ) {
          throw new NativeAbsenceVerifierError(`tofu output ${key} has an invalid type descriptor`);
        }
      }
    }
    return root.resource_identities;
  }
  if (rootKeys.join(",") === [...NATIVE_RESOURCE_KEYS].sort().join(",")) {
    return root;
  }
  throw new NativeAbsenceVerifierError(
    "projected OpenTofu output has unexpected top-level keys",
  );
}

function unwrapProjectedIdentityOutput(value: unknown): unknown {
  const candidate = requireRecord(value, "resource_identities");
  const keys = ownKeys(candidate);
  if (keys.join(",") !== "sensitive,type,value") return candidate;
  if (candidate.sensitive !== false) {
    throw new NativeAbsenceVerifierError(
      "resource_identities output must not be sensitive",
    );
  }
  if (
    candidate.type === null ||
    candidate.type === undefined ||
    (typeof candidate.type === "string" && candidate.type.length === 0) ||
    (Array.isArray(candidate.type) && candidate.type.length === 0)
  ) {
    throw new NativeAbsenceVerifierError(
      "resource_identities output has an invalid type descriptor",
    );
  }
  return candidate.value;
}

/**
 * Parse the exact five Resource identities projected by OpenTofu `output -json`.
 * Full Provider identity fields are accepted when present, but unknown fields
 * (including native IDs and provider handles) are rejected.
 */
export function parseProjectedResourceIdentities(
  value: unknown,
  expectedSpace?: string,
): ProjectedResourceIdentities {
  const identities = requireRecord(
    unwrapProjectedIdentityOutput(extractProjectedIdentities(value)),
    "resource_identities",
  );
  if (
    ownKeys(identities).join(",") !==
    [...NATIVE_RESOURCE_KEYS].sort().join(",")
  ) {
    throw new NativeAbsenceVerifierError(
      "resource_identities must contain exactly five Worker resources",
    );
  }
  const checkedSpace = expectedSpace === undefined ? undefined : assertSpace(expectedSpace, "space");
  const result = {} as ProjectedResourceIdentities;
  const seenUids = new Set<string>();
  for (const key of NATIVE_RESOURCE_KEYS) {
    const raw = requireRecord(identities[key], `${key} identity`);
    assertClosedKeys(raw, ["name", "space", "uid"], IDENTITY_KEYS.filter((name) => !["name", "space", "uid"].includes(name)), `${key} identity`);
    const name = assertName(raw.name, `${key}.name`);
    const space = assertSpace(raw.space, `${key}.space`);
    const uid = assertUid(raw.uid, `${key}.uid`);
    if (checkedSpace !== undefined && space !== checkedSpace) {
      throw new NativeAbsenceVerifierError(`${key} identity is in the wrong space`);
    }
    if (seenUids.has(uid)) {
      throw new NativeAbsenceVerifierError(
        "resource identities must have five unique canonical UIDs",
      );
    }
    seenUids.add(uid);
    for (const optionalKey of IDENTITY_KEYS) {
      if (!(optionalKey in raw) || ["name", "space", "uid"].includes(optionalKey)) continue;
      const optionalValue = raw[optionalKey];
      if (optionalKey === "ready") {
        if (typeof optionalValue !== "boolean") {
          throw new NativeAbsenceVerifierError(`${key}.${optionalKey} must be boolean`);
        }
      } else if (optionalKey === "hostname" || optionalKey === "url") {
        if (optionalValue !== null && typeof optionalValue !== "string") {
          throw new NativeAbsenceVerifierError(`${key}.${optionalKey} must be string or null`);
        }
      } else if (typeof optionalValue !== "string" || optionalValue.length === 0) {
        throw new NativeAbsenceVerifierError(`${key}.${optionalKey} must be a string`);
      }
    }
    result[key] = raw as ProjectedResourceIdentity;
  }
  return result;
}

function inferProjectedSpace(
  identities: ProjectedResourceIdentities,
): string {
  const spaces = new Set(NATIVE_RESOURCE_KEYS.map((key) => identities[key].space));
  if (spaces.size !== 1) {
    throw new NativeAbsenceVerifierError(
      "resource identities must all belong to one canonical SpaceID",
    );
  }
  return [...spaces][0] as string;
}

/**
 * Parse the one closed document accepted from the Takosumi host adapter.
 * Takoserver connection details and credentials are deliberately absent from
 * this document; they come only from the explicitly allowlisted child env.
 */
export function parseNativeAbsenceVerifierInput(
  value: unknown,
): NativeAbsenceVerifierInput {
  const input = requireRecord(value, "verifier input");
  assertClosedKeys(
    input,
    ["context", "kind", "publicOutputs", "scriptDigest", "verifierId"],
    [],
    "verifier input",
  );
  if (input.kind !== NATIVE_ABSENCE_VERIFIER_INPUT_KIND) {
    throw new NativeAbsenceVerifierError("verifier input kind is invalid");
  }
  const verifierId = assertVerifierId(input.verifierId, "verifier input verifierId");
  if (verifierId !== NATIVE_ABSENCE_VERIFIER_ID) {
    throw new NativeAbsenceVerifierError("verifier input verifierId is not owned by this verifier");
  }
  const scriptDigest = assertScriptDigest(input.scriptDigest, "verifier input scriptDigest");
  const context = requireRecord(input.context, "verifier input context");
  assertClosedKeys(
    context,
    ["capsuleId", "destroyApplyRunId", "destroyPlanRunId"],
    [],
    "verifier input context",
  );
  const capsuleId = assertOpaqueId(context.capsuleId, "verifier input context.capsuleId");
  const destroyPlanRunId = assertOpaqueId(
    context.destroyPlanRunId,
    "verifier input context.destroyPlanRunId",
  );
  const destroyApplyRunId = assertOpaqueId(
    context.destroyApplyRunId,
    "verifier input context.destroyApplyRunId",
  );
  const publicOutputs = requireRecord(input.publicOutputs, "verifier input publicOutputs");
  // Parse now so malformed/extra identity data fails before a network call.
  parseProjectedResourceIdentities(publicOutputs);
  return {
    kind: NATIVE_ABSENCE_VERIFIER_INPUT_KIND,
    verifierId: NATIVE_ABSENCE_VERIFIER_ID,
    scriptDigest,
    context: { capsuleId, destroyPlanRunId, destroyApplyRunId },
    publicOutputs,
  };
}

function assertCanonicalDateTime(value: unknown): string {
  const checked = requireString(value, "residual.checkedAt");
  if (!DATE_TIME_PATTERN.test(checked) || !Number.isFinite(Date.parse(checked))) {
    throw new NativeAbsenceVerifierError("residual.checkedAt is not canonical");
  }
  return checked;
}

function assertCount(value: unknown, subject: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) {
    throw new NativeAbsenceVerifierError(`${subject} must be a bounded non-negative integer`);
  }
  return value as number;
}

function parseResidualResponse(value: unknown): NativeResidualObservation {
  const envelope = requireRecord(value, "native residual response");
  assertClosedKeys(envelope, ["residual"], [], "native residual response");
  const residual = requireRecord(envelope.residual, "native residual response residual");
  assertClosedKeys(residual, [...RESIDUAL_REQUIRED_KEYS], [...RESIDUAL_OPTIONAL_KEYS], "native residual response residual");
  const status = residual.status;
  if (status !== "absent" && status !== "present" && status !== "indeterminate") {
    throw new NativeAbsenceVerifierError("native residual response status is invalid");
  }
  const source = residual.source;
  if (source !== "intrinsic" && source !== "provider") {
    throw new NativeAbsenceVerifierError("native residual response source is invalid");
  }
  const effectCount = assertCount(residual.effectCount, "residual.effectCount");
  const deploymentCount = assertCount(residual.deploymentCount, "residual.deploymentCount");
  const checkedAt = assertCanonicalDateTime(residual.checkedAt);
  let evidenceRef: string | undefined;
  if ("evidenceRef" in residual) {
    evidenceRef = requireString(residual.evidenceRef, "residual.evidenceRef");
    if (!DIGEST_PATTERN.test(evidenceRef)) {
      throw new NativeAbsenceVerifierError("residual.evidenceRef is not a bounded digest");
    }
  }
  let reason: NativeResidualObservation["reason"];
  if ("reason" in residual) {
    if (!RESIDUAL_REASONS.includes(residual.reason as (typeof RESIDUAL_REASONS)[number])) {
      throw new NativeAbsenceVerifierError("native residual response reason is invalid");
    }
    reason = residual.reason as NativeResidualObservation["reason"];
  }
  return {
    status,
    source,
    effectCount,
    deploymentCount,
    checkedAt,
    ...(evidenceRef === undefined ? {} : { evidenceRef }),
    ...(reason === undefined ? {} : { reason }),
  };
}

/** Validate the closed response and require the exact successful `absent` state. */
export function parseNativeResidualResponse(
  value: unknown,
  options: { readonly requireAbsent?: boolean } = {},
): NativeAbsenceObservation {
  const parsed = parseResidualResponse(value);
  if (options.requireAbsent !== false && parsed.status !== "absent") {
    throw new NativeAbsenceVerifierError(
      "native residual response must carry the exact absent status",
    );
  }
  return parsed;
}

export type NativeAbsenceObservation = NativeResidualObservation;

export function buildNativeResidualURL(input: {
  readonly host: string;
  readonly organizationId: string;
  readonly resourceUid: string;
  readonly space: string;
  readonly name: string;
}): URL {
  let host: URL;
  try {
    host = new URL(input.host);
  } catch {
    throw new NativeAbsenceVerifierError("host must be an absolute origin");
  }
  if (
    host.username ||
    host.password ||
    host.pathname !== "/" ||
    host.search ||
    host.hash ||
    host.protocol !== "https:"
  ) {
    throw new NativeAbsenceVerifierError("host must be a bare HTTPS origin");
  }
  const organizationId = assertOrganization(input.organizationId);
  const resourceUid = assertUid(input.resourceUid, "resourceUid");
  const space = assertSpace(input.space, "space");
  const name = assertName(input.name, "name");
  const url = new URL(host.origin);
  url.pathname = `/v1/organizations/${encodeURIComponent(organizationId)}/resources/${encodeURIComponent(resourceUid)}/native-residual`;
  url.search = new URLSearchParams({ space, name }).toString();
  return url;
}

function parseStrictJson(value: string, subject: string): unknown {
  if (value.length === 0 || new TextEncoder().encode(value).byteLength > MAX_RESPONSE_BYTES) {
    throw new NativeAbsenceVerifierError(`${subject} exceeded its bounded size`);
  }
  let offset = 0;
  const skipWhitespace = (): void => {
    while (offset < value.length && /[\t\n\r ]/u.test(value[offset] ?? "")) offset += 1;
  };
  const parseString = (): string => {
    if (value[offset] !== '"') throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
    const start = offset;
    offset += 1;
    while (offset < value.length) {
      const char = value[offset];
      if (char === "\\") {
        offset += 2;
        continue;
      }
      if (char === '"') {
        offset += 1;
        try {
          return JSON.parse(value.slice(start, offset)) as string;
        } catch {
          throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
        }
      }
      if (char < " ") throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
      offset += 1;
    }
    throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
  };
  const parseValue = (depth: number): void => {
    if (depth > 32) throw new NativeAbsenceVerifierError(`${subject} is too deeply nested`);
    skipWhitespace();
    const char = value[offset];
    if (char === "{") {
      offset += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (value[offset] === "}") {
        offset += 1;
        return;
      }
      while (offset < value.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw new NativeAbsenceVerifierError(`${subject} has duplicate JSON members`);
        keys.add(key);
        skipWhitespace();
        if (value[offset] !== ":") throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
        offset += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (value[offset] === "}") {
          offset += 1;
          return;
        }
        if (value[offset] !== ",") throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
        offset += 1;
      }
      throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
    }
    if (char === "[") {
      offset += 1;
      skipWhitespace();
      if (value[offset] === "]") {
        offset += 1;
        return;
      }
      while (offset < value.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (value[offset] === "]") {
          offset += 1;
          return;
        }
        if (value[offset] !== ",") throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
        offset += 1;
      }
      throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
    }
    if (char === '"') {
      parseString();
      return;
    }
    const start = offset;
    while (offset < value.length && !/[\t\n\r ,\]}]/u.test(value[offset] ?? "")) offset += 1;
    if (start === offset) throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
  };
  try {
    parseValue(0);
    skipWhitespace();
    if (offset !== value.length) throw new Error("trailing data");
    return JSON.parse(value) as unknown;
  } catch (error) {
    if (error instanceof NativeAbsenceVerifierError) throw error;
    throw new NativeAbsenceVerifierError(`${subject} is malformed JSON`);
  }
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new NativeAbsenceVerifierError("response body exceeded its deadline"));
    } else {
      signal.addEventListener(
        "abort",
        () => reject(new NativeAbsenceVerifierError("response body exceeded its deadline")),
        { once: true },
      );
    }
  });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), abortPromise]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new NativeAbsenceVerifierError("response body exceeded its bounded size");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return decoder.decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  } catch {
    throw new NativeAbsenceVerifierError("response body was not valid UTF-8");
  }
}

async function readResponse(
  input: {
    readonly url: URL;
    readonly token: string;
    readonly timeoutMs: number;
    readonly fetchImpl: FetchFunction;
  },
): Promise<NativeResidualObservation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  let settled = false;
  const fetchPromise = Promise.resolve().then(() =>
    input.fetchImpl(input.url, {
      method: "GET",
      redirect: "manual",
      headers: {
        authorization: `Bearer ${input.token}`,
        accept: "application/json",
      },
      signal: controller.signal,
    }),
  );
  void fetchPromise.then((response) => {
    if (controller.signal.aborted && !settled) void response.body?.cancel();
  }, () => undefined);
  try {
    const timeout = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new NativeAbsenceVerifierError("native residual request timed out")),
        { once: true },
      );
    });
    const response = await Promise.race([fetchPromise, timeout]);
    if (response.status !== 200) {
      throw new NativeHttpStatusError(response.status);
    }
    const body = await readBoundedBody(response, controller.signal);
    if (controller.signal.aborted) {
      throw new NativeAbsenceVerifierError("native residual request timed out");
    }
    const parsed = parseStrictJson(body, "native residual response");
    return parseNativeResidualResponse(parsed, { requireAbsent: false });
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}

function failureCode(error: unknown): NativeAbsenceFailure["code"] {
  if (error instanceof NativeAbsenceVerifierError) {
    if (error.message.includes("timed out") || error.message.includes("deadline")) return "timeout";
    if (error.message.includes("non-success status")) return "http_status";
    if (error.message.includes("status")) return "unexpected_status";
    if (error.message.includes("response")) return "malformed_response";
  }
  return "request_failed";
}

function failureStatus(error: unknown): number | undefined {
  return error instanceof NativeHttpStatusError ? error.status : undefined;
}

function assertToken(token: unknown): string {
  if (typeof token !== "string" || token.length === 0 || /[\r\n]/u.test(token)) {
    throw new NativeAbsenceVerifierError("evidence token is required through the environment");
  }
  return token;
}

/**
 * Verify every projected Resource UID against Takoserver's read-only native
 * residual endpoint.  A failure in one check never suppresses the other four.
 */
export async function verifyNativeAbsence(input: {
  readonly host: string;
  readonly organizationId: string;
  readonly space?: string;
  readonly projectedOutput: unknown;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchFunction;
}): Promise<NativeAbsenceVerificationEvidence> {
  const identities = parseProjectedResourceIdentities(input.projectedOutput, input.space);
  const token = assertToken(input.token);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86_400_000) {
    throw new NativeAbsenceVerifierError("timeoutMs is outside the supported range");
  }
  const organizationId = assertOrganization(input.organizationId);
  const space = input.space === undefined
    ? inferProjectedSpace(identities)
    : assertSpace(input.space, "space");
  const fetchImpl = input.fetchImpl ?? fetch;
  const resources = {} as Record<NativeResourceKey, NativeAbsenceEvidenceResource>;
  const failures: NativeAbsenceFailure[] = [];
  for (const key of NATIVE_RESOURCE_KEYS) {
    const identity = identities[key];
    try {
      const url = buildNativeResidualURL({
        host: input.host,
        organizationId,
        resourceUid: identity.uid,
        space,
        name: identity.name,
      });
      const observed = await readResponse({ url, token, timeoutMs, fetchImpl });
      if (observed.status !== "absent") {
        failures.push({ key, code: "unexpected_status" });
        continue;
      }
      resources[key] = {
        name: identity.name,
        status: "absent",
        source: observed.source,
        effectCount: observed.effectCount,
        deploymentCount: observed.deploymentCount,
        checkedAt: observed.checkedAt,
        ...(observed.evidenceRef === undefined ? {} : { evidenceRef: observed.evidenceRef }),
      };
    } catch (error) {
      failures.push({ key, code: failureCode(error), ...(failureStatus(error) === undefined ? {} : { status: failureStatus(error) }) });
    }
  }
  if (failures.length > 0) {
    throw new NativeAbsenceVerifierError(
      `native absence verification failed for ${failures.length} of five resource checks`,
      failures,
    );
  }
  const evidence: NativeAbsenceVerificationEvidence = {
    kind: NATIVE_ABSENCE_VERIFICATION_KIND,
    status: "passed",
    organizationId,
    space,
    resourceCount: 5,
    checkedCount: 5,
    resources,
  };
  serializeNativeAbsenceEvidence(evidence);
  return evidence;
}

function assertSafeEvidenceValue(value: unknown, depth = 0): void {
  if (depth > 8) throw new NativeAbsenceVerifierError("evidence is too deeply nested");
  if (typeof value === "string") {
    if (/\p{Cc}/u.test(value) || /Bearer\s+/iu.test(value) || /native(?:id|handle)/iu.test(value)) {
      throw new NativeAbsenceVerifierError("evidence contains a forbidden secret or native handle");
    }
    return;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeEvidenceValue(entry, depth + 1);
    return;
  }
  if (!isRecord(value)) throw new NativeAbsenceVerifierError("evidence is not JSON data");
  for (const [key, child] of Object.entries(value)) {
    if (/(?:token|password|secret|private|native(?:id|handle)|provider(?:installation|handle)|raw(?:error|body)|operation(?:id|handle))/iu.test(key)) {
      throw new NativeAbsenceVerifierError("evidence contains a forbidden field");
    }
    assertSafeEvidenceValue(child, depth + 1);
  }
}

function assertEvidenceShape(
  evidence: NativeAbsenceVerificationEvidence,
): void {
  const envelope = requireRecord(evidence, "evidence");
  assertClosedKeys(
    envelope,
    ["checkedCount", "kind", "organizationId", "resourceCount", "resources", "space", "status"],
    [],
    "evidence",
  );
  if (envelope.kind !== NATIVE_ABSENCE_VERIFICATION_KIND || envelope.status !== "passed") {
    throw new NativeAbsenceVerifierError("evidence kind or status is invalid");
  }
  if (envelope.resourceCount !== 5 || envelope.checkedCount !== 5) {
    throw new NativeAbsenceVerifierError("evidence must cover exactly five resources");
  }
  assertOrganization(envelope.organizationId);
  assertSpace(envelope.space, "evidence.space");
  const resources = requireRecord(envelope.resources, "evidence.resources");
  if (ownKeys(resources).join(",") !== [...NATIVE_RESOURCE_KEYS].sort().join(",")) {
    throw new NativeAbsenceVerifierError("evidence must contain exactly five resources");
  }
  for (const key of NATIVE_RESOURCE_KEYS) {
    const resource = requireRecord(resources[key], `evidence.resources.${key}`);
    assertClosedKeys(
      resource,
      ["checkedAt", "deploymentCount", "effectCount", "name", "source", "status"],
      ["evidenceRef"],
      `evidence.resources.${key}`,
    );
    if (resource.status !== "absent") {
      throw new NativeAbsenceVerifierError(`evidence.resources.${key} is not absent`);
    }
    assertName(resource.name, `evidence.resources.${key}.name`);
    if (resource.source !== "intrinsic" && resource.source !== "provider") {
      throw new NativeAbsenceVerifierError(`evidence.resources.${key}.source is invalid`);
    }
    assertCount(resource.effectCount, `evidence.resources.${key}.effectCount`);
    assertCount(resource.deploymentCount, `evidence.resources.${key}.deploymentCount`);
    assertCanonicalDateTime(resource.checkedAt);
    if ("evidenceRef" in resource) {
      const evidenceRef = requireString(resource.evidenceRef, `evidence.resources.${key}.evidenceRef`);
      if (!DIGEST_PATTERN.test(evidenceRef)) {
        throw new NativeAbsenceVerifierError(`evidence.resources.${key}.evidenceRef is invalid`);
      }
    }
  }
}

/** Serialize and re-validate the bounded evidence envelope. */
export function serializeNativeAbsenceEvidence(
  evidence: NativeAbsenceVerificationEvidence,
): string {
  assertSafeEvidenceValue(evidence);
  assertEvidenceShape(evidence);
  const serialized = JSON.stringify(evidence);
  if (typeof serialized !== "string" || serialized.length > MAX_EVIDENCE_BYTES) {
    throw new NativeAbsenceVerifierError("evidence exceeded its bounded size");
  }
  return serialized;
}

function assertVerifierResultShape(value: unknown): NativeAbsenceVerifierResult {
  const result = requireRecord(value, "verifier result");
  assertClosedKeys(
    result,
    ["checks", "kind", "scriptDigest", "verifierId"],
    [],
    "verifier result",
  );
  if (result.kind !== NATIVE_ABSENCE_VERIFIER_RESULT_KIND) {
    throw new NativeAbsenceVerifierError("verifier result kind is invalid");
  }
  const verifierId = assertVerifierId(result.verifierId, "verifier result verifierId");
  if (verifierId !== NATIVE_ABSENCE_VERIFIER_ID) {
    throw new NativeAbsenceVerifierError("verifier result verifierId is invalid");
  }
  const scriptDigest = assertScriptDigest(result.scriptDigest, "verifier result scriptDigest");
  if (!Array.isArray(result.checks) || result.checks.length !== NATIVE_RESOURCE_KEYS.length) {
    throw new NativeAbsenceVerifierError("verifier result must contain exactly five checks");
  }
  result.checks.forEach((check, index) => {
    const checked = requireRecord(check, `verifier result checks[${index}]`);
    assertClosedKeys(
      checked,
      ["name", "status"],
      [],
      `verifier result checks[${index}]`,
    );
    if (checked.name !== NATIVE_RESOURCE_KEYS[index] || checked.status !== "passed") {
      throw new NativeAbsenceVerifierError("verifier result checks are not in the required order");
    }
  });
  return {
    kind: NATIVE_ABSENCE_VERIFIER_RESULT_KIND,
    verifierId: NATIVE_ABSENCE_VERIFIER_ID,
    scriptDigest,
    checks: result.checks as NativeAbsenceVerifierCheck[],
  };
}

/** Build the intentionally closed child result after all five checks pass. */
export function buildNativeAbsenceVerifierResult(
  scriptDigest: string,
): NativeAbsenceVerifierResult {
  const result: NativeAbsenceVerifierResult = {
    kind: NATIVE_ABSENCE_VERIFIER_RESULT_KIND,
    verifierId: NATIVE_ABSENCE_VERIFIER_ID,
    scriptDigest: assertScriptDigest(scriptDigest),
    checks: NATIVE_RESOURCE_KEYS.map((name) => ({ name, status: "passed" as const })),
  };
  assertVerifierResultShape(result);
  return result;
}

/** Serialize only the closed child result; host retention adds the v1 evidence envelope. */
export function serializeNativeAbsenceVerifierResult(
  result: NativeAbsenceVerifierResult,
): string {
  const checked = assertVerifierResultShape(result);
  assertSafeEvidenceValue(checked);
  const serialized = JSON.stringify(checked);
  if (typeof serialized !== "string" || serialized.length > 8 * 1024) {
    throw new NativeAbsenceVerifierError("verifier result exceeded its bounded size");
  }
  return serialized;
}

export type NativeAbsenceVerifierConfig = {
  readonly host: string;
  readonly organizationId: string;
  readonly inputFile: string;
  readonly timeoutMs: number;
};

export function parseVerifierArgs(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): NativeAbsenceVerifierConfig {
  let inputFile: string | undefined;
  const expanded: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const index = arg.indexOf("=");
      expanded.push(arg.slice(0, index), arg.slice(index + 1));
    } else expanded.push(arg);
  }
  const read = (index: number, flag: string): [string, number] => {
    const next = expanded[index + 1];
    if (!next || next.startsWith("--")) throw new NativeAbsenceVerifierError(`${flag} requires a value`);
    return [next, index + 1];
  };
  for (let index = 0; index < expanded.length; index += 1) {
    const arg = expanded[index];
    if (arg === "--help" || arg === "-h") {
      throw new NativeAbsenceVerifierError(usage());
    } else if (arg === "--input-file") {
      const [next, nextIndex] = read(index, arg);
      if (inputFile !== undefined) {
        throw new NativeAbsenceVerifierError("input-file may only be supplied once");
      }
      inputFile = next;
      index = nextIndex;
    } else {
      throw new NativeAbsenceVerifierError("unknown option");
    }
  }
  if (inputFile === undefined) {
    throw new NativeAbsenceVerifierError("--input-file is required");
  }
  const host = environment[TAKOSERVER_API_ORIGIN_ENV];
  const organizationId = environment[TAKOSERVER_ORGANIZATION_ID_ENV];
  const token = environment[TAKOSERVER_EVIDENCE_API_TOKEN_ENV];
  if (!host || !organizationId || !token) {
    throw new NativeAbsenceVerifierError("required Takoserver verifier environment is incomplete");
  }
  // Validate scope before reading a potentially large input document while
  // never putting the credential itself in a returned config or error.
  let checkedHost: URL;
  try {
    checkedHost = new URL(host);
  } catch {
    throw new NativeAbsenceVerifierError("TAKOSERVER_API_ORIGIN must be a bare HTTPS origin");
  }
  if (
    checkedHost.username ||
    checkedHost.password ||
    checkedHost.pathname !== "/" ||
    checkedHost.search ||
    checkedHost.hash ||
    checkedHost.protocol !== "https:"
  ) {
    throw new NativeAbsenceVerifierError("TAKOSERVER_API_ORIGIN must be a bare HTTPS origin");
  }
  const checkedOrganization = assertOrganization(organizationId);
  if (!inputFile || inputFile === "-" || inputFile.includes("\0")) {
    throw new NativeAbsenceVerifierError("input-file is invalid");
  }
  return { host: checkedHost.origin, organizationId: checkedOrganization, inputFile, timeoutMs: DEFAULT_TIMEOUT_MS };
}

export function usage(): string {
  return [
    "usage: bun scripts/takoserver-native-absence-verifier.ts --input-file INPUT_PATH",
    "",
    `This is an opt-in, read-only post-destroy check. Scope and credentials come from ${TAKOSERVER_API_ORIGIN_ENV}, ${TAKOSERVER_ORGANIZATION_ID_ENV}, and ${TAKOSERVER_EVIDENCE_API_TOKEN_ENV}; credentials never enter argv or output.`,
  ].join("\n");
}

async function readVerifierInput(path: string): Promise<NativeAbsenceVerifierInput> {
  const input = path === "-"
    ? await Bun.stdin.text()
    : await readFile(path, "utf8");
  if (new TextEncoder().encode(input).byteLength > MAX_INPUT_BYTES) {
    throw new NativeAbsenceVerifierError("verifier input exceeded its bounded size");
  }
  return parseNativeAbsenceVerifierInput(parseStrictJson(input, "verifier input"));
}

async function main(): Promise<void> {
  let config: NativeAbsenceVerifierConfig | undefined;
  try {
    config = parseVerifierArgs(process.argv.slice(2));
    const token = process.env[TAKOSERVER_EVIDENCE_API_TOKEN_ENV];
    if (!token) throw new NativeAbsenceVerifierError("evidence token is empty");
    const verifierInput = await readVerifierInput(config.inputFile);
    await verifyNativeAbsence({
      host: config.host,
      organizationId: config.organizationId,
      projectedOutput: verifierInput.publicOutputs,
      token,
      timeoutMs: config.timeoutMs,
    });
    // The detailed residual observations remain process-local.  stdout is the
    // closed child result consumed by the host adapter.
    process.stdout.write(
      `${serializeNativeAbsenceVerifierResult(
        buildNativeAbsenceVerifierResult(verifierInput.scriptDigest),
      )}\n`,
    );
  } catch (error) {
    const message = error instanceof NativeAbsenceVerifierError
      ? error.message
      : "native absence verification failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
