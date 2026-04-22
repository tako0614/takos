/**
 * Server routes entrypoint for `takos-control/server/routes`.
 */
export * from "./api.ts";
export * from "./rpc-types.ts";
export * from "./well-known.ts";
export * from "./smart-http.ts";
export * from "./setup.ts";
export * from "./auth-api.ts";

// Auth sub-routes
export { authCliRouter } from "./auth/cli.ts";
export { externalAuthRouter } from "./auth/external.ts";
export { authLinkRouter } from "./auth/link.ts";
export { authSessionRouter } from "./auth/session.ts";
export {
  generateUniqueUserId,
  provisionGoogleOAuthUser,
  sanitizeReturnTo,
  validateCliCallbackUrl,
} from "./auth/provisioning.ts";

// OAuth
export { default as oauthRouter } from "./oauth/routes.ts";
export { default as indexRoutes } from "./index/routes.ts";
