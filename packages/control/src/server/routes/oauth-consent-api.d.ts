/**
 * JSON API endpoints for OAuth consent UI (consumed by the React SPA).
 *
 * Mounted at /api/oauth — separate from the existing /oauth routes which
 * handle protocol-level OAuth2 endpoints.
 */
import { Hono } from 'hono';
import type { User } from '../../shared/types';
import type { PublicRouteEnv } from './route-auth';
type ConsentApiEnv = {
    Bindings: PublicRouteEnv['Bindings'];
    Variables: {
        user?: User;
    };
};
declare const oauthConsentApi: Hono<ConsentApiEnv, import("hono/types").BlankSchema, "/">;
export default oauthConsentApi;
//# sourceMappingURL=oauth-consent-api.d.ts.map