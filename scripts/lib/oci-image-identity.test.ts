import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertDockerImageIdentity, imageIdentity, type ImageIdentity, type Options } from "./oci-image-identity.ts";

const TEST_TEMP_ROOT = join(import.meta.dir, "../../tmp/oci-image-identity-tests");
const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const REFERENCE = "takos-local";
const REVISION_LABEL = "org.opencontainers.image.revision";

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function fixture(options: { revision?: string; duplicateTag?: boolean } = {}): Promise<{ root: string; identityOptions: Options; layer: Uint8Array }> {
  await mkdir(TEST_TEMP_ROOT, { recursive: true });
  const root = await mkdtemp(join(TEST_TEMP_ROOT, "oci-fixture-"));
  const blobs = join(root, "blobs", "sha256");
  await mkdir(blobs, { recursive: true });
  const layerContent = new TextEncoder().encode("tiny generated root filesystem layer");
  const layer = new Uint8Array(gzipSync(layerContent));
  const layerDigest = digest(layer);
  await writeFile(join(blobs, layerDigest.slice(7)), layer);

  const configBytes = new TextEncoder().encode(JSON.stringify({
    architecture: "amd64",
    os: "linux",
    rootfs: { type: "layers", diff_ids: [digest(layerContent)] },
    config: {
      User: "takos",
      WorkingDir: "/app",
      Cmd: ["/usr/local/bin/takos-agent"],
      Labels: options.revision ? { [REVISION_LABEL]: options.revision } : {},
    },
  }));
  const configDigest = digest(configBytes);
  await writeFile(join(blobs, configDigest.slice(7)), configBytes);

  const manifestBytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: configDigest, size: configBytes.byteLength },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: layerDigest, size: layer.byteLength }],
  }));
  const manifestDigest = digest(manifestBytes);
  await writeFile(join(blobs, manifestDigest.slice(7)), manifestBytes);
  const descriptor = {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: manifestDigest,
    size: manifestBytes.byteLength,
    annotations: { "org.opencontainers.image.ref.name": REFERENCE },
  };
  const manifests = options.duplicateTag ? [descriptor, descriptor] : [descriptor];
  await writeFile(join(root, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }));
  await writeFile(join(root, "index.json"), JSON.stringify({ schemaVersion: 2, manifests }));
  return {
    root,
    layer,
    identityOptions: { layout: root, reference: REFERENCE, sourceCommit: SOURCE_COMMIT },
  };
}

async function withFixture(run: (created: Awaited<ReturnType<typeof fixture>>) => Promise<void>, options: Parameters<typeof fixture>[0] = {}): Promise<void> {
  const created = await fixture(options);
  try {
    await run(created);
  } finally {
    await rm(created.root, { recursive: true, force: true });
  }
}

function dockerImage(verified: ImageIdentity, id = verified.configDigest): Record<string, unknown> {
  return {
    Id: id,
    Descriptor: { digest: verified.manifestDigest },
    RepoDigests: [],
    Os: "linux",
    Architecture: "amd64",
    Config: { User: verified.imageUser, Cmd: verified.imageCmd, WorkingDir: verified.imageWorkdir },
    RootFS: { Type: "layers", Layers: [...verified.rootfsDiffIds] },
  };
}

test("verifies selected OCI manifest, compressed blob, gzip diffID, and operator-supplied identity", async () => {
  await withFixture(async ({ identityOptions, layer }) => {
    const identity = await imageIdentity(identityOptions);
    expect(identity.sourceCommit).toBe(SOURCE_COMMIT);
    expect(identity.sourceCommitEvidence).toBe("operator-supplied build identity; image has no revision label");
    expect(identity.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(identity.configDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(identity.layerDigests).toEqual([digest(layer)]);
    expect(identity.rootfsDiffIds).toEqual([digest(new TextEncoder().encode("tiny generated root filesystem layer"))]);
    expect(identity.platform).toBe("linux/amd64");
    expect(identity.imageUser).toBe("takos");
    expect(identity.imageCmd).toEqual(["/usr/local/bin/takos-agent"]);
    expect(identity.imageWorkdir).toBe("/app");
  });
});

test("rejects a selected manifest that differs from the expected digest", async () => {
  await withFixture(async ({ identityOptions }) => {
    await expect(imageIdentity({ ...identityOptions, expectedManifestDigest: `sha256:${"f".repeat(64)}` }))
      .rejects.toThrow("selected manifest differs from expected digest");
  });
});

test("requires a unique tag resolution", async () => {
  await withFixture(async ({ identityOptions }) => {
    await expect(imageIdentity(identityOptions)).rejects.toThrow("must resolve to exactly one manifest");
  }, { duplicateTag: true });
});

test("rejects an embedded revision that differs from the asserted source commit", async () => {
  await withFixture(async ({ identityOptions }) => {
    await expect(imageIdentity(identityOptions)).rejects.toThrow("embedded source revision differs from asserted commit");
  }, { revision: "f".repeat(40) });
});

test("marks a matching embedded revision as image config evidence", async () => {
  await withFixture(async ({ identityOptions }) => {
    const identity = await imageIdentity(identityOptions);
    expect(identity.sourceCommitEvidence).toBe("image config revision label");
  }, { revision: SOURCE_COMMIT });
});

test("rejects a corrupted compressed layer blob", async () => {
  await withFixture(async ({ identityOptions, root, layer }) => {
    const index = JSON.parse(await readFile(join(root, "index.json"), "utf8")) as { manifests: Array<{ digest: string }> };
    const manifest = JSON.parse(await readFile(join(root, "blobs", "sha256", index.manifests[0]!.digest.slice(7)), "utf8")) as { layers: Array<{ digest: string }> };
    const layerPath = join(root, "blobs", "sha256", manifest.layers[0]!.digest.slice(7));
    const corrupted = new Uint8Array(layer);
    corrupted[corrupted.length - 1] ^= 0xff;
    await writeFile(layerPath, corrupted);
    await expect(imageIdentity(identityOptions)).rejects.toThrow("does not match manifest");
  });
});

test("accepts a legacy Docker config ID bound to the verified OCI manifest", async () => {
  await withFixture(async ({ identityOptions }) => {
    const verified = await imageIdentity(identityOptions);
    expect(() => assertDockerImageIdentity(dockerImage(verified), verified, verified.configDigest)).not.toThrow();
  });
});

test("accepts a containerd Docker manifest ID with RepoDigests as the manifest witness", async () => {
  await withFixture(async ({ identityOptions }) => {
    const verified = await imageIdentity(identityOptions);
    const raw = dockerImage(verified, verified.manifestDigest);
    raw.Descriptor = null;
    raw.RepoDigests = [`registry.example/takos@${verified.manifestDigest}`];
    expect(() => assertDockerImageIdentity(raw, verified, verified.manifestDigest)).not.toThrow();
  });
});

test("rejects a Docker image ID that differs from the expected ID", async () => {
  await withFixture(async ({ identityOptions }) => {
    const verified = await imageIdentity(identityOptions);
    const raw = dockerImage(verified, verified.manifestDigest);
    expect(() => assertDockerImageIdentity(raw, verified, verified.configDigest)).toThrow("Docker image ID differs from expected identity");
  });
});

test("rejects an expected Docker image ID unrelated to the verified config and manifest", async () => {
  await withFixture(async ({ identityOptions }) => {
    const verified = await imageIdentity(identityOptions);
    const unrelated = `sha256:${"f".repeat(64)}`;
    expect(() => assertDockerImageIdentity(dockerImage(verified, unrelated), verified, unrelated))
      .toThrow("expected Docker image ID is not bound to verified OCI config or manifest");
  });
});

test("requires a descriptor or repository digest witness for the verified manifest", async () => {
  await withFixture(async ({ identityOptions }) => {
    const verified = await imageIdentity(identityOptions);
    const raw = dockerImage(verified);
    raw.Descriptor = { digest: `sha256:${"f".repeat(64)}` };
    raw.RepoDigests = ["registry.example/takos@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"];
    expect(() => assertDockerImageIdentity(raw, verified, verified.configDigest))
      .toThrow("Docker descriptor digest differs from verified manifest");
  });
});

test("rejects a contradictory descriptor even when RepoDigests names the verified manifest", async () => {
  await withFixture(async ({ identityOptions }) => {
    const verified = await imageIdentity(identityOptions);
    const raw = dockerImage(verified);
    raw.Descriptor = { digest: `sha256:${"f".repeat(64)}` };
    raw.RepoDigests = [`registry.example/takos@${verified.manifestDigest}`];
    expect(() => assertDockerImageIdentity(raw, verified, verified.configDigest))
      .toThrow("Docker descriptor digest differs from verified manifest");
  });
});

test("requires exact verified rootfs diff IDs", async () => {
  await withFixture(async ({ identityOptions }) => {
    const verified = await imageIdentity(identityOptions);
    const raw = dockerImage(verified);
    raw.RootFS = { Type: "layers", Layers: [`sha256:${"f".repeat(64)}`] };
    expect(() => assertDockerImageIdentity(raw, verified, verified.configDigest))
      .toThrow("Docker image rootfs diff IDs differ from verified OCI config");
  });
});

test("requires matching Linux amd64 execution metadata", async () => {
  await withFixture(async ({ identityOptions }) => {
    const verified = await imageIdentity(identityOptions);
    const wrongPlatform = dockerImage(verified);
    wrongPlatform.Architecture = "arm64";
    expect(() => assertDockerImageIdentity(wrongPlatform, verified, verified.configDigest)).toThrow("Docker image must be Linux amd64");

    for (const field of ["User", "Cmd", "WorkingDir"] as const) {
      const wrongConfig = dockerImage(verified);
      const config = wrongConfig.Config as Record<string, unknown>;
      config[field] = field === "Cmd" ? ["/bin/sh"] : "mismatch";
      expect(() => assertDockerImageIdentity(wrongConfig, verified, verified.configDigest))
        .toThrow("Docker image User, Workdir, or Cmd differs from verified OCI config");
    }
  });
});
