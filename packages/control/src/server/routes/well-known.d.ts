/**
 * Well-Known Endpoints
 *
 * Implements:
 * - OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * - JSON Web Key Set (JWKS)
 */
import { Hono } from 'hono';
import type { Env } from '../../shared/types';
declare const wellKnown: Hono<{
    Bindings: Env;
}, import("hono/types").BlankSchema, "/">;
export default wellKnown;
//# sourceMappingURL=well-known.d.ts.map