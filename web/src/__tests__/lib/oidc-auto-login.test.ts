import { describe, expect, it } from "vitest";
import {
  claimOidcAutoLoginAttempt,
  type SessionStorageLike,
} from "../../lib/oidc-auto-login.ts";

function memoryStorage(): SessionStorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("claimOidcAutoLoginAttempt", () => {
  it("allows one automatic redirect per browser tab", () => {
    const storage = memoryStorage();

    expect(claimOidcAutoLoginAttempt(storage)).toBe(true);
    expect(claimOidcAutoLoginAttempt(storage)).toBe(false);
  });

  it("allows the redirect when session storage is unavailable", () => {
    const unavailable: SessionStorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(claimOidcAutoLoginAttempt(unavailable)).toBe(true);
    expect(claimOidcAutoLoginAttempt(undefined)).toBe(true);
  });
});
