const OIDC_AUTO_LOGIN_ATTEMPT_KEY = "takos:oidc-auto-login-attempted";

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Claims the one automatic OIDC redirect allowed for this browser tab.
 * A failed callback or an explicit logout falls back to the visible login
 * action instead of entering a redirect loop.
 */
export function claimOidcAutoLoginAttempt(
  storage: SessionStorageLike | undefined,
): boolean {
  if (!storage) return true;
  try {
    if (storage.getItem(OIDC_AUTO_LOGIN_ATTEMPT_KEY) !== null) return false;
    storage.setItem(OIDC_AUTO_LOGIN_ATTEMPT_KEY, "1");
    return true;
  } catch {
    return true;
  }
}
