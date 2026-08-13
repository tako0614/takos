import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  assertTakosumiCompositionSourceIdentityMatch,
  assertTakosumiCompositionCheckout,
  parseTakosumiCompositionSourceIdentity,
  parseTakosumiCompositionSourcePin,
  verifyTakosumiCompositionSource,
  type GitRunner,
} from "./check-takosumi-composition-source.ts";

const execFileAsync = promisify(execFile);

const PINNED_COMMIT = "3173457547e5782545dbcd2d78db0791093909d4";
const REVIEW_WORKTREE_COMMIT = "95e7048b4d2a2277ed2024a4d41a37c5e482640f";
const CURRENT_MAIN_COMMIT = "c471024f57c81efafebc7349693a9ce14dea77f5";
const PIN = parseTakosumiCompositionSourcePin({
  kind: "takos.takosumi-composition-source@v1",
  repository: "tako0614/takosumi",
  commit: PINNED_COMMIT,
});

const exactCheckout = {
  gitRoot: "/workspace/takosumi",
  expectedRoot: "/workspace/takosumi",
  headCommit: PINNED_COMMIT,
  status: "",
  originUrl: "https://github.com/tako0614/takosumi.git",
  originMainCommit: CURRENT_MAIN_COMMIT,
  remoteMainCommit: CURRENT_MAIN_COMMIT,
  pinIsAncestorOfOriginMain: true,
} as const;

test("Takos owns one exact immutable Takosumi composition pin", () => {
  expect(PIN).toEqual({
    kind: "takos.takosumi-composition-source@v1",
    repository: "tako0614/takosumi",
    commit: PINNED_COMMIT,
  });
  for (const invalid of [
    { ...PIN, commit: "main" },
    { ...PIN, repository: "another/takosumi" },
    { ...PIN, extra: true },
    null,
  ]) {
    expect(() => parseTakosumiCompositionSourcePin(invalid)).toThrow(
      "Takosumi composition source pin is invalid",
    );
  }
});

test("release source closure accepts only the exact pin identity", () => {
  const identity = parseTakosumiCompositionSourceIdentity({
    ...PIN,
    pinDigest: `sha256:${"a".repeat(64)}`,
  });
  expect(() =>
    assertTakosumiCompositionSourceIdentityMatch(identity, identity),
  ).not.toThrow();
  expect(() =>
    assertTakosumiCompositionSourceIdentityMatch(identity, {
      ...identity,
      commit: REVIEW_WORKTREE_COMMIT,
    }),
  ).toThrow("does not match the current pinned checkout");
  expect(() =>
    parseTakosumiCompositionSourceIdentity({ ...identity, extra: true }),
  ).toThrow("Takosumi composition source identity is invalid");
});

test("the exact clean physical checkout is accepted when canonical main attests the pin", () => {
  expect(() => assertTakosumiCompositionCheckout(PIN, exactCheckout)).not.toThrow();
});

test("the former 95e review checkout cannot build the pinned composition", () => {
  expect(() =>
    assertTakosumiCompositionCheckout(PIN, {
      ...exactCheckout,
      headCommit: REVIEW_WORKTREE_COMMIT,
    }),
  ).toThrow(
    `Takosumi composition source HEAD ${REVIEW_WORKTREE_COMMIT} does not match pinned commit ${PINNED_COMMIT}`,
  );
});

test("dirty, wrong-root, current-drifted, stale-main, and untrusted-history siblings fail closed", () => {
  expect(() =>
    assertTakosumiCompositionCheckout(PIN, {
      ...exactCheckout,
      status: " M contract/index.ts",
    }),
  ).toThrow("Takosumi composition source must be clean");
  expect(() =>
    assertTakosumiCompositionCheckout(PIN, {
      ...exactCheckout,
      gitRoot: "/alternate/takosumi",
    }),
  ).toThrow("Takosumi composition source must be the exact physical ../takosumi Git root");
  expect(() =>
    assertTakosumiCompositionCheckout(PIN, {
      ...exactCheckout,
      originUrl: "https://github.com/attacker/takosumi.git",
    }),
  ).toThrow("Takosumi composition source origin must be the canonical GitHub repository");
  expect(() =>
    assertTakosumiCompositionCheckout(PIN, {
      ...exactCheckout,
      headCommit: CURRENT_MAIN_COMMIT,
    }),
  ).toThrow(`does not match pinned commit ${PINNED_COMMIT}`);
  expect(() =>
    assertTakosumiCompositionCheckout(PIN, {
      ...exactCheckout,
      remoteMainCommit: REVIEW_WORKTREE_COMMIT,
    }),
  ).toThrow("Takosumi local origin/main does not match live origin/main");
  expect(() =>
    assertTakosumiCompositionCheckout(PIN, {
      ...exactCheckout,
      pinIsAncestorOfOriginMain: false,
    }),
  ).toThrow("Takosumi pinned commit is not in the canonical live main history");
});

test("a clean Takos clone without its physical Takosumi sibling fails explicitly", async () => {
  const pairRoot = await mkdtemp(join(tmpdir(), "takos-composition-missing-test-"));
  const takosRoot = join(pairRoot, "takos");
  try {
    await mkdir(takosRoot);
    await writeFile(
      join(takosRoot, "takosumi-composition-source.json"),
      `${JSON.stringify(PIN)}\n`,
    );
    await expect(
      verifyTakosumiCompositionSource({
        takosRoot,
        git: async () => {
          throw new Error("Git must not run for a missing sibling");
        },
      }),
    ).rejects.toThrow(
      `Takosumi composition source is missing: expected physical sibling ${join(pairRoot, "takosumi")}`,
    );
  } finally {
    await rm(pairRoot, { recursive: true, force: true });
  }
});

test("a symlink substituted for the Takosumi sibling fails before Git inspection", async () => {
  const pairRoot = await mkdtemp(join(tmpdir(), "takos-composition-link-test-"));
  const takosRoot = join(pairRoot, "takos");
  const alternateRoot = join(pairRoot, "alternate-takosumi");
  try {
    await Promise.all([mkdir(takosRoot), mkdir(alternateRoot)]);
    await writeFile(
      join(takosRoot, "takosumi-composition-source.json"),
      `${JSON.stringify(PIN)}\n`,
    );
    await symlink(alternateRoot, join(pairRoot, "takosumi"));
    await expect(
      verifyTakosumiCompositionSource({
        takosRoot,
        git: async () => {
          throw new Error("Git must not run for a substituted sibling");
        },
      }),
    ).rejects.toThrow(
      "Takosumi composition source must be a physical directory, not a symlink",
    );
  } finally {
    await rm(pairRoot, { recursive: true, force: true });
  }
});

for (const hiddenFlag of [
  {
    label: "assume-unchanged",
    updateIndexOption: "--assume-unchanged",
    lsFilesPrefix: "h ",
  },
  {
    label: "skip-worktree",
    updateIndexOption: "--skip-worktree",
    lsFilesPrefix: "S ",
  },
] as const) {
  for (const drift of [
    {
      label: "modified tracked composition bytes",
      mutate: async (path: string) =>
        await writeFile(path, "export const exact = false;\n"),
    },
    {
      label: "a deleted tracked composition file",
      mutate: async (path: string) => await rm(path),
    },
    {
      label: "a tracked composition mode change",
      mutate: async (path: string) => await chmod(path, 0o755),
    },
  ] as const) {
    test(`${hiddenFlag.label} cannot hide ${drift.label}`, async () => {
      const fixture = await trackedCompositionFixture();
      try {
        await gitCommand(fixture.takosumiRoot, [
          "update-index",
          hiddenFlag.updateIndexOption,
          fixture.sourceRelativePath,
        ]);
        await drift.mutate(fixture.sourcePath);
        expect(await trackedStatus(fixture.takosumiRoot)).toBe("");
        expect(
          await gitCommand(fixture.takosumiRoot, [
            "ls-files",
            "-v",
            "--",
            fixture.sourceRelativePath,
          ]),
        ).toStartWith(hiddenFlag.lsFilesPrefix);

        await expect(
          verifyTakosumiCompositionSource({
            takosRoot: fixture.takosRoot,
            git: fixture.git,
          }),
        ).rejects.toThrow(hiddenFlag.label);
      } finally {
        await fixture.cleanup();
      }
    });
  }
}

test("the pinned tree proof rejects modified tracked bytes independently of status", async () => {
  const fixture = await trackedCompositionFixture();
  try {
    await writeFile(fixture.sourcePath, "export const exact = false;\n");
    await expect(
      verifyTakosumiCompositionSource({
        takosRoot: fixture.takosRoot,
        git: statusBlindGit(fixture.git),
      }),
    ).rejects.toThrow("tracked file content does not match pinned commit");
  } finally {
    await fixture.cleanup();
  }
});

test("the pinned tree proof rejects a deleted tracked file independently of status", async () => {
  const fixture = await trackedCompositionFixture();
  try {
    await rm(fixture.sourcePath);
    await expect(
      verifyTakosumiCompositionSource({
        takosRoot: fixture.takosRoot,
        git: statusBlindGit(fixture.git),
      }),
    ).rejects.toThrow("tracked file is missing from the physical checkout");
  } finally {
    await fixture.cleanup();
  }
});

test("the pinned tree proof rejects a tracked executable-mode change independently of status", async () => {
  const fixture = await trackedCompositionFixture();
  try {
    await chmod(fixture.sourcePath, 0o755);
    await expect(
      verifyTakosumiCompositionSource({
        takosRoot: fixture.takosRoot,
        git: statusBlindGit(fixture.git),
      }),
    ).rejects.toThrow("tracked file mode does not match pinned commit");
  } finally {
    await fixture.cleanup();
  }
});

test("the pinned tree proof rejects a symlink substituted for a tracked file", async () => {
  const fixture = await trackedCompositionFixture();
  try {
    await rm(fixture.sourcePath);
    await symlink("another.ts", fixture.sourcePath);
    await expect(
      verifyTakosumiCompositionSource({
        takosRoot: fixture.takosRoot,
        git: statusBlindGit(fixture.git),
      }),
    ).rejects.toThrow("tracked file type does not match pinned commit");
  } finally {
    await fixture.cleanup();
  }
});

test("the pinned tree proof rejects a changed tracked symlink target", async () => {
  const fixture = await trackedCompositionFixture();
  try {
    await rm(fixture.symlinkPath);
    await symlink("another.ts", fixture.symlinkPath);
    await expect(
      verifyTakosumiCompositionSource({
        takosRoot: fixture.takosRoot,
        git: statusBlindGit(fixture.git),
      }),
    ).rejects.toThrow("tracked symlink target does not match pinned commit");
  } finally {
    await fixture.cleanup();
  }
});

test("portable compile, direct builds, and CI resolve the Takos-owned composition pin first", async () => {
  const root = join(import.meta.dir, "..");
  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  expect(packageJson.scripts["check:takosumi-composition-source"]).toBe(
    "bun scripts/check-takosumi-composition-source.ts",
  );
  expect(packageJson.scripts.check.indexOf("check:takosumi-composition-source")).toBeLessThan(
    packageJson.scripts.check.indexOf("tsc -p"),
  );
  expect(packageJson.scripts.build).toStartWith(
    "bun run check:takosumi-composition-source && ",
  );
  expect(packageJson.scripts.build).toEndWith(
    " && bun run check:takosumi-composition-source",
  );
  expect(packageJson.scripts["worker:build"]).toStartWith(
    "bun run check:takosumi-composition-source && ",
  );
  expect(packageJson.scripts["worker:build"]).toEndWith(
    " && bun run check:takosumi-composition-source",
  );
  expect(packageJson.scripts["release-worker-artifact:build"]).toStartWith(
    "bun run check:takosumi-composition-source && ",
  );
  expect(packageJson.scripts["release-worker-artifact:build"]).toEndWith(
    " && bun run check:takosumi-composition-source",
  );

  const workflow = await readFile(
    join(root, ".github/workflows/release-artifacts.yml"),
    "utf8",
  );
  expect(workflow).toContain("--print-commit");
  expect(workflow).toContain("ref: ${{ steps.takosumi-source.outputs.commit }}");
  expect(workflow).not.toContain(
    `ref: ${PINNED_COMMIT}`,
  );
});

async function trackedCompositionFixture(): Promise<{
  readonly takosRoot: string;
  readonly takosumiRoot: string;
  readonly sourceRelativePath: string;
  readonly sourcePath: string;
  readonly symlinkPath: string;
  readonly git: GitRunner;
  readonly cleanup: () => Promise<void>;
}> {
  const pairRoot = await mkdtemp(join(tmpdir(), "takos-composition-tree-test-"));
  const takosRoot = join(pairRoot, "takos");
  const takosumiRoot = join(pairRoot, "takosumi");
  const sourceRelativePath = "contract/reference/ip-classification.ts";
  const sourcePath = join(takosumiRoot, sourceRelativePath);
  const symlinkRelativePath = "contract/reference/pinned-link.ts";
  const symlinkPath = join(takosumiRoot, symlinkRelativePath);
  try {
    await mkdir(join(takosRoot), { recursive: true });
    await mkdir(join(takosumiRoot, "contract/reference"), { recursive: true });
    await writeFile(sourcePath, "export const exact = true;\n");
    await chmod(sourcePath, 0o644);
    await symlink("ip-classification.ts", symlinkPath);
    await gitCommand(takosumiRoot, ["init", "--quiet", "--initial-branch=main"]);
    await gitCommand(takosumiRoot, ["config", "user.email", "tests@takos.jp"]);
    await gitCommand(takosumiRoot, ["config", "user.name", "Takos tests"]);
    await gitCommand(takosumiRoot, ["config", "core.filemode", "true"]);
    await gitCommand(takosumiRoot, [
      "add",
      "--",
      sourceRelativePath,
      symlinkRelativePath,
    ]);
    await gitCommand(takosumiRoot, ["commit", "--quiet", "-m", "fixture"]);
    const commit = (
      await gitCommand(takosumiRoot, ["rev-parse", "HEAD"])
    ).trim();
    await gitCommand(takosumiRoot, [
      "remote",
      "add",
      "origin",
      "https://github.com/tako0614/takosumi.git",
    ]);
    await gitCommand(takosumiRoot, [
      "update-ref",
      "refs/remotes/origin/main",
      commit,
    ]);
    await writeFile(
      join(takosRoot, "takosumi-composition-source.json"),
      `${JSON.stringify({
        kind: "takos.takosumi-composition-source@v1",
        repository: "tako0614/takosumi",
        commit,
      })}\n`,
    );
    const git: GitRunner = async (root, args) =>
      args[0] === "ls-remote"
        ? `${commit}\trefs/heads/main\n`
        : await gitCommand(root, args);
    return {
      takosRoot,
      takosumiRoot,
      sourceRelativePath,
      sourcePath,
      symlinkPath,
      git,
      cleanup: async () => await rm(pairRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(pairRoot, { recursive: true, force: true });
    throw error;
  }
}

function statusBlindGit(git: GitRunner): GitRunner {
  return async (root, args) =>
    args[0] === "status" ? "" : await git(root, args);
}

async function trackedStatus(root: string): Promise<string> {
  return (
    await gitCommand(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ])
  ).trim();
}

async function gitCommand(
  root: string,
  args: readonly string[],
): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.stdout;
}
