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

  test("an ordinary account's empty membership list adds no authority", () => {
    expect(takosumiAppClaims({
      takosumi: { capsule_id: "app-a" }, workspace_memberships: [],
    }, "app-a")).toEqual({ capsuleId: "app-a" });
    for (const memberships of [["ws-a"], "bad", null]) {
      expect(() => takosumiAppClaims({
        takosumi: { capsule_id: "app-a" }, workspace_memberships: memberships,
      }, "app-a")).toThrow();
    }
  });

  test("current Accounts claims retain the validated workspace and membership role", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(takosumiAppClaims({
        takosumi: { capsule_id: "app-a", workspace_id: "ws-a", role },
        workspace_memberships: ["ws-a"],
      }, "app-a")).toEqual({
        capsuleId: "app-a",
        workspaceId: "ws-a",
        appRole: role === "owner" ? "owner" : "member",
      });
    }
  });

  test("legacy membership without a role retains member compatibility", () => {
    expect(takosumiAppClaims({
      takosumi: { capsule_id: "app-a", workspace_id: "ws-a" },
      workspace_memberships: ["ws-a"],
    }, "app-a")).toEqual({ capsuleId: "app-a", appRole: "member", workspaceId: "ws-a" });
  });

  test("workspace binding remains available when new app_role is present", () => {
    expect(takosumiAppClaims({
      takosumi: { capsule_id: "app-a", app_role: "member", workspace_id: "ws-a" },
      workspace_memberships: ["ws-a"],
    }, "app-a")).toEqual({ capsuleId: "app-a", appRole: "member", workspaceId: "ws-a" });
  });

  test("foreign and malformed evidence cannot fall back to workspace access", () => {
    for (const app of [
      { capsule_id: "app-b", app_role: "owner" },
      { capsule_id: "app-a", app_role: "admin" },
      { capsule_id: "app-a", app_role: null },
      { capsule_id: "app-a", role: "invalid" },
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
    for (const memberships of [undefined, [], ["ws-b"], ["ws-a", "ws-a"], ["ws-a", "ws-b"]]) {
      expect(() => takosumiAppClaims({
        takosumi: { capsule_id: "app-a", workspace_id: "ws-a", role: "owner" },
        workspace_memberships: memberships,
      }, "app-a")).toThrow();
    }
    expect(() => takosumiAppClaims({
      takosumi: { capsule_id: "app-a", role: "owner" },
    }, "app-a")).toThrow();
  });

  test("unconfigured apps ignore capsule evidence and retain legacy validation", () => {
    for (const expected of [undefined, "", "  "]) {
      for (const takosumi of [null, { capsule_id: "foreign", app_role: "invalid", workspace_id: "ws-a" }]) {
        expect(takosumiAppClaims({ takosumi }, expected)).toBeUndefined();
      }
    }
    expect(takosumiAppClaims({ takosumi: { workspace_id: "ws-a" } }, "app-a"))
      .toBeUndefined();
  });
});
