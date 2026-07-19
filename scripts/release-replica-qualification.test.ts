import { describe, expect, test } from "bun:test";
import {
  CONTROL_MIGRATION_DIRECTORY,
  exactRegistryBody,
  exactDigestRef,
  hostSecurityQualifies,
  migrationInventoryDirectory,
  REQUIRED_BUN_VERSION,
  resolveLinuxAmd64Image,
  sha256Bytes,
  verifyRegistryDescriptor,
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

  test("resolves one linux/amd64 child only from raw bytes matching the published index", () => {
    const childDigest = `sha256:${"c".repeat(64)}`;
    const rawIndex = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: [
          {
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            digest: childDigest,
            platform: { os: "linux", architecture: "amd64" },
          },
          {
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            digest: `sha256:${"d".repeat(64)}`,
            platform: { os: "unknown", architecture: "unknown" },
          },
        ],
      }),
    );
    const indexRef = `ghcr.io/tako0614/takos-agent@${sha256Bytes(rawIndex)}`;
    expect(
      resolveLinuxAmd64Image(
        indexRef,
        "ghcr.io/tako0614/takos-agent:0.10.35",
        rawIndex,
      ),
    ).toEqual({
      publishedIndex: indexRef,
      sourceTag: "ghcr.io/tako0614/takos-agent:0.10.35",
      rawIndexDigest: sha256Bytes(rawIndex),
      descriptorSize: rawIndex.byteLength,
      transportSize: rawIndex.byteLength,
      trailingLineFeedRemoved: false,
      platform: { os: "linux", architecture: "amd64" },
      executionImage: `ghcr.io/tako0614/takos-agent@${childDigest}`,
    });

    const changedRawIndex = new Uint8Array([...rawIndex, 0x20]);
    expect(() =>
      resolveLinuxAmd64Image(
        indexRef,
        "ghcr.io/tako0614/takos-agent:0.10.35",
        changedRawIndex,
      ),
    ).toThrow("raw OCI index digest drifted");

    const duplicateRawIndex = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: [
          {
            digest: childDigest,
            platform: { os: "linux", architecture: "amd64" },
          },
          {
            digest: `sha256:${"e".repeat(64)}`,
            platform: { os: "linux", architecture: "amd64" },
          },
        ],
      }),
    );
    expect(() =>
      resolveLinuxAmd64Image(
        `ghcr.io/tako0614/takos-agent@${sha256Bytes(duplicateRawIndex)}`,
        "ghcr.io/tako0614/takos-agent:0.10.35",
        duplicateRawIndex,
      ),
    ).toThrow("exactly one linux/amd64");
  });

  test("separates only one CLI line-feed delimiter from exact registry bytes", () => {
    const body = new TextEncoder().encode('{"schemaVersion":2}');
    expect(exactRegistryBody(body, body.byteLength)).toEqual({
      body,
      descriptorSize: body.byteLength,
      transportSize: body.byteLength,
      trailingLineFeedRemoved: false,
    });

    const withLineFeed = new Uint8Array([...body, 0x0a]);
    expect(exactRegistryBody(withLineFeed, body.byteLength)).toEqual({
      body,
      descriptorSize: body.byteLength,
      transportSize: body.byteLength + 1,
      trailingLineFeedRemoved: true,
    });

    for (const invalid of [
      new Uint8Array([...body, 0x0d, 0x0a]),
      new Uint8Array([...body, 0x0a, 0x0a]),
      new Uint8Array([...body, 0x20]),
      body.slice(0, -1),
    ]) {
      expect(() => exactRegistryBody(invalid, body.byteLength)).toThrow(
        "does not match the registry descriptor size",
      );
    }
  });

  test("rejects registry descriptor digest and size drift", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const publishedIndex = `ghcr.io/tako0614/takos-agent@${digest}`;
    expect(
      verifyRegistryDescriptor(publishedIndex, { digest, size: 856 }),
    ).toBe(856);
    expect(() =>
      verifyRegistryDescriptor(publishedIndex, {
        digest: `sha256:${"b".repeat(64)}`,
        size: 856,
      }),
    ).toThrow("descriptor digest drifted");
    for (const size of [undefined, 0, -1, 10 * 1024 * 1024 + 1]) {
      expect(() =>
        verifyRegistryDescriptor(publishedIndex, { digest, size }),
      ).toThrow("descriptor size is invalid");
    }
  });
});
