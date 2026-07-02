const UNSUPPORTED_APP_LOCAL_BEARER_PREFIXES = ["tak_pat_", "tak_oat_"] as const;
const TAKOSUMI_ACCOUNTS_BEARER_PREFIX = "takpat_";
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

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

/**
 * Whether the token is plausibly a JWT: three non-empty base64url segments whose
 * header decodes to a JSON object declaring an `alg`. This is stricter than a
 * bare `split(".").length === 3`, which classified arbitrary `a.b.c` strings as
 * accounts bearers and steered them into issuer-JWKS verification. The verifier
 * still validates the signature; this just stops junk from reaching it.
 */
function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  if (!parts.every((p) => p.length > 0 && BASE64URL_SEGMENT.test(p))) {
    return false;
  }
  try {
    const b64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const header = JSON.parse(atob(padded)) as Record<string, unknown>;
    return typeof header.alg === "string";
  } catch {
    return false;
  }
}

export function isTakosumiAccountsBearerCandidate(token: string): boolean {
  return (
    !isUnsupportedAppLocalBearerToken(token) &&
    (token.startsWith(TAKOSUMI_ACCOUNTS_BEARER_PREFIX) || looksLikeJwt(token))
  );
}
