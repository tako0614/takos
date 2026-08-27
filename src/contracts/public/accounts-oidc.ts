/**
 * OAuth scopes required by the Takos runtime when it delegates Capsule access
 * to Takosumi Accounts. These scopes are app-declared API use. The generic
 * `identity.oidc` capability registers a Capsule-bound public client during
 * Apply (Plan is read-only) and revokes it on terminal destroy; any confidential
 * client secret remains separate operator-managed configuration.
 */
export const TAKOS_ACCOUNTS_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "capsules:read",
  "capsules:write",
] as const;
