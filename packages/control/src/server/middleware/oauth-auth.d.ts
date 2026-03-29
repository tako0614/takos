import type { MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types';
export interface OAuthContext {
    clientId: string;
    scope: string;
    scopes: string[];
    userId: string;
}
type Variables = {
    user?: User;
    oauth?: OAuthContext;
};
export declare function requireOAuthAuth(requiredScopes?: string[]): MiddlewareHandler<{
    Bindings: Env;
    Variables: Variables;
}>;
/**
 * Accepts either session-based or OAuth2 authentication (session takes priority).
 *
 * Design note: when authenticated via session cookie, requiredScopes are intentionally
 * NOT checked. Session = browser-logged-in user with full access to their own account.
 * OAuth Bearer tokens (third-party apps) go through requireOAuthAuth which enforces
 * scope restrictions. Per-route scope enforcement is handled by requireOAuthScope on
 * storage/API routes that need it.
 */
export declare function requireAnyAuth(requiredScopes?: string[]): MiddlewareHandler<{
    Bindings: Env;
    Variables: Variables;
}>;
export {};
//# sourceMappingURL=oauth-auth.d.ts.map