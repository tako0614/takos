import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertTakosumiCompositionSourceIdentityMatch,
  assertTakosumiCompositionCheckout,
  parseTakosumiCompositionSourceIdentity,
  parseTakosumiCompositionSourcePin,
  verifyTakosumiCompositionSource,
} from "./check-takosumi-composition-source.ts";

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
