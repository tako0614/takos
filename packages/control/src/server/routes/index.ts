/**
 * Server routes entrypoint for `takos-control/server/routes`.
 */
export * from './api';
export * from './rpc-types';
export * from './well-known';
export * from './smart-http';
export * from './setup';
export * from './auth-api';

// Auth sub-routes
export { authCliRouter } from './auth/cli';
export { externalAuthRouter } from './auth/external';
export { authLinkRouter } from './auth/link';
export { authSessionRouter } from './auth/session';
export {
  generateUniqueUserId,
  provisionGoogleOAuthUser,
  sanitizeReturnTo,
  validateCliCallbackUrl,
} from './auth/provisioning';

// OAuth
export { default as oauthRouter } from './oauth/routes';
export { default as indexRoutes } from './index/routes';
