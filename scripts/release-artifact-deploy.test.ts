import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  assertImageContentMatch,
  assertPublishedReleaseReadback,
  assertPublicAgentReadback,
  createOnlyReleaseAfterFinalAbsence,
  createOnlyReleaseCommand,
  isolatedDockerEnv,
  publicPrepareResult,
  publicPublishResult,
  RELEASE_ARTIFACT_USAGE,
  TAKOS_RELEASE_ARTIFACT_SURFACE,
  parseReleaseArtifactArgs,
  runReleaseArtifact,
} from "./release-artifact-deploy.ts";

test("release publication is Takos-owned and has no legacy product input", async () => {
  const source = await readFile(
    join(import.meta.dir, "release-artifact-deploy.ts"),
    "utf8",
  );
  expect(source).toContain('filename: "takos-artifact.json"');
  expect(source).toContain('kind: "takos.worker-artifact@v3"');
});

test("deploy exposes only the Takos release-artifact publication surface", async () => {
  const source = await readFile(join(import.meta.dir, "deploy.mjs"), "utf8");
  expect(source).not.toContain("takos-product-materialization");
  expect(source).not.toContain("product:activate");
  expect(source).not.toContain("product:pre-destroy");
});

const commit = "a".repeat(40);
const accountId = "b".repeat(32);
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const imageContent = {
  configDigest: digest("f"),
  layerDigests: [digest("1"), digest("2")],
} as const;
async function packageVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(join(import.meta.dir, "../package.json"), "utf8"),
  ) as { version: string };
  return packageJson.version;
}

async function privateFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

function installReadOnlyCommandStub(expectedCommit: string): {
  calls: string[][];
  restore: () => void;
} {
  const calls: string[][] = [];
  const originalSpawn = Bun.spawn;
  const bunRuntime = Bun as unknown as { spawn: typeof Bun.spawn };
  const repositoryRoot = join(import.meta.dir, "..");
  const physicalProofPath = "AGENTS.md";
  const physicalProofBytes = readFileSync(join(repositoryRoot, physicalProofPath));
  const physicalProofObjectId = createHash("sha1")
    .update(`blob ${physicalProofBytes.byteLength}\0`)
    .update(physicalProofBytes)
    .digest("hex");
  bunRuntime.spawn = ((argv: readonly string[]) => {
    const command = [...argv];
    calls.push(command);
    const executable = command[0];
    const args = command.slice(1);
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    if (executable === "git") {
      if (args[0] === "status") {
        stdout = "";
      } else if (args[0] === "ls-files") {
        stdout = `H ${physicalProofPath}\0`;
      } else if (args[0] === "ls-tree") {
        stdout = `100644 blob ${physicalProofObjectId}\t${physicalProofPath}\0`;
      } else if (args[0] === "branch") {
        stdout = "main\n";
      } else if (
        args[0] === "rev-parse" &&
        (args[1] === "HEAD" || args[1] === "origin/main")
      ) {
        stdout = `${expectedCommit}\n`;
      } else if (
        args[0] === "rev-parse" &&
        args[1] === "--show-toplevel"
      ) {
        stdout = `${repositoryRoot}\n`;
      } else if (
        args[0] === "rev-parse" &&
        args[1] === "--show-object-format"
      ) {
        stdout = "sha1\n";
      } else if (
        args[0] === "remote" &&
        args[1] === "get-url" &&
        args[2] === "origin"
      ) {
        stdout = "https://github.com/tako0614/takos.git\n";
      } else if (
        args[0] === "ls-remote" &&
        args.includes("refs/heads/main")
      ) {
        stdout = `${expectedCommit}\trefs/heads/main\n`;
      } else if (
        args[0] === "ls-remote" &&
        args.some((argument) => argument.startsWith("refs/tags/"))
      ) {
        stdout = "";
      } else {
        throw new Error(`unexpected git command in dry-run: ${command.join(" ")}`);
      }
    } else if (
      executable === "gh" &&
      args[0] === "release" &&
      args[1] === "view"
    ) {
      exitCode = 1;
      stderr = "release not found";
    } else {
      throw new Error(`unexpected command in dry-run: ${command.join(" ")}`);
    }

    return {
      stdout: new Blob([stdout]).stream(),
      stderr: new Blob([stderr]).stream(),
      exited: Promise.resolve(exitCode),
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;

  return {
    calls,
    restore: () => {
      bunRuntime.spawn = originalSpawn;
    },
  };
}

function expectNoMutationCommands(calls: readonly string[][]): void {
  expect(
    calls.some((command) => {
      const [executable, first, second] = command;
      return (
        (executable === "git" && (first === "push" || first === "tag")) ||
        (executable === "gh" &&
          first === "release" &&
          (second === "create" || second === "upload" || second === "edit")) ||
        executable === "wrangler" ||
        executable === "docker" ||
        executable === "bun" ||
        executable === "bunx"
      );
    }),
  ).toBe(false);
}

test("parses prepare and publish arguments with dry-run as the default", () => {
  expect(
    parseReleaseArtifactArgs([
      "prepare",
      "--tag",
      "v0.11.0",
      "--config",
      "/private/wrangler.toml",
      "--account-id-file",
      "/private/account-id",
      "--cloudflare-api-token-file",
      "/private/token",
      "--output-dir",
      "/private/output",
      "--evidence",
      "/private/prepare.json",
    ]),
  ).toEqual({
    phase: "prepare",
    tag: "v0.11.0",
    config: "/private/wrangler.toml",
    accountIdFile: "/private/account-id",
    tokenFile: "/private/token",
    outputDir: "/private/output",
    evidence: "/private/prepare.json",
    execute: false,
  });

  expect(
    parseReleaseArtifactArgs([
      "publish",
      "--tag",
      "v0.11.0",
      "--prepare-evidence",
      "/private/prepare.json",
      "--evidence",
      "/private/publish.json",
      "--execute",
    ]),
  ).toMatchObject({
    phase: "publish",
    tag: "v0.11.0",
    prepareEvidence: "/private/prepare.json",
    evidence: "/private/publish.json",
    execute: true,
  });
});

test("rejects phase-specific, duplicate, and malformed arguments", () => {
  expect(() =>
    parseReleaseArtifactArgs([
      "prepare",
      "--tag",
      "v0.11.0",
      "--config",
      "/private/wrangler.toml",
      "--account-id-file",
      "/private/account-id",
      "--cloudflare-api-token-file",
      "/private/token",
      "--output-dir",
      "/private/output",
      "--evidence",
      "/private/prepare.json",
      "--prepare-evidence",
      "/private/other.json",
    ]),
  ).toThrow("--prepare-evidence is publish-only");
  expect(() =>
    parseReleaseArtifactArgs([
      "publish",
      "--tag",
      "v0.11.0",
      "--prepare-evidence",
      "/private/prepare.json",
      "--evidence",
      "/private/publish.json",
      "--evidence",
      "/private/other.json",
    ]),
  ).toThrow("duplicate argument: --evidence");
  expect(() =>
    parseReleaseArtifactArgs([
      "publish",
      "--tag",
      "0.11.0",
      "--prepare-evidence",
      "/private/prepare.json",
      "--evidence",
      "/private/publish.json",
    ]),
  ).toThrow("--tag must be v-prefixed SemVer");
});

test("publishes a contract that requires provenance, readback, and no-overwrite", () => {
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE).toMatchObject({
    surface: "takos-release-artifact",
    target: "github-release-cloudflare-registry-and-public-oci:takos",
    triggers: ["published-identity", "authority", "irreversible"],
  });
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.requiresScripts).toEqual([
    "check",
    "deploy",
    "release-worker-artifact:build",
  ]);
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.covers).toContain(
    "scripts/check-physical-git-tree.ts",
  );
  for (const obligation of [
    "provenance",
    "post-conditions",
    "reversal",
    "failure-handling",
    "no-overwrite",
  ] as const) {
    expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations[obligation]).toEqual(
      expect.any(String),
    );
  }
  expect(RELEASE_ARTIFACT_USAGE).toContain(
    "Both phases are read-only without --execute.",
  );
  expect(RELEASE_ARTIFACT_USAGE).toContain(
    "Secret values and provider command\noutput are never written",
  );
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["no-overwrite"]).toContain(
    "create-only",
  );
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["no-overwrite"]).toContain(
    "exact canonical schema",
  );
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["failure-handling"]).toContain(
    "lost acknowledgment",
  );
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["post-conditions"]).toContain(
    "boots the exact downloaded Worker archive",
  );
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["post-conditions"]).toContain(
    "product discovery",
  );
  expect(
    TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["pre-mutation-proof"],
  ).toContain("local/live origin/main");
  expect(
    TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["pre-mutation-proof"],
  ).toContain("physical HEAD-tree byte/type/mode/symlink proof");
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["no-overwrite"]).toContain(
    "final tag and Release absence",
  );
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["failure-handling"]).toContain(
    "nonce-bound release",
  );
});

test("publication has one create-only command with the complete asset closure", () => {
  const assets = ["/private/worker.tgz", "/private/checksum", "/private/descriptor"];
  const command = createOnlyReleaseCommand(
    "v1.2.3",
    commit,
    assets,
    digest("7"),
  );

  expect(command.slice(0, 6)).toEqual([
    "release",
    "create",
    "v1.2.3",
    ...assets,
  ]);
  expect(command).toContain("--target");
  expect(command).toContain(commit);
  expect(command).not.toContain("--draft");
  expect(command).not.toContain("upload");
  expect(command).not.toContain("edit");
  expect(command.join("\n")).toContain(digest("7"));
});

test("authoritative release readback requires immutable state and exact digests", () => {
  const expected = [{ name: "worker.tgz", digest: digest("a") }];
  const exact = {
    isDraft: false,
    isPrerelease: false,
    isImmutable: true,
    tagName: "v1.2.3",
    name: "Takos v1.2.3",
    body:
      `Immutable Takos worker artifact for ${commit}.\n\n` +
      `Publication attempt: ${digest("7")}`,
    targetCommitish: commit,
    url: "https://github.com/tako0614/takos/releases/tag/v1.2.3",
    assets: expected,
  };

  expect(() =>
    assertPublishedReleaseReadback(
      "v1.2.3",
      commit,
      digest("7"),
      expected,
      exact,
    ),
  ).not.toThrow();
  expect(() =>
    assertPublishedReleaseReadback(
      "v1.2.3",
      commit,
      digest("7"),
      expected,
      {
        ...exact,
        isImmutable: false,
      },
    ),
  ).toThrow("state is not exact and immutable");
  expect(() =>
    assertPublishedReleaseReadback(
      "v1.2.3",
      commit,
      digest("7"),
      expected,
      {
        ...exact,
        assets: [{ name: "worker.tgz", digest: digest("b") }],
      },
    ),
  ).toThrow("asset closure or digest drifted");
  expect(() =>
    assertPublishedReleaseReadback(
      "v1.2.3",
      commit,
      digest("8"),
      expected,
      exact,
    ),
  ).toThrow("publication attempt");
});

test("final pre-create absence rejects a racing release with zero create calls", async () => {
  const stub = installFinalReleaseRaceStub("preexisting");
  try {
    await expect(
      createOnlyReleaseAfterFinalAbsence(
        join(import.meta.dir, ".."),
        "v1.2.3",
        commit,
        [{ name: "worker.tgz", path: "/private/worker.tgz", digest: digest("a") }],
      ),
    ).rejects.toThrow("GitHub release already exists");
    expect(stub.calls.filter(isReleaseCreateCommand)).toEqual([]);
  } finally {
    stub.restore();
  }
});

test("a spawned create with a lost acknowledgment adopts only its nonce-bound exact readback", async () => {
  const stub = installFinalReleaseRaceStub("lost-acknowledgment");
  try {
    const result = await createOnlyReleaseAfterFinalAbsence(
      join(import.meta.dir, ".."),
      "v1.2.3",
      commit,
      [{ name: "worker.tgz", path: "/private/worker.tgz", digest: digest("a") }],
    );
    expect(result.publicationAcknowledgment).toBe(
      "lost-acknowledgment-read-back",
    );
    expect(stub.calls.filter(isReleaseCreateCommand)).toHaveLength(1);
    expect(result.release.body).toContain(result.publicationAttempt);
  } finally {
    stub.restore();
  }
});

test("a racing identity created after final absence cannot masquerade as lost acknowledgment", async () => {
  const stub = installFinalReleaseRaceStub("raced-before-spawn");
  try {
    await expect(
      createOnlyReleaseAfterFinalAbsence(
        join(import.meta.dir, ".."),
        "v1.2.3",
        commit,
        [{ name: "worker.tgz", path: "/private/worker.tgz", digest: digest("a") }],
      ),
    ).rejects.toThrow("does not belong to this publication attempt");
    expect(stub.calls.filter(isReleaseCreateCommand)).toHaveLength(1);
  } finally {
    stub.restore();
  }
});

test("a create process that never spawned cannot adopt a racing identity", async () => {
  const stub = installFinalReleaseRaceStub("spawn-failed");
  try {
    await expect(
      createOnlyReleaseAfterFinalAbsence(
        join(import.meta.dir, ".."),
        "v1.2.3",
        commit,
        [{ name: "worker.tgz", path: "/private/worker.tgz", digest: digest("a") }],
      ),
    ).rejects.toThrow("simulated pre-spawn failure");
    expect(stub.calls.filter(isReleaseViewCommand)).toHaveLength(1);
  } finally {
    stub.restore();
  }
});

test("release publisher never copies local Rust target caches into its build context", async () => {
  const source = await readFile(
    join(import.meta.dir, "release-artifact-deploy.ts"),
    "utf8",
  );
  expect(source).not.toContain('cp(\n    join(root, "containers/agent")');
  expect(source).toContain(
    'for (const name of ["Cargo.toml", "Cargo.lock", "Dockerfile"]',
  );
  expect(source).toContain('await cp(join(source, "src")');
});

test("registry authentication always receives an isolated Docker config", () => {
  const base = {
    DOCKER_CONFIG: "/operator/default-docker",
    DOCKER_AUTH_CONFIG: '{"auths":{}}',
  };
  const isolated = isolatedDockerEnv(base, "/tmp/release/cloudflare-docker");
  expect(isolated.DOCKER_CONFIG).toBe("/tmp/release/cloudflare-docker");
  expect(isolated.DOCKER_AUTH_CONFIG).toBeUndefined();
  expect(base.DOCKER_CONFIG).toBe("/operator/default-docker");
  expect(base.DOCKER_AUTH_CONFIG).toBe('{"auths":{}}');
});

test("cross-registry image content drift fails closed", () => {
  expect(() =>
    assertImageContentMatch(imageContent, {
      configDigest: imageContent.configDigest,
      layerDigests: [imageContent.layerDigests[0], digest("3")],
    }),
  ).toThrow("content identities differ");
  expect(() =>
    assertImageContentMatch(imageContent, {
      configDigest: digest("e"),
      layerDigests: imageContent.layerDigests,
    }),
  ).toThrow("content identities differ");
});

test("publish readback fails closed when GHCR digest or content drifts", () => {
  const reference = `ghcr.io/tako0614/takos-agent@${digest("a")}`;
  expect(() =>
    assertPublicAgentReadback(reference, imageContent, {
      manifestDigest: digest("b"),
      content: imageContent,
    }),
  ).toThrow("anonymous readback drifted");
  expect(() =>
    assertPublicAgentReadback(reference, imageContent, {
      manifestDigest: digest("a"),
      content: {
        configDigest: imageContent.configDigest,
        layerDigests: [digest("3")],
      },
    }),
  ).toThrow("anonymous content drifted");
});

test("prepare dry-run performs identity reads only and leaves evidence/output absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-release-artifact-test-"));
  const stub = installReadOnlyCommandStub(commit);
  try {
    const config = join(root, "wrangler.toml");
    const accountFile = join(root, "account-id");
    const tokenFile = join(root, "cloudflare-api-token");
    const outputDir = join(root, "output");
    const evidence = join(root, "prepare.json");
    await privateFile(config, "name = \"takos-test\"\n");
    await privateFile(accountFile, `${accountId}\n`);
    await privateFile(tokenFile, `${"token".repeat(8)}\n`);

    const result = await runReleaseArtifact(
      {
        phase: "prepare",
        tag: `v${await packageVersion()}`,
        config,
        accountIdFile: accountFile,
        tokenFile,
        outputDir,
        evidence,
        execute: false,
      },
    );

    expect(result).toMatchObject({
      kind: "takos.release-artifact-prepare@v2",
      status: "planned",
      commit,
      accountId,
    });
    expect(JSON.stringify(result)).not.toContain(root);
    await expect(stat(evidence)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(outputDir)).rejects.toMatchObject({ code: "ENOENT" });
    expectNoMutationCommands(stub.calls);
  } finally {
    stub.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("publish dry-run verifies prepared bytes and performs no tag/release mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-release-artifact-test-"));
  const stub = installReadOnlyCommandStub(commit);
  try {
    const version = await packageVersion();
    const fixture = await publishFixture(root, version);
    const publishEvidence = join(root, "publish.json");

    const result = await runReleaseArtifact(
      {
        phase: "publish",
        tag: `v${version}`,
        prepareEvidence: fixture.prepareEvidence,
        evidence: publishEvidence,
        execute: false,
      },
    );

    expect(result).toMatchObject({
      kind: "takos.release-artifact-publish@v2",
      status: "planned",
      commit,
      descriptor: {
        filename: "takos-artifact.json",
        digest: fixture.prepared.descriptor.digest,
        size: fixture.prepared.descriptor.size,
        url: fixture.prepared.descriptor.url,
      },
    });
    expect(JSON.stringify(result)).not.toContain(root);
    await expect(stat(publishEvidence)).rejects.toMatchObject({ code: "ENOENT" });
    expectNoMutationCommands(stub.calls);
  } finally {
    stub.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("prepare and publish public JSON exclude every operator-private path marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-release-public-result-test-"));
  try {
    const fixture = await publishFixture(root, await packageVersion());
    const privateMarkers = {
      outputDir: fixture.outputDir,
      descriptorPath: fixture.descriptorPath,
      archivePath: fixture.assetPath,
      checksumPath: fixture.checksumPath,
      prepareEvidence: fixture.prepareEvidence,
      publishEvidence: join(root, "PRIVATE-PUBLISH-EVIDENCE.json"),
      configPath: join(root, "PRIVATE-WRANGLER.toml"),
      tokenPath: join(root, "PRIVATE-TOKEN"),
      accountPath: join(root, "PRIVATE-ACCOUNT"),
    };
    const preparedWithPrivateInputs = {
      ...fixture.prepared,
      ...privateMarkers,
    };
    const publishedWithPrivateInputs = {
      kind: "takos.release-artifact-publish@v2" as const,
      status: "published" as const,
      tag: fixture.prepared.tag,
      commit: fixture.prepared.commit,
      releaseUrl: `https://github.com/tako0614/takos/releases/tag/${fixture.prepared.tag}`,
      descriptor: fixture.prepared.descriptor,
      assetDigests: Object.fromEntries(
        fixture.prepared.assets.map((asset: Record<string, any>) => [
          asset.name,
          asset.digest,
        ]),
      ),
      images: fixture.prepared.images,
      publicAgentImage: fixture.prepared.publicAgentImage,
      imageContent: fixture.prepared.imageContent,
      githubImmutable: true,
      publicationAttempt: digest("7"),
      publicationAcknowledgment: "confirmed" as const,
      workerSmoke: fixture.prepared.workerSmoke,
      observedAt: "2026-08-13T00:00:00.000Z",
      ...privateMarkers,
    };
    expect(await readFile(fixture.prepareEvidence, "utf8")).toContain(
      fixture.descriptorPath,
    );

    for (const result of [
      publicPrepareResult(preparedWithPrivateInputs),
      publicPublishResult(publishedWithPrivateInputs),
    ]) {
      const serialized = JSON.stringify(result);
      for (const marker of Object.values(privateMarkers)) {
        expect(serialized).not.toContain(marker);
      }
      expect(serialized).not.toContain(root);
      expect(result).toMatchObject({
        descriptor: {
          filename: "takos-artifact.json",
          digest: fixture.prepared.descriptor.digest,
          size: fixture.prepared.descriptor.size,
          url: fixture.prepared.descriptor.url,
        },
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publish rejects literal descriptor bytes before any release provider call", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-release-artifact-test-"));
  const stub = installReadOnlyCommandStub(commit);
  try {
    const version = await packageVersion();
    const fixture = await publishFixture(root, version);
    await fixture.writeDescriptor("descriptor bytes\n");

    await expectPublishDescriptorRejection(
      fixture,
      version,
      "invalid JSON",
    );
    expectNoReleaseProviderCalls(stub.calls);
  } finally {
    stub.restore();
    await rm(root, { recursive: true, force: true });
  }
});

for (const invalid of [
  {
    label: "the wrong archive digest",
    expected: "archive identity",
    mutate: (descriptor: Record<string, any>) => {
      descriptor.artifact.sha256 = "9".repeat(64);
      descriptor.artifact.sha256Prefixed = digest("9");
    },
  },
  {
    label: "the wrong archive size",
    expected: "archive identity",
    mutate: (descriptor: Record<string, any>) => {
      descriptor.artifact.size += 1;
    },
  },
  {
    label: "the wrong Takos commit",
    expected: "release identity",
    mutate: (descriptor: Record<string, any>) => {
      descriptor.commit = "9".repeat(40);
    },
  },
  {
    label: "the wrong release tag",
    expected: "release identity",
    mutate: (descriptor: Record<string, any>) => {
      descriptor.ref = "v9.9.9";
      descriptor.releaseTag = "v9.9.9";
    },
  },
  {
    label: "the wrong descriptor kind",
    expected: "schema",
    mutate: (descriptor: Record<string, any>) => {
      descriptor.kind = "takos.worker-artifact@v1";
    },
  },
  {
    label: "the wrong app identity",
    expected: "schema",
    mutate: (descriptor: Record<string, any>) => {
      descriptor.app = "another-app";
    },
  },
  {
    label: "an unknown descriptor field",
    expected: "schema",
    mutate: (descriptor: Record<string, any>) => {
      descriptor.untrusted = true;
    },
  },
  {
    label: "a missing descriptor field",
    expected: "schema",
    mutate: (descriptor: Record<string, any>) => {
      delete descriptor.assetManifest;
    },
  },
] as const) {
  test(`publish rejects ${invalid.label} even when prepare evidence adopts its digest`, async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-release-artifact-test-"));
    const stub = installReadOnlyCommandStub(commit);
    try {
      const version = await packageVersion();
      const fixture = await publishFixture(root, version);
      const descriptor = structuredClone(fixture.descriptor);
      invalid.mutate(descriptor);
      await fixture.writeDescriptor(descriptor);

      await expectPublishDescriptorRejection(
        fixture,
        version,
        invalid.expected,
      );
      expectNoReleaseProviderCalls(stub.calls);
    } finally {
      stub.restore();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("publish rejects noncanonical descriptor JSON with an adopted digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-release-artifact-test-"));
  const stub = installReadOnlyCommandStub(commit);
  try {
    const version = await packageVersion();
    const fixture = await publishFixture(root, version);
    await fixture.writeDescriptor(JSON.stringify(fixture.descriptor));

    await expectPublishDescriptorRejection(fixture, version, "canonical");
    expectNoReleaseProviderCalls(stub.calls);
  } finally {
    stub.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("publish rejects a symlink-substituted descriptor before any release provider call", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-release-artifact-test-"));
  const stub = installReadOnlyCommandStub(commit);
  try {
    const version = await packageVersion();
    const fixture = await publishFixture(root, version);
    const alternate = join(root, "alternate-descriptor.json");
    await privateFile(
      alternate,
      `${JSON.stringify(fixture.descriptor, null, 2)}\n`,
    );
    await rm(fixture.descriptorPath);
    await symlink(alternate, fixture.descriptorPath);

    await expectPublishDescriptorRejection(
      fixture,
      version,
      "operator-owned physical file",
    );
    expectNoReleaseProviderCalls(stub.calls);
  } finally {
    stub.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("publish rejects an oversized descriptor before any release provider call", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-release-artifact-test-"));
  const stub = installReadOnlyCommandStub(commit);
  try {
    const version = await packageVersion();
    const fixture = await publishFixture(root, version);
    await fixture.writeDescriptor("x".repeat(256 * 1024 + 1));

    await expectPublishDescriptorRejection(
      fixture,
      version,
      "bounded",
    );
    expectNoReleaseProviderCalls(stub.calls);
  } finally {
    stub.restore();
    await rm(root, { recursive: true, force: true });
  }
});

type PublishFixture = Awaited<ReturnType<typeof publishFixture>>;

async function publishFixture(root: string, version: string) {
  const outputDir = join(root, "output");
  const assetPath = join(outputDir, "takos-worker-release.tar.gz");
  const checksumPath = join(outputDir, "takos-worker-release.tar.gz.sha256");
  const descriptorPath = join(outputDir, "takos-artifact.json");
  const prepareEvidence = join(root, "prepare.json");
  const assetContents = "prepared worker bytes\n";
  const assetDigest = `sha256:${createHash("sha256")
    .update(assetContents)
    .digest("hex")}`;
  const checksumContents = `${assetDigest.slice("sha256:".length)}  takos-worker-release.tar.gz\n`;
  const checksumDigest = `sha256:${createHash("sha256")
    .update(checksumContents)
    .digest("hex")}`;
  const tag = `v${version}`;
  const descriptorUrl =
    `https://github.com/tako0614/takos/releases/download/${tag}/takos-artifact.json`;
  const archiveUrl =
    `https://github.com/tako0614/takos/releases/download/${tag}/takos-worker-release.tar.gz`;
  const descriptor: Record<string, any> = {
    kind: "takos.worker-artifact@v3",
    app: "takos",
    commit,
    ref: tag,
    workflowRun: null,
    releaseTag: tag,
    artifact: {
      filename: "takos-worker-release.tar.gz",
      url: archiveUrl,
      sha256: assetDigest.slice("sha256:".length),
      sha256Prefixed: assetDigest,
      size: Buffer.byteLength(assetContents),
      contentType: "application/gzip",
    },
    assetManifest: "asset-manifest.json",
    containerImages: {
      executor:
        `registry.cloudflare.com/${accountId}/takos-agent@${digest("d")}`,
      publicAgent: `ghcr.io/tako0614/takos-agent@${digest("e")}`,
    },
    manifestUrl: descriptorUrl,
  };
  const prepared: Record<string, any> = {
    kind: "takos.release-artifact-prepare@v2",
    status: "prepared",
    tag,
    commit,
    version,
    repository: "tako0614/takos",
    accountId,
    portableCheck: { command: "bun run check", status: "passed" },
    outputDir,
    descriptor: {
      path: descriptorPath,
      digest: "",
      url: descriptorUrl,
      size: 0,
    },
    assets: [
      {
        name: "takos-worker-release.tar.gz",
        path: assetPath,
        digest: assetDigest,
        size: Buffer.byteLength(assetContents),
      },
      {
        name: "takos-worker-release.tar.gz.sha256",
        path: checksumPath,
        digest: checksumDigest,
        size: Buffer.byteLength(checksumContents),
      },
      {
        name: "takos-artifact.json",
        path: descriptorPath,
        digest: "",
        size: 0,
      },
    ],
    images: {
      "takos-agent": descriptor.containerImages.executor,
    },
    publicAgentImage: descriptor.containerImages.publicAgent,
    imageContent: {
      cloudflare: imageContent,
      publicOci: imageContent,
    },
    workerSmoke: {
      kind: "takos.worker-release-smoke@v1",
      runtime: "wrangler-local-workerd",
      archiveDigest: assetDigest,
      health: {
        path: "/health",
        status: 200,
        bodyDigest: digest("4"),
      },
      api: {
        path: "/api/auth/me",
        status: 401,
        bodyDigest: digest("6"),
      },
      productDiscovery: {
        path: "/.well-known/takosumi",
        status: 200,
        bodyDigest: digest("5"),
        apiPath: "/api/v1",
      },
    },
    observedAt: "2026-08-02T00:00:00.000Z",
  };

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await privateFile(assetPath, assetContents);
  await privateFile(checksumPath, checksumContents);

  const writeDescriptor = async (value: unknown): Promise<void> => {
    const contents = typeof value === "string"
      ? value
      : `${JSON.stringify(value, null, 2)}\n`;
    const descriptorDigest = `sha256:${createHash("sha256")
      .update(contents)
      .digest("hex")}`;
    prepared.descriptor.digest = descriptorDigest;
    prepared.descriptor.size = Buffer.byteLength(contents);
    const descriptorAsset = prepared.assets.find(
      (asset: Record<string, unknown>) =>
        asset.name === "takos-artifact.json",
    );
    descriptorAsset.digest = descriptorDigest;
    descriptorAsset.size = Buffer.byteLength(contents);
    await privateFile(descriptorPath, contents);
    await privateFile(prepareEvidence, `${JSON.stringify(prepared)}\n`);
  };
  await writeDescriptor(descriptor);
  return {
    assetPath,
    checksumPath,
    descriptor,
    descriptorPath,
    outputDir,
    prepared,
    prepareEvidence,
    writeDescriptor,
  };
}

async function expectPublishDescriptorRejection(
  fixture: PublishFixture,
  version: string,
  expected: string,
): Promise<void> {
  await expect(
    runReleaseArtifact(
      {
        phase: "publish",
        tag: `v${version}`,
        prepareEvidence: fixture.prepareEvidence,
        evidence: join(dirname(fixture.prepareEvidence), "publish.json"),
        execute: true,
      },
    ),
  ).rejects.toThrow(expected);
}

function expectNoReleaseProviderCalls(calls: readonly string[][]): void {
  expect(
    calls.filter(
      ([executable, ...args]) =>
        executable !== "git" ||
        args[0] === "push" ||
        args[0] === "tag" ||
        args.some((argument) => argument.startsWith("refs/tags/")),
    ),
  ).toEqual([]);
}

function installFinalReleaseRaceStub(
  scenario:
    | "preexisting"
    | "raced-before-spawn"
    | "lost-acknowledgment"
    | "spawn-failed",
): { calls: string[][]; restore: () => void } {
  const calls: string[][] = [];
  const originalSpawn = Bun.spawn;
  const bunRuntime = Bun as unknown as { spawn: typeof Bun.spawn };
  let releaseViews = 0;
  let publicationBody = "";

  bunRuntime.spawn = ((argv: readonly string[]) => {
    const command = [...argv];
    calls.push(command);
    const [executable, ...args] = command;
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    if (
      executable === "git" &&
      args[0] === "ls-remote" &&
      args.includes("--tags")
    ) {
      stdout = releaseViews === 0
        ? ""
        : `${commit}\trefs/tags/v1.2.3\n`;
    } else if (executable === "gh" && isReleaseViewArgs(args)) {
      releaseViews += 1;
      if (scenario === "preexisting") {
        stdout = releaseReadbackJson("racing publication");
      } else if (releaseViews === 1) {
        exitCode = 1;
        stderr = "release not found";
      } else {
        stdout = releaseReadbackJson(
          scenario === "raced-before-spawn"
            ? "racing publication"
            : publicationBody,
        );
      }
    } else if (executable === "gh" && isReleaseCreateArgs(args)) {
      if (scenario === "spawn-failed") {
        throw new Error("simulated pre-spawn failure");
      }
      if (scenario !== "raced-before-spawn") {
        publicationBody = args[args.indexOf("--notes") + 1] ?? "";
      }
      if (
        scenario === "lost-acknowledgment" ||
        scenario === "raced-before-spawn"
      ) {
        exitCode = 1;
        stderr = scenario === "lost-acknowledgment"
          ? "connection closed after request body was sent"
          : "release already exists";
      }
    } else {
      throw new Error(`unexpected final-release command: ${command.join(" ")}`);
    }

    return {
      stdout: new Blob([stdout]).stream(),
      stderr: new Blob([stderr]).stream(),
      exited: Promise.resolve(exitCode),
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;

  return {
    calls,
    restore: () => {
      bunRuntime.spawn = originalSpawn;
    },
  };
}

function releaseReadbackJson(body: string): string {
  return JSON.stringify({
    isDraft: false,
    isPrerelease: false,
    isImmutable: true,
    tagName: "v1.2.3",
    name: "Takos v1.2.3",
    body,
    targetCommitish: commit,
    url: "https://github.com/tako0614/takos/releases/tag/v1.2.3",
    assets: [{ name: "worker.tgz", digest: digest("a") }],
  });
}

function isReleaseViewArgs(args: readonly string[]): boolean {
  return args[0] === "release" && args[1] === "view";
}

function isReleaseCreateArgs(args: readonly string[]): boolean {
  return args[0] === "release" && args[1] === "create";
}

function isReleaseViewCommand(command: readonly string[]): boolean {
  return command[0] === "gh" && isReleaseViewArgs(command.slice(1));
}

function isReleaseCreateCommand(command: readonly string[]): boolean {
  return command[0] === "gh" && isReleaseCreateArgs(command.slice(1));
}
