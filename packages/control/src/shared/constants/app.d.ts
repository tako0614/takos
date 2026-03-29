/**
 * Application Constants
 *
 * Centralized constants for consistent configuration across the application.
 */
/**
 * Cloudflare Workers compatibility date
 *
 * This date determines which Cloudflare Workers runtime features are available.
 * All workers should use this constant to ensure consistent behavior.
 *
 * @see https://developers.cloudflare.com/workers/configuration/compatibility-dates/
 */
export declare const CF_COMPATIBILITY_DATE = "2024-12-01";
/**
 * Production domain for the Takos platform.
 *
 * Used by the CLI and other external-facing clients as the default API endpoint.
 * Local-development domain defaults live in local-platform/runtime-types.ts.
 */
export declare const PRODUCTION_DOMAIN = "takos.jp";
/**
 * Centralized error messages used across route handlers.
 * Using constants avoids typo drift and makes bulk updates trivial.
 */
export declare const ERR: {
    readonly USER_NOT_FOUND: "User not found";
    readonly REPOSITORY_NOT_FOUND: "Repository not found";
    readonly WORKSPACE_NOT_FOUND: "Workspace not found";
    readonly SESSION_NOT_FOUND: "Session not found";
    readonly RESOURCE_NOT_FOUND: "Resource not found";
    readonly RELEASE_NOT_FOUND: "Release not found";
    readonly TOKEN_NOT_FOUND: "Token not found";
    readonly COMMIT_NOT_FOUND: "Commit not found";
    readonly INVOICE_NOT_FOUND: "Invoice not found";
    readonly PERMISSION_DENIED: "Permission denied";
    readonly BILLING_NOT_CONFIGURED: "Billing not configured";
    readonly NO_STRIPE_CUSTOMER: "No Stripe customer";
};
export declare const HEARTBEAT_TIMEOUT_MS: number;
export declare const STARTUP_GRACE_MS: number;
//# sourceMappingURL=app.d.ts.map