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
  RELEASE_ARTIFACT_USAGE,
  TAKOS_RELEASE_ARTIFACT_SURFACE,
  parseReleaseArtifactArgs,
  runReleaseArtifact,
} from "./release-artifact-deploy.ts";

const commit = "a".repeat(40);
const accountId = "b".repeat(32);
const digest = (character: string) => `sha256:${character.repeat(64)}`;

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
    target: "github-release-and-cloudflare-container-registry:takos",
    triggers: ["published-identity", "authority", "irreversible"],
  });
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.requiresScripts).toEqual([
    "check",
    "deploy",
    "release-worker-artifact:build",
  ]);
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

    const result = await runReleaseArtifact({
      phase: "prepare",
      tag: `v${await packageVersion()}`,
      config,
      accountIdFile: accountFile,
      tokenFile,
      outputDir,
      evidence,
      execute: false,
    });

    expect(result).toMatchObject({
      kind: "takos.release-artifact-prepare@v1",
      status: "planned",
      commit,
      accountId,
      outputDir,
    });
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
        kind: "takos.release-artifact-prepare@v1",
        status: "prepared",
        tag: `v${version}`,
        commit,
        version,
        repository: "tako0614/takos",
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
          "takos-worker-runtime":
            `registry.cloudflare.com/${accountId}/takos-worker-runtime@${digest("c")}`,
          "takos-agent":
            `registry.cloudflare.com/${accountId}/takos-agent@${digest("d")}`,
        },
        observedAt: "2026-08-02T00:00:00.000Z",
      })}\n`,
    );

    const result = await runReleaseArtifact({
      phase: "publish",
      tag: `v${version}`,
      prepareEvidence,
      evidence: publishEvidence,
      execute: false,
    });

    expect(result).toMatchObject({
      kind: "takos.release-artifact-publish@v1",
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
