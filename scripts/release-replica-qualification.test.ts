import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareCanonicalSha256Hex,
  compareSha256Bytes,
  CONTROL_MIGRATION_DIRECTORY,
  digestAuthorityPath,
  exactRegistryBody,
  exactDigestRef,
  hostSecurityQualifies,
  migrationInventoryDirectory,
  readDigestAuthority,
  REQUIRED_NODE_VERSION,
  resolveLinuxAmd64Image,
  sha256Bytes,
  verifySha256WithSystemTool,
} from "./release-replica-qualification.ts";

describe("release replica qualification", () => {
  test("locks the previous release digests to published v0.10.35 evidence", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/release-replica-v0.10.35.json", import.meta.url),
        "utf8",
      ),
    ) as {
      version: string;
      sourceCommit: string;
      releaseManifest: {
        assetId: number;
        sha256: string;
        size: number;
      };
      buildRun: { id: number; attempt: number };
      images: Record<"worker" | "agent" | "runtime", { digest: string }>;
    };
    const workflow = readFileSync(
      new URL(
        "../.github/workflows/release-replica-qualification.yml",
        import.meta.url,
      ),
      "utf8",
    );

    expect(fixture).toMatchObject({
      version: "0.10.35",
      sourceCommit: "d2dbcb406e6a8871e4c0b8bf243afc978331f323",
      releaseManifest: {
        assetId: 482077911,
        sha256:
          "62163dbc722b7acca61fe07f7f9707dd0f89383e5e49c5cd39c7edb75fd403c3",
        size: 23567,
      },
      buildRun: { id: 29673093536, attempt: 1 },
    });
    expect(fixture.images.agent.digest).toBe(
      "sha256:8e01bf1a2eb3530d8ed941acc455ebe01e021e9e025eaa5bfe1119dd8647c0d6",
    );
    for (const [name, envName] of [
      ["worker", "PREVIOUS_WORKER_DIGEST"],
      ["agent", "PREVIOUS_AGENT_DIGEST"],
      ["runtime", "PREVIOUS_RUNTIME_DIGEST"],
    ] as const) {
      expect(workflow).toContain(
        `  ${envName}: ${fixture.images[name].digest}\n`,
      );
    }
    expect(workflow).not.toContain(
      "sha256:8e01bf1a2eb3530b8ed941acc455ebe01e021e9e025eaa5bfe1119dd8647c0d6",
    );
  });

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

  test("compares SHA-256 authority without runtime string equality", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 255]);
    expect(compareSha256Bytes(bytes, sha256Bytes(bytes))).toEqual({
      actualDigest: sha256Bytes(bytes),
      matches: true,
      firstDifference: -1,
      actualCharCode: null,
      expectedCharCode: null,
    });
    const digest = sha256Bytes(bytes);
    const changed = `${digest.slice(0, -1)}${digest.endsWith("0") ? "1" : "0"}`;
    const mismatch = compareSha256Bytes(bytes, changed);
    expect(mismatch.matches).toBe(false);
    expect(mismatch.firstDifference).toBeGreaterThanOrEqual(0);
    expect(compareSha256Bytes("replica", sha256Bytes("replica")).matches).toBe(
      true,
    );
  });

  test("compares the published digest as strict ASCII code units", () => {
    const published =
      "sha256:8e01bf1a2eb3530d8ed941acc455ebe01e021e9e025eaa5bfe1119dd8647c0d6";
    const hexadecimal = published.slice("sha256:".length);
    expect(compareCanonicalSha256Hex(hexadecimal, hexadecimal)).toEqual({
      matches: true,
      firstDifference: -1,
      actualCharCode: null,
      expectedCharCode: null,
    });
    const changed = `${hexadecimal.slice(0, 15)}e${hexadecimal.slice(16)}`;
    expect(compareCanonicalSha256Hex(hexadecimal, changed)).toEqual({
      matches: false,
      firstDifference: 15,
      actualCharCode: "d".charCodeAt(0),
      expectedCharCode: "e".charCodeAt(0),
    });
    expect(() =>
      compareCanonicalSha256Hex("A".repeat(64), hexadecimal),
    ).toThrow("calculated SHA-256 is not canonical lowercase hex");
  });

  test("uses a private file as the digest authority", () => {
    const body = new Uint8Array([0, 1, 2, 3, 13, 255]);
    const directory = mkdtempSync(join(tmpdir(), "takos-authority-test-"));
    const authority = join(directory, "candidate-manifest.digest");
    try {
      chmodSync(directory, 0o700);
      writeFileSync(authority, `${sha256Bytes(body)}\n`, { mode: 0o600 });
      chmodSync(authority, 0o600);
      const verifiedPath = digestAuthorityPath(
        directory,
        "candidate-manifest.digest",
      );
      expect(
        readDigestAuthority(directory, "candidate-manifest.digest"),
      ).toEqual({ path: verifiedPath, digest: sha256Bytes(body) });
      expect(
        verifySha256WithSystemTool(body, sha256Bytes(body), verifiedPath),
      ).toBe(true);
      expect(() =>
        verifySha256WithSystemTool(
          body,
          `sha256:${"0".repeat(64)}`,
          verifiedPath,
        ),
      ).toThrow("digest authority input does not match the expected digest");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("locks qualification to the canonical control migration inventory", () => {
    expect(CONTROL_MIGRATION_DIRECTORY).toBe(
      "db/migrations-control/migrations",
    );
    expect(migrationInventoryDirectory("/candidate/source")).toBe(
      "/candidate/source/db/migrations-control/migrations",
    );
  });

  test("locks the replica controller to the reviewed Node toolchain", () => {
    expect(REQUIRED_NODE_VERSION).toBe("v24.18.0");
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
      rawIndexBodySize: rawIndex.byteLength,
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
    const expectedDigest = sha256Bytes(body);
    expect(exactRegistryBody(body, expectedDigest)).toEqual({
      body,
      rawIndexBodySize: body.byteLength,
      transportSize: body.byteLength,
      trailingLineFeedRemoved: false,
    });

    const withLineFeed = new Uint8Array([...body, 0x0a]);
    expect(exactRegistryBody(withLineFeed, expectedDigest)).toEqual({
      body,
      rawIndexBodySize: body.byteLength,
      transportSize: body.byteLength + 1,
      trailingLineFeedRemoved: true,
    });
    expect(exactRegistryBody(withLineFeed, sha256Bytes(withLineFeed))).toEqual({
      body: withLineFeed,
      rawIndexBodySize: withLineFeed.byteLength,
      transportSize: withLineFeed.byteLength,
      trailingLineFeedRemoved: false,
    });

    for (const invalid of [
      new Uint8Array([...body, 0x0d, 0x0a]),
      new Uint8Array([...body, 0x0a, 0x0a]),
      new Uint8Array([...body, 0x20]),
      body.slice(0, -1),
    ]) {
      expect(() => exactRegistryBody(invalid, expectedDigest)).toThrow(
        "exactly one published body",
      );
    }
  });

  test("rejects invalid published digests and raw transport sizes", () => {
    const body = new TextEncoder().encode('{"schemaVersion":2}');
    expect(() => exactRegistryBody(body, `sha256:${"x".repeat(64)}`)).toThrow(
      "published OCI index digest is invalid",
    );
    expect(() =>
      exactRegistryBody(new Uint8Array(), sha256Bytes(body)),
    ).toThrow("transport size is invalid");
    const oversizedBody = new Uint8Array(10 * 1024 * 1024 + 1);
    expect(() =>
      exactRegistryBody(oversizedBody, sha256Bytes(oversizedBody)),
    ).toThrow("verified raw OCI index body exceeds");
    expect(() =>
      exactRegistryBody(
        new Uint8Array(10 * 1024 * 1024 + 2),
        sha256Bytes(body),
      ),
    ).toThrow("transport size is invalid");
  });
});
