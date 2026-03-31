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
export { buildAuthorizationCodeTokenFamily } from './token-helpers.ts';

// grants / issuance
export {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  storeAccessToken,
  storeRefreshToken,
  generateTokenResponse,
} from './token-grants.ts';

// introspection / validation
export {
  getRefreshToken,
  isAccessTokenValid,
} from './token-introspection.ts';

// revocation
export {
  revokeTokenByHash,
  revokeToken,
  revokeRefreshTokenAndChildren,
  revokeAllUserClientTokens,
  revokeTokensByAuthorizationCode,
  revokeAllClientTokens,
  revokeTokenFamily,
  deleteExpiredTokens,
} from './token-revocation.ts';

// refresh
export {
  RefreshTokenReuseDetectedError,
  markRefreshTokenAsUsed,
  getRefreshTokenWithReuseCheck,
  rotateRefreshToken,
} from './token-refresh.ts';
