import fs from "node:fs/promises";
import path from "node:path";
import { assertEquals } from "jsr:@std/assert";
import { inferApplySourceProjection } from "../src/lib/git-provenance.ts";

async function runGit(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    cwd,
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr).trim());
  }
  return new TextDecoder().decode(output.stdout).trim();
}

async function withGitProject<T>(
  fn: (projectDir: string, manifestPath: string) => Promise<T>,
): Promise<T> {
  const projectDir = await Deno.makeTempDir({ prefix: "takos-cli-git-" });
  const takosDir = path.join(projectDir, ".takos");
  const manifestPath = path.join(takosDir, "app.yml");
  await fs.mkdir(takosDir, { recursive: true });
  await fs.writeFile(
    manifestPath,
    "apiVersion: takos.dev/v1alpha1\nkind: App\nmetadata:\n  name: sample-app\nspec:\n  version: 1.0.0\n",
    "utf8",
  );
  await runGit(projectDir, ["init"]);
  await runGit(projectDir, ["config", "user.email", "codex@example.test"]);
  await runGit(projectDir, ["config", "user.name", "Codex"]);
  await runGit(projectDir, ["checkout", "-b", "main"]);
  await runGit(projectDir, ["add", "."]);
  await runGit(projectDir, ["commit", "-m", "init"]);

  try {
    return await fn(projectDir, manifestPath);
  } finally {
    await fs.rm(projectDir, { recursive: true, force: true });
  }
}

Deno.test("git provenance - prefers the current branch upstream remote over origin", async () => {
  await withGitProject(async (projectDir, manifestPath) => {
    await runGit(projectDir, [
      "remote",
      "add",
      "origin",
      "https://github.com/acme/origin.git",
    ]);
    await runGit(projectDir, [
      "remote",
      "add",
      "mirror",
      "https://github.com/acme/mirror.git",
    ]);
    await runGit(projectDir, ["config", "branch.main.remote", "mirror"]);
    await runGit(projectDir, [
      "config",
      "branch.main.merge",
      "refs/heads/main",
    ]);

    const commitSha = await runGit(projectDir, ["rev-parse", "HEAD"]);
    const projection = await inferApplySourceProjection(manifestPath);

    assertEquals(projection, {
      kind: "git_ref",
      repository_url: "https://github.com/acme/mirror.git",
      ref: commitSha,
      ref_type: "commit",
      commit_sha: commitSha,
    });
  });
});

Deno.test("git provenance - falls back to the only configured remote", async () => {
  await withGitProject(async (projectDir, manifestPath) => {
    await runGit(projectDir, [
      "remote",
      "add",
      "upstream",
      "https://github.com/acme/upstream.git",
    ]);

    const commitSha = await runGit(projectDir, ["rev-parse", "HEAD"]);
    const projection = await inferApplySourceProjection(manifestPath);

    assertEquals(projection, {
      kind: "git_ref",
      repository_url: "https://github.com/acme/upstream.git",
      ref: commitSha,
      ref_type: "commit",
      commit_sha: commitSha,
    });
  });
});
