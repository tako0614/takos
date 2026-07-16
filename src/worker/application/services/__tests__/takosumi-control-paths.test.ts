import { describe, expect, test } from "bun:test";

import {
  takosumiCapsuleDestroyPlanPath,
  takosumiCapsuleOutputsPath,
  takosumiCapsulePath,
  takosumiCapsulePlanPath,
  takosumiInterfacesPath,
  takosumiRunApplyPath,
  takosumiRunPath,
  takosumiSessionApiUrl,
  takosumiSourcePath,
  takosumiSourceSyncPath,
  takosumiSourcesPath,
  takosumiStateVersionRollbackPlanPath,
  takosumiWorkspaceCapsulesPath,
} from "../takosumi-control-paths.ts";

describe("Takosumi session control paths", () => {
  test("encodes every ledger identifier as one path segment", () => {
    expect(takosumiWorkspaceCapsulesPath("ws/a b")).toBe(
      "/api/v1/workspaces/ws%2Fa%20b/capsules",
    );
    expect(takosumiCapsulePath("cap/a b")).toBe("/api/v1/capsules/cap%2Fa%20b");
    expect(takosumiCapsulePlanPath("cap/a b")).toBe(
      "/api/v1/capsules/cap%2Fa%20b/plan",
    );
    expect(takosumiCapsuleDestroyPlanPath("cap/a b")).toBe(
      "/api/v1/capsules/cap%2Fa%20b/destroy-plan",
    );
    expect(takosumiCapsuleOutputsPath("cap/a b")).toBe(
      "/api/v1/capsules/cap%2Fa%20b/outputs",
    );
    expect(takosumiRunApplyPath("run/a b")).toBe(
      "/api/v1/runs/run%2Fa%20b/apply",
    );
    expect(takosumiRunPath("run/a b")).toBe("/api/v1/runs/run%2Fa%20b");
    expect(takosumiSourcePath("src/a b")).toBe("/api/v1/sources/src%2Fa%20b");
    expect(takosumiSourceSyncPath("src/a b")).toBe(
      "/api/v1/sources/src%2Fa%20b/sync",
    );
    expect(takosumiStateVersionRollbackPlanPath("sv/a b")).toBe(
      "/api/v1/state-versions/sv%2Fa%20b/rollback-plan",
    );
  });

  test("keeps the shared Interface API on its canonical public prefix", () => {
    expect(takosumiInterfacesPath()).toBe("/v1/interfaces");
  });

  test("keeps an operator base path without retaining query or fragment", () => {
    expect(
      takosumiSessionApiUrl(
        "https://operator.example/control/?ignored=yes#fragment",
        takosumiSourcesPath(),
      ).toString(),
    ).toBe("https://operator.example/control/api/v1/sources");
  });
});
