import type { Context, MiddlewareHandler } from "hono";

import { commonError } from "./common.ts";

/**
 * DoS body-size guard for takos-worker Hono.
 *
 * Reads `Content-Length` before any handler runs and rejects with `413
 * body_too_large` when the declared body exceeds the configured cap. The
 * check is conservative on purpose:
 *
 * - Methods that never carry a body (GET / HEAD / OPTIONS / DELETE) are
 *   skipped.
 * - Missing `Content-Length` is allowed by default so that chunked-encoded
 *   uploads and runtimes that omit the header (for example fetch `Request`
 *   constructor for string bodies) still pass through, BUT a chunked body is
 *   not trusted to stay under the cap on the header's word alone: when
 *   `Content-Length` is absent the body stream is wrapped in a byte counter
 *   that aborts past the cap, closing the chunked-transfer bypass (e.g. the
 *   git-smart-http push and public deployment routes). Set
 *   `requireContentLength: true` on routes that must refuse chunked-only
 *   traffic outright with 411.
 * - The cap is bytes. `1 MiB = 1024 * 1024`.
 *
 * Per-route overrides should be mounted BEFORE the global default cap so the
 * larger override wins (Hono runs middleware in registration order).
 */

const BODY_BEARING_METHODS = new Set(["POST", "PUT", "PATCH"]);

export interface BodyLimitOptions {
  /** Maximum body size in bytes. */
  maxBytes: number;
  /**
   * When true, requests without a `Content-Length` header are rejected with
   * 411 on body-bearing methods. Defaults to false.
   */
  requireContentLength?: boolean;
}

/**
 * Resolves the per-request body-limit options. Returning `null` means the
 * middleware skips this request entirely (= delegates to the next layer).
 */
export type BodyLimitResolver = (request: Request) => BodyLimitOptions | null;

export const DEFAULT_BODY_LIMIT_BYTES = 1 * 1024 * 1024; // 1 MiB
export const GIT_SMART_HTTP_BODY_LIMIT_BYTES = 256 * 1024 * 1024; // 256 MiB
export const DEPLOY_BODY_LIMIT_BYTES = 8 * 1024 * 1024; // 8 MiB

function parseContentLength(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export type BodyLimitDecision =
  | { ok: true }
  | {
    ok: false;
    reason: "body_too_large" | "body_length_required";
    limit: number;
    declared: number | null;
  };

/**
 * Pure decision function exposed for tests. The middleware below is a thin
 * Hono wrapper.
 */
export function evaluateBodyLimit(
  request: Request,
  options: BodyLimitOptions,
): BodyLimitDecision {
  const method = request.method.toUpperCase();
  if (!BODY_BEARING_METHODS.has(method)) return { ok: true };

  const declared = parseContentLength(request.headers.get("content-length"));
  if (declared === null) {
    if (!options.requireContentLength) return { ok: true };
    return {
      ok: false,
      reason: "body_length_required",
      limit: options.maxBytes,
      declared: null,
    };
  }
  if (declared > options.maxBytes) {
    return {
      ok: false,
      reason: "body_too_large",
      limit: options.maxBytes,
      declared,
    };
  }
  return { ok: true };
}

/** Sentinel error thrown by the stream counter when the cap is exceeded. */
export class BodyTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Request body exceeds the ${limit} byte cap`);
    this.name = "BodyTooLargeError";
    this.limit = limit;
  }
}

/**
 * Wrap a request body stream so that it errors (cancelling the source) once
 * more than `maxBytes` have flowed through. This closes the chunked-transfer
 * bypass: a request without a trusted `Content-Length` is still capped while
 * its body is consumed downstream, instead of relying on the (omittable)
 * header alone.
 */
export function capRequestBodyStream(
  request: Request,
  maxBytes: number,
): Request {
  const body = request.body;
  if (!body) return request;

  let seen = 0;
  const capped = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          controller.error(new BodyTooLargeError(maxBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: capped,
    redirect: request.redirect,
    signal: request.signal,
    // @ts-expect-error duplex is a valid RequestInit field at runtime but is
    // not yet in the lib.dom typings shipped with the current runtime types.
    duplex: "half",
  });
}

export function bodyLimitMiddleware(
  optionsOrResolver: BodyLimitOptions | BodyLimitResolver,
): MiddlewareHandler {
  const resolve: BodyLimitResolver = typeof optionsOrResolver === "function"
    ? optionsOrResolver
    : () => optionsOrResolver;
  return async (c: Context, next: () => Promise<void>) => {
    const options = resolve(c.req.raw);
    if (options === null) return await next();
    const decision = evaluateBodyLimit(c.req.raw, options);
    if (decision.ok) {
      // The header check only guards a declared `Content-Length`. For
      // body-bearing requests that omit it (chunked transfer-encoding), wrap
      // the body stream so the cap is still enforced as it is consumed.
      const method = c.req.method.toUpperCase();
      if (
        BODY_BEARING_METHODS.has(method) &&
        c.req.raw.headers.get("content-length") === null &&
        c.req.raw.body !== null
      ) {
        const capped = capRequestBodyStream(c.req.raw, options.maxBytes);
        if (capped !== c.req.raw) {
          c.req.raw = capped;
        }
      }
      return await next();
    }

    const status = decision.reason === "body_length_required" ? 411 : 413;
    return c.json(
      commonError(
        decision.reason,
        decision.reason === "body_too_large"
          ? `Request body exceeds the ${decision.limit} byte cap`
          : "Content-Length header is required",
      ),
      status,
    );
  };
}
