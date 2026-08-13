import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertImageContentMatch,
  assertPublishedReleaseReadback,
  assertPublicAgentReadback,
  createOnlyReleaseCommand,
  isolatedDockerEnv,
  RELEASE_ARTIFACT_USAGE,
  TAKOS_RELEASE_ARTIFACT_SURFACE,
  parseReleaseArtifactArgs,
  runReleaseArtifact,
} from "./release-artifact-deploy.ts";

const commit = "a".repeat(40);
const accountId = "b".repeat(32);
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const imageContent = {
  configDigest: digest("f"),
  layerDigests: [digest("1"), digest("2")],
} as const;
const takosumiCompositionSource = {
  kind: "takos.takosumi-composition-source@v1",
  repository: "tako0614/takosumi",
  commit: "3173457547e5782545dbcd2d78db0791093909d4",
  pinDigest: `sha256:${"c".repeat(64)}`,
} as const;
const compositionRuntime = {
  verifyTakosumiCompositionSource: async () => takosumiCompositionSource,
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
      } else if (args[0] === "branch") {
        stdout = "main\n";
      } else if (
        args[0] === "rev-parse" &&
        (args[1] === "HEAD" || args[1] === "origin/main")
      ) {
        stdout = `${expectedCommit}\n`;
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
    "takosumi-composition-source.json",
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
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["failure-handling"]).toContain(
    "lost acknowledgment",
  );
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["post-conditions"]).toContain(
    "boots the exact downloaded Worker archive",
  );
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["post-conditions"]).toContain(
    "product discovery",
  );
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations.provenance).toContain(
    "Takosumi composition",
  );
  expect(
    TAKOS_RELEASE_ARTIFACT_SURFACE.obligations["pre-mutation-proof"],
  ).toContain("local/live origin/main");
});

test("publication has one create-only command with the complete asset closure", () => {
  const assets = ["/private/worker.tgz", "/private/checksum", "/private/descriptor"];
  const command = createOnlyReleaseCommand("v1.2.3", commit, assets);

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
});

test("authoritative release readback requires immutable state and exact digests", () => {
  const expected = [{ name: "worker.tgz", digest: digest("a") }];
  const exact = {
    isDraft: false,
    isPrerelease: false,
    isImmutable: true,
    tagName: "v1.2.3",
    url: "https://github.com/tako0614/takos/releases/tag/v1.2.3",
    assets: expected,
  };

  expect(() => assertPublishedReleaseReadback("v1.2.3", expected, exact)).not.toThrow();
  expect(() =>
    assertPublishedReleaseReadback("v1.2.3", expected, {
      ...exact,
      isImmutable: false,
    }),
  ).toThrow("state is not exact and immutable");
  expect(() =>
    assertPublishedReleaseReadback("v1.2.3", expected, {
      ...exact,
      assets: [{ name: "worker.tgz", digest: digest("b") }],
    }),
  ).toThrow("asset closure or digest drifted");
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
      compositionRuntime,
    );

    expect(result).toMatchObject({
      kind: "takos.release-artifact-prepare@v2",
      status: "planned",
      commit,
      accountId,
      outputDir,
      takosumiCompositionSource,
    });
    await expect(stat(evidence)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(outputDir)).rejects.toMatchObject({ code: "ENOENT" });
    expectNoMutationCommands(stub.calls);
  } finally {
    stub.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("prepare dry-run rejects a mismatched Takosumi composition before provider work", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-release-artifact-test-"));
  const stub = installReadOnlyCommandStub(commit);
  try {
    const config = join(root, "wrangler.toml");
    const accountFile = join(root, "account-id");
    const tokenFile = join(root, "cloudflare-api-token");
    await privateFile(config, "name = \"takos-test\"\n");
    await privateFile(accountFile, `${accountId}\n`);
    await privateFile(tokenFile, `${"token".repeat(8)}\n`);

    await expect(
      runReleaseArtifact(
        {
          phase: "prepare",
          tag: `v${await packageVersion()}`,
          config,
          accountIdFile: accountFile,
          tokenFile,
          outputDir: join(root, "output"),
          evidence: join(root, "prepare.json"),
          execute: false,
        },
        {
          verifyTakosumiCompositionSource: async () => {
            throw new Error(
              "Takosumi composition source HEAD 95e7048b4d2a2277ed2024a4d41a37c5e482640f does not match pinned commit 3173457547e5782545dbcd2d78db0791093909d4",
            );
          },
        },
      ),
    ).rejects.toThrow("does not match pinned commit");
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
    const outputDir = join(root, "output");
    const assetPath = join(outputDir, "takos-worker-release.tar.gz");
    const checksumPath = join(outputDir, "takos-worker-release.tar.gz.sha256");
    const descriptorPath = join(outputDir, "takosumi-artifact.json");
    const prepareEvidence = join(root, "prepare.json");
    const publishEvidence = join(root, "publish.json");
    const assetContents = "prepared worker bytes\n";
    const assetDigest = `sha256:${createHash("sha256")
      .update(assetContents)
      .digest("hex")}`;
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
    const checksumContents = `${assetDigest}  takos-worker-release.tar.gz\n`;
    const descriptorContents = "descriptor bytes\n";
    const checksumDigest = `sha256:${createHash("sha256")
      .update(checksumContents)
      .digest("hex")}`;
    const descriptorDigest = `sha256:${createHash("sha256")
      .update(descriptorContents)
      .digest("hex")}`;
    await privateFile(assetPath, assetContents);
    await privateFile(checksumPath, checksumContents);
    await privateFile(descriptorPath, descriptorContents);
    await privateFile(
      prepareEvidence,
      `${JSON.stringify({
        kind: "takos.release-artifact-prepare@v2",
        status: "prepared",
        tag: `v${version}`,
        commit,
        version,
        repository: "tako0614/takos",
        takosumiCompositionSource,
        accountId,
        portableCheck: { command: "bun run check", status: "passed" },
        outputDir,
        descriptor: {
          path: descriptorPath,
          digest: descriptorDigest,
          url: `https://github.com/tako0614/takos/releases/download/v${version}/takosumi-artifact.json`,
        },
        assets: [
          {
            name: "takos-worker-release.tar.gz",
            path: assetPath,
            digest: assetDigest,
          },
          {
            name: "takos-worker-release.tar.gz.sha256",
            path: checksumPath,
            digest: checksumDigest,
          },
          {
            name: "takosumi-artifact.json",
            path: descriptorPath,
            digest: descriptorDigest,
          },
        ],
        images: {
          "takos-agent":
            `registry.cloudflare.com/${accountId}/takos-agent@${digest("d")}`,
        },
        publicAgentImage:
          `ghcr.io/tako0614/takos-agent@${digest("e")}`,
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
      })}\n`,
    );

    const result = await runReleaseArtifact(
      {
        phase: "publish",
        tag: `v${version}`,
        prepareEvidence,
        evidence: publishEvidence,
        execute: false,
      },
      compositionRuntime,
    );

    expect(result).toMatchObject({
      kind: "takos.release-artifact-publish@v2",
      status: "planned",
      commit,
    });
    await expect(stat(publishEvidence)).rejects.toMatchObject({ code: "ENOENT" });
    expectNoMutationCommands(stub.calls);
  } finally {
    stub.restore();
    await rm(root, { recursive: true, force: true });
  }
});
