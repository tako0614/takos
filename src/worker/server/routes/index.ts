/**
 * Server routes entrypoint for `takos-worker/server/routes`.
 */
export * from "./api.ts";
export * from "./rpc-types.ts";
export * from "./setup.ts";
export * from "./auth-api.ts";

// Auth sub-routes
export { authOidcRouter } from "./auth/oidc.ts";
export { authSessionRouter } from "./auth/session.ts";
export {
  generateUniqueUserId,
  sanitizeReturnTo,
  validateCliCallbackUrl,
} from "./auth/provisioning.ts";

export { default as indexRoutes } from "./index/routes.ts";
