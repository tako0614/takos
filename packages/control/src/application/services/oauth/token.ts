/**
 * Token service barrel file.
 *
 * Re-exports all token operations from focused sub-modules:
 *   - token-helpers:        shared types, row mapping, revocation data builders
 *   - token-grants:         access/refresh token generation, storage, and token response assembly
 *   - token-introspection:  token lookup and validity checks
 *   - token-revocation:     single/bulk/family revocation and expired token cleanup
 *   - token-refresh:        refresh-token rotation with reuse detection
 */

// helpers (public subset)
export { buildAuthorizationCodeTokenFamily } from "./token-helpers.ts";

// grants / issuance
export {
  formatOAuthAccessToken,
  generateAccessToken,
  generateRefreshToken,
  generateTokenResponse,
  OAUTH_ACCESS_TOKEN_PREFIX,
  storeAccessToken,
  storeRefreshToken,
  verifyAccessToken,
} from "./token-grants.ts";

// introspection / validation
export { getRefreshToken, isAccessTokenValid } from "./token-introspection.ts";

// revocation
export {
  deleteExpiredTokens,
  revokeAllClientTokens,
  revokeAllUserClientTokens,
  revokeRefreshTokenAndChildren,
  revokeToken,
  revokeTokenByHash,
  revokeTokenFamily,
  revokeTokensByAuthorizationCode,
} from "./token-revocation.ts";

// refresh
export {
  getRefreshTokenWithReuseCheck,
  markRefreshTokenAsUsed,
  RefreshTokenReuseDetectedError,
  rotateRefreshToken,
} from "./token-refresh.ts";
