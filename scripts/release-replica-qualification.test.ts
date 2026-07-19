import { describe, expect, test } from "bun:test";
import {
  CONTROL_MIGRATION_DIRECTORY,
  exactDigestRef,
  hostSecurityQualifies,
  migrationInventoryDirectory,
  REQUIRED_BUN_VERSION,
  sha256Bytes,
} from "./release-replica-qualification.ts";

describe("release replica qualification", () => {
  test("accepts only canonical digest references", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(exactDigestRef("ghcr.io/tako0614/takos-worker", digest)).toBe(
      `ghcr.io/tako0614/takos-worker@${digest}`,
    );
    expect(() =>
      exactDigestRef("ghcr.io/tako0614/takos-worker", "latest"),
    ).toThrow("invalid image digest");
  });

  test("requires default AppArmor, seccomp, and cgroup namespace confinement", () => {
    expect(
      hostSecurityQualifies(
        ["name=apparmor", "name=seccomp,profile=builtin", "name=cgroupns"],
        {
          worker: "docker-default (enforce)",
          agent: "docker-default (enforce)",
        },
      ),
    ).toEqual({ ok: true, reasons: [] });
    const mismatch = hostSecurityQualifies(
      ["name=seccomp,profile=builtin", "name=cgroupns"],
      { worker: "unconfined" },
    );
    expect(mismatch.ok).toBe(false);
    expect(mismatch.reasons).toContain(
      "Docker security option is missing: name=apparmor",
    );
    expect(mismatch.reasons).toContain(
      "worker is not confined by docker-default AppArmor",
    );
  });

  test("hash output is canonical SHA-256", () => {
    expect(sha256Bytes("replica")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("locks qualification to the canonical control migration inventory", () => {
    expect(CONTROL_MIGRATION_DIRECTORY).toBe(
      "db/migrations-control/migrations",
    );
    expect(migrationInventoryDirectory("/candidate/source")).toBe(
      "/candidate/source/db/migrations-control/migrations",
    );
  });

  test("locks the replica controller to the reviewed Bun toolchain", () => {
    expect(REQUIRED_BUN_VERSION).toBe("1.3.14");
  });
});
