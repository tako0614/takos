/**
 * OAuth scopes required by the Takos runtime when it delegates Capsule access
 * to Takosumi Accounts. The Accounts operator registers the public OIDC client
 * explicitly; Takos never asks the Capsule host to mint one during install.
 */
export const TAKOS_ACCOUNTS_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "capsules:read",
  "capsules:write",
] as const;
