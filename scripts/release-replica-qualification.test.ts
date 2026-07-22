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
  canonicalPostgresSchemaDump,
  compareCanonicalSha256Hex,
  compareSha256Bytes,
  CONTROL_MIGRATION_DIRECTORY,
  digestAuthorityPath,
  exactRawManifestInspectCommand,
  exactRegistryBody,
  exactDigestRef,
  hostSecurityQualifies,
  migrationInventoryDirectory,
  POSTGRES_SCHEMA_CANONICALIZATION,
  PREVIOUS_VERSION,
  readDigestAuthority,
  replicaNamePrefix,
  REQUIRED_NODE_VERSION,
  resolveLinuxAmd64Image,
  sha256Bytes,
  verifyPlatformChildManifest,
  verifySha256WithSystemTool,
} from "./release-replica-qualification.ts";

describe("release replica qualification", () => {
  test("normalizes only pg_dump's matched random restriction pair", () => {
    const dump = (token: string, ddl = "CREATE TABLE example (id integer);") =>
      [
        "-- PostgreSQL database dump",
        "",
        `\\restrict ${token}`,
        "",
        ddl,
        "",
        `\\unrestrict ${token}`,
        "",
      ].join("\n");
    const first = dump(
      "3PCSOAXrPN7mz5fM4yNoaw9uQSkeuo7s978mTer9Lo6KzgiDm62q1IwdnE4z7kA",
    );
    const second = dump(
      "BHzqEQkyk1rOK3bMnwEpUSbhdZpuHriE9XdkjzsYVNQ4nfzRF7VM2dj4cUf5XU8",
    );

    expect(POSTGRES_SCHEMA_CANONICALIZATION).toBe("pg_dump-restrict-pair-v1");
    expect(sha256Bytes(first)).not.toBe(sha256Bytes(second));
    expect(sha256Bytes(canonicalPostgresSchemaDump(first))).toBe(
      sha256Bytes(canonicalPostgresSchemaDump(second)),
    );
    expect(
      sha256Bytes(
        canonicalPostgresSchemaDump(
          dump(
            "BHzqEQkyk1rOK3bMnwEpUSbhdZpuHriE9XdkjzsYVNQ4nfzRF7VM2dj4cUf5XU8",
            "CREATE TABLE example (id bigint);",
          ),
        ),
      ),
    ).not.toBe(sha256Bytes(canonicalPostgresSchemaDump(first)));
    expect(
      canonicalPostgresSchemaDump("CREATE TABLE stable (id integer);"),
    ).toBe("CREATE TABLE stable (id integer);");
    expect(() =>
      canonicalPostgresSchemaDump(
        "\\restrict opening\n\\unrestrict different\n",
      ),
    ).toThrow("pg_dump restriction token pair drifted");
    expect(() => canonicalPostgresSchemaDump("\\restrict only\n")).toThrow(
      "pg_dump restriction line count drifted",
    );
    expect(() =>
      canonicalPostgresSchemaDump("\\restrict unexpected-token!\n"),
    ).toThrow("pg_dump restriction line format drifted");
  });

  test("locks the previous release digests to the latest stable v0.10.35 evidence", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/release-replica-v0.10.35.json", import.meta.url),
        "utf8",
      ),
    ) as {
      version: string;
      sourceCommit: string;
      release: {
        tag: string;
        tagCommit: string;
        publishedAt: string;
        immutable: boolean;
        authority: string;
        assets: Array<{ name: string; digest: string; size: number }>;
      };
      buildRun: { id: number; attempt: number };
      images: Record<
        "worker" | "agent" | "runtime",
        { repository: string; digest: string }
      >;
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
      release: {
        tag: "v0.10.35",
        tagCommit: "d17c4baee4e2f500cdb61d6298bd67fc887147b2",
        publishedAt: "2026-07-19T04:21:13Z",
        immutable: false,
        authority: "replica-comparison-only",
      },
      buildRun: { id: 29673093536, attempt: 1 },
      images: {
        worker: { repository: "ghcr.io/tako0614/takos-worker" },
        agent: { repository: "ghcr.io/tako0614/takos-agent" },
        runtime: {
          repository: "ghcr.io/tako0614/takos-worker-runtime",
        },
      },
    });
    expect(PREVIOUS_VERSION).toBe(fixture.version);
    expect(fixture.images.agent.digest).toBe(
      "sha256:8e01bf1a2eb3530d8ed941acc455ebe01e021e9e025eaa5bfe1119dd8647c0d6",
    );
    expect(fixture.release.immutable).toBe(false);
    expect(fixture.release.authority).toBe("replica-comparison-only");
    expect(fixture.release.assets.map((asset) => asset.name)).toEqual([
      "install-config-patch.json",
      "release-manifest.json",
      "takos-worker-release.tar.gz",
      "takos-worker-release.tar.gz.sha256",
      "takosumi-artifact.json",
    ]);
    for (const [name, envName] of [
      ["worker", "PREVIOUS_WORKER_DIGEST"],
      ["agent", "PREVIOUS_AGENT_DIGEST"],
      ["runtime", "PREVIOUS_RUNTIME_DIGEST"],
    ] as const) {
      expect(workflow).toContain(
        `  ${envName}: ${fixture.images[name].digest}\n`,
      );
    }
    for (const unpublishedCandidateDigest of [
      "sha256:77b766e2d90d5aa51d9bff79c39794c3731e8609810d55749928c4ce9d4cb33a",
      "sha256:be681bb79a274270b8f6399bb2bd3ac15cbcaafda5bdd6b17007d6b8c369e9e8",
      "sha256:88a638e5f5a904585d71020aaa2fd20649148e08997435437a3b8275bf1d958d",
    ]) {
      expect(workflow).not.toContain(unpublishedCandidateDigest);
    }
    expect(workflow).toContain(
      '--output "${GITHUB_WORKSPACE}/evidence/local-docker-qualification.json"',
    );
    expect(workflow).toContain("sha256sum local-docker-qualification.json");
    expect(workflow).not.toContain(
      "sha256sum evidence/local-docker-qualification.json",
    );
    expect(workflow).not.toContain("release-replica-qualification.json");
  });

  test("reads both OCI index and selected child only through exact digest refs", () => {
    const reference = `ghcr.io/tako0614/takos-worker@sha256:${"a".repeat(64)}`;
    expect(exactRawManifestInspectCommand(reference)).toEqual([
      "docker",
      "buildx",
      "imagetools",
      "inspect",
      reference,
      "--raw",
    ]);
    expect(() =>
      exactRawManifestInspectCommand("ghcr.io/tako0614/takos-worker:0.10.35"),
    ).toThrow("digest-pinned");
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
    expect(replicaNamePrefix("release-id")).toMatch(
      /^takos-replica-[0-9a-f]{12}$/,
    );
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

  test("verifies the selected platform manifest bytes against the child digest", () => {
    const manifest = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        config: {
          mediaType: "application/vnd.oci.image.config.v1+json",
          digest: `sha256:${"a".repeat(64)}`,
          size: 1,
        },
        layers: [],
      }),
    );
    const digest = sha256Bytes(manifest);
    const executionImage = `ghcr.io/tako0614/takos-agent@${digest}`;
    expect(verifyPlatformChildManifest(executionImage, manifest)).toEqual({
      childManifestDigest: digest,
      childManifestBodySize: manifest.byteLength,
      childManifestTransportSize: manifest.byteLength,
      childManifestTrailingLineFeedRemoved: false,
    });
    expect(() =>
      verifyPlatformChildManifest(
        executionImage,
        new Uint8Array([...manifest, 0x20]),
      ),
    ).toThrow("selected platform manifest digest drifted");
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
