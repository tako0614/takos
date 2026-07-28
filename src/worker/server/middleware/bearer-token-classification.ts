const UNSUPPORTED_APP_LOCAL_BEARER_PREFIXES = ["tak_pat_", "tak_oat_"] as const;

/**
 * Canonical `Authorization: Bearer <token>` extractor. Returns the trimmed
 * token, or `null` when the header is absent, not a `Bearer ` header, or only
 * whitespace after the scheme. Single-sources the `slice(7).trim() || null`
 * idiom that was previously inlined across the auth middlewares.
 */
export function extractBearerToken(
  authorizationHeader: string | null | undefined,
): string | null {
  return authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice(7).trim() || null
    : null;
}

export function isUnsupportedAppLocalBearerToken(token: string): boolean {
  return UNSUPPORTED_APP_LOCAL_BEARER_PREFIXES.some((prefix) =>
    token.startsWith(prefix),
  );
}

export function isTakosumiAccountsBearerCandidate(token: string): boolean {
  const opaqueToken = token.trim();
  return opaqueToken.length > 0 &&
    !isUnsupportedAppLocalBearerToken(opaqueToken);
}
