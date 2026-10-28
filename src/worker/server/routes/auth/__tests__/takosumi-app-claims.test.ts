import { describe, expect, test } from "bun:test";
import { takosumiAppClaims } from "../takosumi-app-claims.ts";

describe("Takosumi app sign-in claims", () => {
  test("owner, member and ordinary accounts bind to this app without memberships", () => {
    for (const appRole of ["owner", "member", undefined] as const) {
      expect(takosumiAppClaims({
        takosumi: { capsule_id: "app-a", app_role: appRole },
      }, "app-a")).toEqual({
        capsuleId: "app-a",
        ...(appRole ? { appRole } : {}),
      });
    }
  });

  test("foreign and malformed evidence cannot fall back to workspace access", () => {
    for (const app of [
      { capsule_id: "app-b", app_role: "owner" },
      { capsule_id: "app-a", app_role: "admin" },
      { capsule_id: "app-a", app_role: null },
      { app_role: "owner" },
    ]) {
      expect(() => takosumiAppClaims({
        takosumi: { workspace_id: "ws-a", ...app },
        workspace_memberships: ["ws-a"],
      }, "app-a")).toThrow();
    }
    for (const malformed of [null, false, "bad", []]) {
      expect(() => takosumiAppClaims({ takosumi: malformed }, "app-a")).toThrow();
    }
    expect(() => takosumiAppClaims({
      takosumi: { capsule_id: "app-a" },
    }, undefined)).toThrow();
  });

  test("leaves claim-absent legacy evidence to the compatibility validator", () => {
    expect(takosumiAppClaims({ takosumi: { workspace_id: "ws-a" } }, "app-a"))
      .toBeUndefined();
  });
});
