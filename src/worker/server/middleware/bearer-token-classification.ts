const RETIRED_APP_LOCAL_BEARER_PREFIXES = ["tak_pat_", "tak_oat_"] as const;
const TAKOSUMI_ACCOUNTS_BEARER_PREFIX = "takpat_";

export function isRetiredAppLocalBearerToken(token: string): boolean {
  return RETIRED_APP_LOCAL_BEARER_PREFIXES.some((prefix) =>
    token.startsWith(prefix)
  );
}

export function isTakosumiAccountsBearerCandidate(token: string): boolean {
  return !isRetiredAppLocalBearerToken(token) &&
    (token.startsWith(TAKOSUMI_ACCOUNTS_BEARER_PREFIX) ||
      token.split(".").length === 3);
}
