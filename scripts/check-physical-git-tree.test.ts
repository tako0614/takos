import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  assertPhysicalGitTreeMatchesCommit,
  type PhysicalGitRunner,
} from "./check-physical-git-tree.ts";

const execFileAsync = promisify(execFile);

test("an exact physical Git tree matches its committed identity", async () => {
  const fixture = await physicalTreeFixture();
  try {
    await expect(
      assertPhysicalGitTreeMatchesCommit({
        root: fixture.root,
        commit: fixture.commit,
        subject: "Takos repository",
      }),
    ).resolves.toBeUndefined();
  } finally {
    await fixture.cleanup();
  }
});

for (const hidden of [
  { label: "assume-unchanged", option: "--assume-unchanged" },
  { label: "skip-worktree", option: "--skip-worktree" },
] as const) {
  test(`Takos ${hidden.label} cannot hide mutually consistent release-source edits`, async () => {
    const fixture = await physicalTreeFixture();
    try {
      const paths = [
        "package.json",
        "release-input.json",
        "deploy/opentofu/takoform/main.tf",
      ];
      await gitCommand(fixture.root, ["update-index", hidden.option, "--", ...paths]);
      await Promise.all([
        writeFile(
          join(fixture.root, "package.json"),
          '{"version":"9.9.9","takosRelease":{"version":"9.9.9"}}\n',
        ),
        writeFile(
          join(fixture.root, "release-input.json"),
          `${JSON.stringify({ kind: "takos.release-input@v1", commit: "9".repeat(40) })}\n`,
        ),
        writeFile(
          join(fixture.root, "deploy/opentofu/takoform/main.tf"),
          'variable "worker_release_tag" { default = "v9.9.9" }\n' +
            `variable "worker_artifact_sha256" { default = "sha256:${"9".repeat(64)}" }\n`,
        ),
      ]);
      expect(await trackedStatus(fixture.root)).toBe("");

      await expect(
        assertPhysicalGitTreeMatchesCommit({
          root: fixture.root,
          commit: fixture.commit,
          subject: "Takos repository",
        }),
      ).rejects.toThrow(hidden.label);
    } finally {
      await fixture.cleanup();
    }
  });
}

for (const drift of [
  {
    label: "modified tracked bytes",
    expected: "content does not match",
    mutate: async (fixture: PhysicalTreeFixture) =>
      await writeFile(join(fixture.root, "package.json"), '{"version":"9.9.9"}\n'),
  },
  {
    label: "a deleted tracked file",
    expected: "missing from the physical checkout",
    mutate: async (fixture: PhysicalTreeFixture) =>
      await rm(join(fixture.root, "package.json")),
  },
  {
    label: "a tracked executable-mode change",
    expected: "mode does not match",
    mutate: async (fixture: PhysicalTreeFixture) =>
      await chmod(join(fixture.root, "package.json"), 0o755),
  },
  {
    label: "a symlink substituted for a tracked regular file",
    expected: "type does not match",
    mutate: async (fixture: PhysicalTreeFixture) => {
      await rm(join(fixture.root, "package.json"));
      await symlink("release-input.json", join(fixture.root, "package.json"));
    },
  },
  {
    label: "a changed tracked symlink target",
    expected: "symlink target does not match",
    mutate: async (fixture: PhysicalTreeFixture) => {
      await rm(join(fixture.root, "release-source.json"));
      await symlink("package.json", join(fixture.root, "release-source.json"));
    },
  },
] as const) {
  test(`the physical HEAD-tree proof rejects ${drift.label} independently of index flags`, async () => {
    const fixture = await physicalTreeFixture();
    try {
      await drift.mutate(fixture);
      await expect(
        assertPhysicalGitTreeMatchesCommit({
          root: fixture.root,
          commit: fixture.commit,
          subject: "Takos repository",
          git: normalIndexFlagsGit,
        }),
      ).rejects.toThrow(drift.expected);
    } finally {
      await fixture.cleanup();
    }
  });
}

type PhysicalTreeFixture = Awaited<ReturnType<typeof physicalTreeFixture>>;

async function physicalTreeFixture() {
  const root = await mkdtemp(join(tmpdir(), "takos-physical-tree-test-"));
  try {
    await mkdir(join(root, "deploy/opentofu/takoform"), { recursive: true });
    await Promise.all([
      writeFile(
        join(root, "package.json"),
        '{"version":"0.12.2","takosRelease":{"version":"0.12.2"}}\n',
      ),
      writeFile(
        join(root, "release-input.json"),
        `${JSON.stringify({ kind: "takos.release-input@v1", commit: "3".repeat(40) })}\n`,
      ),
      writeFile(
        join(root, "deploy/opentofu/takoform/main.tf"),
        'variable "worker_release_tag" { default = "v0.12.2" }\n',
      ),
    ]);
    await symlink("release-input.json", join(root, "release-source.json"));
    await gitCommand(root, ["init", "--quiet", "--initial-branch=main"]);
    await gitCommand(root, ["config", "user.email", "tests@takos.jp"]);
    await gitCommand(root, ["config", "user.name", "Takos tests"]);
    await gitCommand(root, ["config", "core.filemode", "true"]);
    await gitCommand(root, ["add", "."]);
    await gitCommand(root, ["commit", "--quiet", "-m", "fixture"]);
    const commit = (await gitCommand(root, ["rev-parse", "HEAD"])).trim();
    return {
      root,
      commit,
      cleanup: async () => await rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

const normalIndexFlagsGit: PhysicalGitRunner = async (root, args) => {
  const output = await gitCommand(root, args);
  if (args[0] !== "ls-files" || !args.includes("-v")) return output;
  return output
    .split("\0")
    .filter(Boolean)
    .map((entry) => `H ${entry.slice(2)}`)
    .join("\0") + "\0";
};

async function trackedStatus(root: string): Promise<string> {
  return (
    await gitCommand(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ])
  ).trim();
}

async function gitCommand(root: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout;
}
