/**
 * Hono context variable type declarations for takos-runtime.
 *
 * These are set via c.set() in middleware and accessed via c.get() in handlers.
 * The ServiceTokenEnv from takos-common/middleware/hono provides serviceToken
 * and serviceAuthMethod types.
 *
 * Additional runtime-specific variables are declared here.
 */

import type { Logger } from 'takos-common/logger';
import type { ServiceTokenPayloadWithClaims } from 'takos-common/middleware/hono';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    log: Logger;
    serviceToken: ServiceTokenPayloadWithClaims;
    serviceAuthMethod: 'jwt';
    /** Pre-parsed JSON body, set by body-parsing middleware for workspace-scope checks */
    parsedBody: Record<string, unknown>;
  }
}
