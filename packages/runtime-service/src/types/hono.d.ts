/**
 * Hono context variable type declarations for takos-runtime.
 *
 * These are set via c.set() in middleware and accessed via c.get() in handlers.
 * The ServiceTokenEnv from takos-common/middleware/hono provides serviceToken
 * and serviceAuthMethod types.
 *
 * NOTE: We use an explicit Env type (generic parameter) instead of
 * `declare module 'hono' { interface ContextVariableMap { ... } }` because
 * Deno resolves Hono as `npm:hono` -- module augmentation on bare specifiers
 * does not propagate reliably in this setup.
 */

import type { Env } from "hono";
import type { Logger } from "takos-common/logger";
import type { ServiceTokenPayloadWithClaims } from "takos-common/middleware/hono";

export interface RuntimeVariables {
  requestId: string;
  log: Logger;
  serviceToken: ServiceTokenPayloadWithClaims;
  serviceAuthMethod: "jwt";
  /** Pre-parsed JSON body, set by body-parsing middleware for space-scope checks */
  parsedBody: Record<string, unknown>;
}

export interface RuntimeEnv extends Env {
  Variables: RuntimeVariables;
}
