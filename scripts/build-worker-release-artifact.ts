#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { hash as blake3 } from "blake3-wasm";

type Options = {
  bundleDir: string;
  assetsDir: string;
  imageDigestDir: string;
  outputDir: string;
  releaseTag: string;
  requireCloudflareContainerImages: boolean;
};

type ImageDigestRecord = {
  name?: string;
  cloudflareRegistryRef?: string;
};

if (import.meta.main) {
  const options = parseArgs(Bun.argv.slice(2));
  await buildWorkerReleaseArtifact(options);
}

export async function buildWorkerReleaseArtifact(options: Options) {
  assertReleaseTag(options.releaseTag);
  const bundleDir = resolve(options.bundleDir);
  const assetsDir = resolve(options.assetsDir);
  const outputDir = resolve(options.outputDir);
  await assertRegularFile(
    join(bundleDir, "index.js"),
    "Worker bundle index.js",
  );
  await assertDirectory(assetsDir, "web assets directory");
  await rm(outputDir, { recursive: true, force: true });
  const tempRoot = await mkdtemp(join(tmpdir(), "takos-worker-release-"));
  const packageRoot = join(tempRoot, "package");
  try {
    await mkdir(join(packageRoot, "worker"), { recursive: true });
    await cp(join(bundleDir, "index.js"), join(packageRoot, "worker/index.js"));
    try {
      await cp(
        join(bundleDir, "index.js.map"),
        join(packageRoot, "worker/index.js.map"),
      );
    } catch {
      // Source maps are optional release evidence and are not uploaded by default.
    }
    await cp(assetsDir, join(packageRoot, "assets"), { recursive: true });
    const assetManifest = await buildAssetManifest(join(packageRoot, "assets"));
    await writeFile(
      join(packageRoot, "asset-manifest.json"),
      `${JSON.stringify(assetManifest, null, 2)}\n`,
    );

    await mkdir(outputDir, { recursive: true });
    const archiveName = "takos-worker-release.tar.gz";
    const archivePath = join(outputDir, archiveName);
    run("tar", ["-czf", archivePath, "-C", packageRoot, "."]);
    const archiveBytes = await readFile(archivePath);
    const archiveSha256 = new Bun.CryptoHasher("sha256")
      .update(archiveBytes)
      .digest("hex");
    await writeFile(
      join(outputDir, `${archiveName}.sha256`),
      `${archiveSha256}  ${archiveName}\n`,
    );

    const repository = Bun.env.GITHUB_REPOSITORY?.trim() || "tako0614/takos";
    const artifactUrl = `https://github.com/${repository}/releases/download/${options.releaseTag}/${archiveName}`;
    const manifestUrl = `https://github.com/${repository}/releases/download/${options.releaseTag}/takosumi-artifact.json`;
    const containerImages = await readContainerImages(
      options.imageDigestDir,
      options.requireCloudflareContainerImages,
    );
    const manifest = {
      kind: "takosumi.worker-artifact@v1",
      app: "takos",
      commit: Bun.env.GITHUB_SHA?.trim() || null,
      ref: Bun.env.GITHUB_REF_NAME?.trim() || options.releaseTag,
      workflowRun:
        Bun.env.GITHUB_SERVER_URL &&
        Bun.env.GITHUB_REPOSITORY &&
        Bun.env.GITHUB_RUN_ID
          ? `${Bun.env.GITHUB_SERVER_URL}/${Bun.env.GITHUB_REPOSITORY}/actions/runs/${Bun.env.GITHUB_RUN_ID}`
          : null,
      releaseTag: options.releaseTag,
      artifact: {
        filename: archiveName,
        url: artifactUrl,
        sha256: archiveSha256,
        sha256Prefixed: `sha256:${archiveSha256}`,
        contentType: "application/gzip",
      },
      assetManifest: "asset-manifest.json",
      containerImages,
      manifestUrl,
    };
    await writeFile(
      join(outputDir, "takosumi-artifact.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return manifest;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function buildAssetManifest(directory: string) {
  const manifest: Record<string, { hash: string; size: number }> = {};
  for (const path of await walkFiles(directory)) {
    const key = `/${relative(directory, path).split(sep).join("/")}`;
    const bytes = await readFile(path);
    const extension = extname(path).slice(1);
    manifest[key] = {
      hash: blake3(`${bytes.toString("base64")}${extension}`)
        .toString("hex")
        .slice(0, 32),
      size: bytes.byteLength,
    };
  }
  return manifest;
}

async function readContainerImages(
  directory: string,
  required: boolean,
): Promise<Record<string, string>> {
  const byName = new Map<string, ImageDigestRecord>();
  try {
    for (const entry of await readdir(resolve(directory), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const record = JSON.parse(
        await readFile(join(resolve(directory), entry.name), "utf8"),
      ) as ImageDigestRecord;
      if (record.name) byName.set(record.name, record);
    }
  } catch (error) {
    if (!required) return {};
    throw error;
  }
  const runtime = byName.get("takos-worker-runtime")?.cloudflareRegistryRef;
  const executor = byName.get("takos-agent-executor")?.cloudflareRegistryRef;
  if (required && (!runtime || !executor)) {
    throw new Error(
      "Cloudflare runtime and executor image refs are required for the Takos Worker release artifact.",
    );
  }
  return {
    ...(runtime ? { runtime } : {}),
    ...(executor ? { executor } : {}),
  };
}

async function walkFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walkFiles(path)));
    else if (entry.isFile()) output.push(path);
    else throw new Error(`Release assets may not contain links: ${path}`);
  }
  return output.sort();
}

async function assertRegularFile(path: string, label: string) {
  const entry = await lstat(path);
  if (!entry.isFile()) throw new Error(`${label} is missing at ${path}`);
}

async function assertDirectory(path: string, label: string) {
  const entry = await stat(path);
  if (!entry.isDirectory()) throw new Error(`${label} is missing at ${path}`);
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(
      `${basename(command)} failed with exit code ${result.status ?? "unknown"}`,
    );
  }
}

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();
  let requireCloudflareContainerImages = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--require-cloudflare-container-images") {
      requireCloudflareContainerImages = true;
      continue;
    }
    const value = args[++index];
    if (!name?.startsWith("--") || !value) usage();
    values.set(name, value);
  }
  const releaseTag = values.get("--release-tag");
  if (!releaseTag) usage();
  return {
    bundleDir: values.get("--bundle-dir") ?? "/tmp/takos-worker-bundle",
    assetsDir: values.get("--assets-dir") ?? "dist",
    imageDigestDir: values.get("--image-digest-dir") ?? "dist/image-digests",
    outputDir: values.get("--output-dir") ?? "dist/takosumi-artifact",
    releaseTag,
    requireCloudflareContainerImages,
  };
}

function assertReleaseTag(value: string) {
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new Error(
      `release tag must be SemVer-like and start with v: ${value}`,
    );
  }
}

function usage(): never {
  console.error(
    "Usage: bun scripts/build-worker-release-artifact.ts --release-tag <vsemver> [--bundle-dir <path>] [--assets-dir <path>] [--image-digest-dir <path>] [--output-dir <path>] [--require-cloudflare-container-images]",
  );
  process.exit(2);
}
