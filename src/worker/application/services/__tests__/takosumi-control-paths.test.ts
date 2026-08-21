import { describe, expect, test } from "bun:test";

import {
  takosumiCapsuleDestroyPlanPath,
  takosumiCapsuleOutputsPath,
  takosumiCapsulePath,
  takosumiCapsuleRevisionPlansPath,
  takosumiInterfaceBindingsPath,
  takosumiInterfaceTokenPath,
  takosumiInterfacesPath,
  takosumiInstallPlanPath,
  takosumiInstallPlanReconcilePath,
  takosumiRunApprovePath,
  takosumiRunApplyPath,
  takosumiRunPath,
  takosumiRevisionPlanPath,
  takosumiRevisionPlanReconcilePath,
  takosumiSessionApiUrl,
  takosumiSourcePath,
  takosumiSourcesPath,
  takosumiStateVersionRollbackPlanPath,
  takosumiWorkspaceCapsulesPath,
  takosumiWorkspaceInstallPlansPath,
} from "../takosumi-control-paths.ts";

describe("Takosumi session control paths", () => {
  test("encodes every ledger identifier as one path segment", () => {
    expect(takosumiWorkspaceCapsulesPath("ws/a b")).toBe(
      "/api/v1/workspaces/ws%2Fa%20b/capsules",
    );
    expect(takosumiWorkspaceInstallPlansPath("ws/a b")).toBe(
      "/api/v1/workspaces/ws%2Fa%20b/install-plans",
    );
    expect(takosumiInstallPlanPath("plan/a b")).toBe(
      "/api/v1/install-plans/plan%2Fa%20b",
    );
    expect(takosumiInstallPlanReconcilePath("plan/a b")).toBe(
      "/api/v1/install-plans/plan%2Fa%20b/reconcile",
    );
    expect(takosumiCapsulePath("cap/a b")).toBe("/api/v1/capsules/cap%2Fa%20b");
    expect(takosumiCapsuleDestroyPlanPath("cap/a b")).toBe(
      "/api/v1/capsules/cap%2Fa%20b/destroy-plan",
    );
    expect(takosumiCapsuleRevisionPlansPath("cap/a b")).toBe(
      "/api/v1/capsules/cap%2Fa%20b/revision-plans",
    );
    expect(takosumiRevisionPlanPath("revision/a b")).toBe(
      "/api/v1/revision-plans/revision%2Fa%20b",
    );
    expect(takosumiRevisionPlanReconcilePath("revision/a b")).toBe(
      "/api/v1/revision-plans/revision%2Fa%20b/reconcile",
    );
    expect(takosumiCapsuleOutputsPath("cap/a b")).toBe(
      "/api/v1/capsules/cap%2Fa%20b/outputs",
    );
    expect(takosumiRunApplyPath("run/a b")).toBe(
      "/api/v1/runs/run%2Fa%20b/apply",
    );
    expect(takosumiRunApprovePath("run/a b")).toBe(
      "/api/v1/runs/run%2Fa%20b/approve",
    );
    expect(takosumiRunPath("run/a b")).toBe("/api/v1/runs/run%2Fa%20b");
    expect(takosumiSourcePath("src/a b")).toBe("/api/v1/sources/src%2Fa%20b");
    expect(takosumiStateVersionRollbackPlanPath("sv/a b")).toBe(
      "/api/v1/state-versions/sv%2Fa%20b/rollback-plan",
    );
    expect(takosumiInterfaceBindingsPath("if/a b")).toBe(
      "/api/v1/interfaces/if%2Fa%20b/bindings",
    );
    expect(takosumiInterfaceTokenPath("if/a b")).toBe(
      "/api/v1/interfaces/if%2Fa%20b/token",
    );
  });

  test("keeps the shared Interface API on its canonical public prefix", () => {
    expect(takosumiInterfacesPath()).toBe("/api/v1/interfaces");
  });

  test("keeps an operator base path without retaining query or fragment", () => {
    expect(
      takosumiSessionApiUrl(
        "https://operator.example/control/?ignored=yes#fragment",
        takosumiSourcesPath(),
      ).toString(),
    ).toBe("https://operator.example/control/api/v1/sources");
  });

  test("does not duplicate the canonical API prefix when a provider base includes it", () => {
    expect(
      takosumiSessionApiUrl(
        "https://operator.example/control/api/v1/",
        takosumiInterfacesPath(),
      ).toString(),
    ).toBe("https://operator.example/control/api/v1/interfaces");
  });
});
