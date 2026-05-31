import type { InternalSpaceRequest } from "takosumi-contract-v2/internal/api";

export type CommonErrorEnvelope = {
  error: {
    code: string;
    message: string;
  };
};

export function commonError(
  code: string,
  message: string,
): CommonErrorEnvelope {
  return { error: { code, message } };
}

/**
 * Canonical request-correlation header name. The same value is echoed on every
 * error response so the closed `{ error: { code, message } }` envelope can be
 * correlated with server logs without leaking internals into the body.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Resolves the correlation id for a request: honors a caller-supplied
 * `x-request-id` header when present, otherwise mints a fresh UUID. Used both
 * to seed the actor `requestId` and to echo `x-request-id` on responses, so the
 * id is stable for the lifetime of one request across route handlers, the auth
 * layer, and the global error boundary.
 */
export function resolveRequestId(
  req: { header(name: string): string | undefined },
): string {
  return req.header(REQUEST_ID_HEADER) ?? crypto.randomUUID();
}

/**
 * Builds a closed error `Response` with the canonical envelope shape and the
 * `x-request-id` correlation header. Centralizing this keeps the
 * code/message/requestId contract identical across route helpers, the auth
 * layer, and the global error boundary.
 */
export function commonErrorResponse(
  code: string,
  message: string,
  status: number,
  requestId: string,
): Response {
  return Response.json(commonError(code, message), {
    status,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonObjectOrNull(
  body: string,
): Record<string, unknown> | null {
  if (!body.trim()) return null;
  try {
    const value = JSON.parse(body) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Reads a JSON request body without imposing a value-level cast.
 *
 * `Request#json()` is typed `Promise<any>`, which silently widens the result
 * back into the caller. This helper re-types the result as `unknown` so
 * downstream structural parsers (`parseX(body: unknown)`) remain the single
 * source of truth for shape validation. Returns `null` on parse failure to
 * mirror the previous `.catch(() => null)` pattern at call sites.
 */
export async function readJsonBody(
  req: { json(): Promise<unknown> },
): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function isJsonObject(
  value: unknown,
): value is NonNullable<InternalSpaceRequest["metadata"]> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

export function isJsonValue(value: unknown): boolean {
  if (
    value === null || typeof value === "string" ||
    typeof value === "number" || typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

export function readBodyString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function optionalStringField(
  body: Record<string, unknown>,
  key: string,
): { ok: true; value?: string } | { ok: false; message: string } {
  const value = body[key];
  if (value === undefined) return { ok: true };
  if (typeof value === "string") return { ok: true, value };
  return { ok: false, message: `${key} must be a string` };
}

export function optionalLocaleField(
  body: Record<string, unknown>,
  key: string,
  allowNull: boolean,
):
  | { ok: true; value?: "ja" | "en" | null }
  | { ok: false; message: string } {
  const value = body[key];
  if (value === undefined) return { ok: true };
  if (value === null && allowNull) return { ok: true, value: null };
  if (value === "ja" || value === "en") return { ok: true, value };
  return { ok: false, message: `${key} must be ja or en` };
}

export function parsePositiveLimit(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
}

/**
 * Maximum accepted `offset` for offset-based list pagination.
 *
 * List/search endpoints translate `offset` into a SQL `OFFSET`, which skips
 * rows linearly. Capping it bounds the worst-case row skip a (potentially
 * unauthenticated) caller can request, closing a cheap deep-offset resource
 * amplification vector. Callers needing to page past this boundary should
 * narrow their query rather than deep-paging.
 */
export const MAX_LIST_OFFSET = 10_000;

export function parsePositiveOffset(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(parsed, MAX_LIST_OFFSET)
    : 0;
}

export function parseRunEventCursor(
  value: string | undefined,
): number | null {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function pathMatchesPrefix(
  pathname: string,
  prefix: string,
): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function constantTimeEqual(
  actual: string,
  expected: string,
): boolean {
  const actualBytes = new TextEncoder().encode(actual);
  const expectedBytes = new TextEncoder().encode(expected);
  const length = Math.max(actualBytes.length, expectedBytes.length);
  let diff = actualBytes.length ^ expectedBytes.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return diff === 0;
}

export function copyHeaderIfPresent(
  source: Headers,
  target: Headers,
  name: string,
): void {
  const value = source.get(name);
  if (value) target.set(name, value);
}
