// Server-side verifier for the agent's `takos-internal-v3` signed RPC envelope.
//
// This mirrors, byte-for-byte, the canonical message and HMAC scheme produced
// by the Rust agent in `takos/containers/agent/src/internal_rpc.rs` (`sign_internal_rpc`).
// The agent attaches this envelope to outbound agent-control RPC calls when the
// operator provisions `TAKOS_AGENT_INTERNAL_RPC_KEY`; the receiver here MUST run
// `verifyAgentInternalRpcFromHeaders` over the request before trusting it.
//
// IMPORTANT: the canonical message must stay identical to the Rust side or all
// signed RPC breaks. The Rust canonical (see `canonical_internal_rpc`) joins the
// following lines with "\n":
//   1. version  ("takos-internal-v3")
//   2. method   (uppercased)
//   3. path + optional query
//   4. timestamp
//   5. requestId
//   6. nonce
//   7. caller
//   8. audience
//   9. capabilities (trimmed, de-duped, sorted ascending, joined by ",")
//  10. bodyDigest (lowercase hex sha256 of the exact wire body bytes)
//  11. actorContextHeader (base64 of the actor-context JSON, used verbatim)

const textEncoder = new TextEncoder();

export const TAKOS_INTERNAL_RPC_VERSION = "takos-internal-v3";

export const TAKOS_INTERNAL_VERSION_HEADER = "x-takos-internal-version";
export const TAKOS_INTERNAL_SIGNATURE_HEADER = "x-takos-internal-signature";
export const TAKOS_INTERNAL_TIMESTAMP_HEADER = "x-takos-internal-timestamp";
export const TAKOS_INTERNAL_REQUEST_ID_HEADER = "x-takos-request-id";
export const TAKOS_INTERNAL_ACTOR_HEADER = "x-takos-actor-context";
export const TAKOS_INTERNAL_BODY_DIGEST_HEADER = "x-takos-body-digest";
export const TAKOS_INTERNAL_NONCE_HEADER = "x-takos-nonce";
export const TAKOS_INTERNAL_CALLER_HEADER = "x-takos-caller";
export const TAKOS_INTERNAL_AUDIENCE_HEADER = "x-takos-audience";
export const TAKOS_INTERNAL_CAPABILITIES_HEADER = "x-takos-capabilities";

// Matches the Rust default `max_clock_skew_ms` (5 minutes).
export const TAKOS_INTERNAL_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export interface TakosAgentActorContext {
  readonly actorAccountId: string;
  readonly spaceId?: string;
  readonly roles: readonly string[];
  readonly requestId: string;
  readonly principalKind?: string;
  readonly serviceId?: string;
  readonly agentId?: string;
}

export interface AgentInternalRpcVerificationInput {
  readonly method: string;
  readonly path: string;
  readonly query?: string;
  readonly body: string | Uint8Array;
  readonly secret: string;
  readonly headers: Headers | Record<string, string>;
  readonly now?: () => Date;
  readonly maxClockSkewMs?: number;
  readonly expectedCaller?: string | readonly string[];
  readonly expectedAudience?: string;
  readonly requiredCapabilities?: readonly string[];
}

export interface VerifiedAgentInternalRpc {
  readonly actor: TakosAgentActorContext;
  readonly caller: string;
  readonly audience: string;
  readonly capabilities: readonly string[];
  readonly requestId: string;
  readonly nonce: string;
  readonly timestamp: string;
}

interface CanonicalAgentInternalRpcInput {
  readonly method: string;
  readonly path: string;
  readonly query?: string;
  readonly bodyDigest: string;
  readonly actorContextHeader: string;
  readonly caller: string;
  readonly audience: string;
  readonly capabilities: readonly string[];
  readonly requestId: string;
  readonly nonce: string;
  readonly timestamp: string;
}

export function canonicalAgentInternalRequest(
  input: CanonicalAgentInternalRpcInput,
): string {
  return [
    TAKOS_INTERNAL_RPC_VERSION,
    input.method.toUpperCase(),
    pathWithQuery(input.path, input.query),
    input.timestamp,
    input.requestId,
    input.nonce,
    input.caller,
    input.audience,
    normalizeCapabilities(input.capabilities).join(","),
    input.bodyDigest,
    input.actorContextHeader,
  ].join("\n");
}

/**
 * Returns true when a signed agent envelope is present on the request, even if
 * it is invalid. Used to distinguish "no envelope" from "bad envelope" when the
 * server-side key is configured.
 */
export function hasAgentInternalRpcEnvelope(
  headers: Headers | Record<string, string>,
): boolean {
  return readHeader(headers, TAKOS_INTERNAL_VERSION_HEADER) !== null ||
    readHeader(headers, TAKOS_INTERNAL_SIGNATURE_HEADER) !== null;
}

/**
 * Verifies the `takos-internal-v3` HMAC envelope produced by the Rust agent.
 * Returns the verified context on success or `undefined` on any failure
 * (missing/invalid version, missing headers, clock skew, caller/audience/
 * capability mismatch, body-digest mismatch, or signature mismatch).
 */
export async function verifyAgentInternalRpcFromHeaders(
  input: AgentInternalRpcVerificationInput,
): Promise<VerifiedAgentInternalRpc | undefined> {
  const version = readHeader(input.headers, TAKOS_INTERNAL_VERSION_HEADER);
  if (version !== TAKOS_INTERNAL_RPC_VERSION) return undefined;

  const signature = readHeader(input.headers, TAKOS_INTERNAL_SIGNATURE_HEADER);
  const timestamp = readHeader(input.headers, TAKOS_INTERNAL_TIMESTAMP_HEADER);
  const requestId = readHeader(input.headers, TAKOS_INTERNAL_REQUEST_ID_HEADER);
  const nonce = readHeader(input.headers, TAKOS_INTERNAL_NONCE_HEADER);
  const caller = readHeader(input.headers, TAKOS_INTERNAL_CALLER_HEADER);
  const audience = readHeader(input.headers, TAKOS_INTERNAL_AUDIENCE_HEADER);
  const bodyDigest = readHeader(
    input.headers,
    TAKOS_INTERNAL_BODY_DIGEST_HEADER,
  );
  const actorContextHeader = readHeader(
    input.headers,
    TAKOS_INTERNAL_ACTOR_HEADER,
  );
  if (
    !signature || !timestamp || !requestId || !nonce || !caller || !audience ||
    !bodyDigest || !actorContextHeader
  ) {
    return undefined;
  }

  if (!timestampWithinSkew(timestamp, input)) return undefined;
  if (!callerAllowed(caller, input.expectedCaller)) return undefined;
  if (input.expectedAudience && audience !== input.expectedAudience) {
    return undefined;
  }

  const capabilities = normalizeCapabilities(
    parseCapabilities(
      readHeader(input.headers, TAKOS_INTERNAL_CAPABILITIES_HEADER),
    ),
  );
  for (const capability of input.requiredCapabilities ?? []) {
    if (!capabilities.includes(capability)) return undefined;
  }

  const actualBodyDigest = await sha256Hex(input.body);
  if (!timingSafeEqualHex(actualBodyDigest, bodyDigest)) return undefined;

  let actor: TakosAgentActorContext;
  try {
    actor = decodeActorContext(actorContextHeader);
  } catch {
    return undefined;
  }
  if (actor.requestId !== requestId) return undefined;

  const expectedSignature = await hmacSha256Hex(
    input.secret,
    canonicalAgentInternalRequest({
      method: input.method,
      path: input.path,
      query: input.query,
      bodyDigest,
      actorContextHeader,
      caller,
      audience,
      capabilities,
      requestId,
      nonce,
      timestamp,
    }),
  );
  if (!timingSafeEqualHex(expectedSignature, signature)) return undefined;

  return Object.freeze({
    actor: Object.freeze(structuredClone(actor)),
    caller,
    audience,
    capabilities,
    requestId,
    nonce,
    timestamp,
  });
}

function decodeActorContext(value: string): TakosAgentActorContext {
  const parsed = JSON.parse(atob(value)) as TakosAgentActorContext;
  if (
    typeof parsed.actorAccountId !== "string" || !parsed.actorAccountId ||
    typeof parsed.requestId !== "string" || !parsed.requestId ||
    !Array.isArray(parsed.roles)
  ) {
    throw new TypeError("Invalid Takos agent actor context");
  }
  return parsed;
}

function parseCapabilities(value: string | null): string[] {
  return (value ?? "").split(",").map((capability) => capability.trim()).filter(
    Boolean,
  );
}

// Matches the Rust `normalize_capabilities` / `normalize_capability_header`:
// trim, drop empties, de-dupe, and sort ascending (Rust collects into a
// `BTreeSet<&str>`, which yields lexicographically-sorted unique values).
function normalizeCapabilities(capabilities: readonly string[]): string[] {
  return [
    ...new Set(
      capabilities.map((capability) => capability.trim()).filter(Boolean),
    ),
  ].sort();
}

function callerAllowed(
  caller: string,
  expected: string | readonly string[] | undefined,
): boolean {
  if (!expected) return true;
  return typeof expected === "string"
    ? caller === expected
    : expected.includes(caller);
}

// Matches the Rust `path_with_query`.
function pathWithQuery(path: string, query?: string): string {
  if (!query) return path;
  return query.startsWith("?") ? `${path}${query}` : `${path}?${query}`;
}

function timestampWithinSkew(
  timestamp: string,
  input: {
    readonly now?: () => Date;
    readonly maxClockSkewMs?: number;
  },
): boolean {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  const maxClockSkewMs = input.maxClockSkewMs ??
    TAKOS_INTERNAL_SIGNATURE_MAX_SKEW_MS;
  if (!Number.isFinite(maxClockSkewMs)) return true;
  const now = (input.now?.() ?? new Date()).getTime();
  return Math.abs(now - parsed) <= maxClockSkewMs;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(message),
  );
  return toHex(signature);
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value;
  return toHex(
    await crypto.subtle.digest("SHA-256", bytesToArrayBuffer(bytes)),
  );
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function readHeader(
  headers: Headers | Record<string, string>,
  name: string,
): string | null {
  if (headers instanceof Headers) return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
