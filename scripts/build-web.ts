#!/usr/bin/env -S bun
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

export const WEB_BUILD_MANIFEST = ".takos-web-build.json";
export const WEB_BUILD_KIND = "takos.web-build@v1" as const;

export type WebBuildManifest = {
  kind: typeof WEB_BUILD_KIND;
  sourceDigest: string;
  artifactDigest: string;
  sourceFiles: string[];
};

const repoRoot = resolve(import.meta.dir, "..");

export function trackedWebInputs(root: string): string[] {
  const result = Bun.spawnSync({
    cmd: [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "web",
      "package.json",
      "bun.lock",
      "scripts/build-web.ts",
    ],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `unable to enumerate Web build inputs: ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout
    .toString()
    .split("\0")
    .filter((path) => path.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

export function digestFiles(root: string, paths: string[]): string {
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(resolve(root, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function artifactFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(absolutePath, relativePath);
      else if (relativePath !== WEB_BUILD_MANIFEST) files.push(relativePath);
    }
  };
  walk(root, "");
  return files.sort((left, right) => left.localeCompare(right));
}

export function computeArtifactDigest(root: string): string {
  return digestFiles(root, artifactFiles(root));
}

export function writeWebBuildManifest(
  root: string,
  sourceFiles: string[],
  sourceRoot = repoRoot,
): WebBuildManifest {
  const manifest: WebBuildManifest = {
    kind: WEB_BUILD_KIND,
    sourceDigest: digestFiles(sourceRoot, sourceFiles),
    artifactDigest: computeArtifactDigest(root),
    sourceFiles,
  };
  writeFileSync(
    resolve(root, WEB_BUILD_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

async function main(): Promise<void> {
  const build = Bun.spawn({
    cmd: ["bunx", "vite", "build", "--config", "web/vite.config.ts"],
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await build.exited;
  if (exitCode !== 0) process.exit(exitCode);

  const artifactRoot = resolve(repoRoot, "dist");
  mkdirSync(artifactRoot, { recursive: true });
  const sourceFiles = trackedWebInputs(repoRoot);
  const manifest = writeWebBuildManifest(artifactRoot, sourceFiles);
  console.log(
    `Web build manifest written: source=${manifest.sourceDigest} artifact=${manifest.artifactDigest}`,
  );
}

if (import.meta.main) {
  await main();
}
