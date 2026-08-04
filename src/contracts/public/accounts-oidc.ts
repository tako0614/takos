/**
 * OAuth scopes required by the Takos runtime when it delegates Capsule access
 * to Takosumi Accounts. The repository manifest and runtime request must stay
 * identical so a host can issue a usable client before Takos starts.
 */
export const TAKOS_ACCOUNTS_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "capsules:read",
  "capsules:write",
] as const;
