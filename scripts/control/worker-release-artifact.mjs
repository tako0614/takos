import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const MAX_WORKER_RELEASE_ARCHIVE_BYTES = 64 * 1024 * 1024;

export function workerReleaseArtifactConfig(env = process.env) {
  const url = stringValue(env.TAKOS_RELEASE_WORKER_ARTIFACT_URL);
  const digest = normalizeSha256(env.TAKOS_RELEASE_WORKER_ARTIFACT_SHA256);
  if (!url && !digest) return undefined;
  if (!url || !digest) {
    throw new Error(
      "TAKOS_RELEASE_WORKER_ARTIFACT_URL and TAKOS_RELEASE_WORKER_ARTIFACT_SHA256 must be set together.",
    );
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Takos Worker release artifact URL must use https.");
  }
  return { url: parsed.toString(), sha256: digest };
}

export function workerReleaseArtifactDir(environment) {
  return resolve("deploy/cloudflare", `.takos-release-artifact.${environment}`);
}

export async function prepareWorkerReleaseArtifact({
  config,
  environment,
  wranglerConfigPath,
  artifactRoot,
  fetchImpl = globalThis.fetch,
}) {
  const root = artifactRoot
    ? resolve(artifactRoot)
    : workerReleaseArtifactDir(environment);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const archivePath = join(root, "release.tar.gz");
  const contentRoot = join(root, "content");

  try {
    const response = await fetchImpl(config.url, {
      headers: { accept: "application/gzip, application/octet-stream" },
    });
    if (!response.ok) {
      throw new Error(
        `Takos Worker release artifact download failed: HTTP ${response.status}`,
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_WORKER_RELEASE_ARCHIVE_BYTES
    ) {
      throw new Error("Takos Worker release artifact exceeds the size limit.");
    }
    const bytes = await readLimitedResponseBytes(
      response,
      MAX_WORKER_RELEASE_ARCHIVE_BYTES,
    );
    const actualDigest = await sha256Hex(bytes);
    if (actualDigest !== config.sha256) {
      throw new Error(
        `Takos Worker release artifact SHA-256 mismatch: expected ${config.sha256}, received ${actualDigest}`,
      );
    }
    writeFileSync(archivePath, bytes, { mode: 0o600 });
    assertSafeArchive(archivePath);
    mkdirSync(contentRoot, { recursive: true });
    execFileSync(
      "tar",
      [
        "-xzf",
        archivePath,
        "-C",
        contentRoot,
        "--no-same-owner",
        "--no-same-permissions",
      ],
      { stdio: "pipe" },
    );

    const workerPath = join(contentRoot, "worker/index.js");
    const assetsPath = join(contentRoot, "assets");
    const assetManifestPath = join(contentRoot, "asset-manifest.json");
    assertRegularFile(workerPath, "worker/index.js");
    assertDirectory(assetsPath, "assets");
    assertRegularFile(assetManifestPath, "asset-manifest.json");
    validateAssetManifest(assetManifestPath, assetsPath);
    patchWranglerArtifactPaths(wranglerConfigPath, {
      workerPath,
      assetsPath,
    });
    return {
      root,
      workerPath,
      assetsPath,
      assetManifestPath,
      sha256: actualDigest,
      sizeBytes: bytes.byteLength,
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

async function readLimitedResponseBytes(response, limit) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) {
      throw new Error("Takos Worker release artifact exceeds the size limit.");
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("release artifact size limit exceeded");
        throw new Error(
          "Takos Worker release artifact exceeds the size limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function cleanupWorkerReleaseArtifact(environment) {
  rmSync(workerReleaseArtifactDir(environment), {
    recursive: true,
    force: true,
  });
}

export function patchWranglerArtifactPaths(
  wranglerConfigPath,
  { workerPath, assetsPath },
) {
  const source = readFileSync(wranglerConfigPath, "utf8");
  let mainReplaced = false;
  let assetsReplaced = false;
  let inAssets = false;
  const lines = source.split("\n").map((line) => {
    if (/^\s*\[[^[]/u.test(line)) {
      inAssets = /^\s*\[assets\]\s*$/u.test(line);
    }
    if (!mainReplaced && /^\s*main\s*=/u.test(line)) {
      mainReplaced = true;
      return `main = ${JSON.stringify(resolve(workerPath))}`;
    }
    if (inAssets && !assetsReplaced && /^\s*directory\s*=/u.test(line)) {
      assetsReplaced = true;
      return `directory = ${JSON.stringify(resolve(assetsPath))}`;
    }
    return line;
  });
  if (!mainReplaced || !assetsReplaced) {
    throw new Error(
      "Rendered Wrangler config must declare top-level main and [assets].directory for a release artifact.",
    );
  }
  writeFileSync(wranglerConfigPath, lines.join("\n"));
}

function assertSafeArchive(archivePath) {
  const names = execFileSync("tar", ["-tzf", archivePath], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  const verbose = execFileSync("tar", ["-tvzf", archivePath], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  if (names.length === 0 || names.length !== verbose.length) {
    throw new Error("Takos Worker release artifact archive is malformed.");
  }
  for (const [index, rawName] of names.entries()) {
    const name = rawName.replace(/^\.\//u, "");
    const entryType = verbose[index]?.[0];
    if (!name && entryType === "d") continue;
    const segments = name.split("/");
    if (
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      segments.includes("..")
    ) {
      throw new Error(
        `Unsafe path in Takos Worker release artifact: ${rawName}`,
      );
    }
    if (entryType !== "-" && entryType !== "d") {
      throw new Error(
        `Takos Worker release artifact may contain only regular files and directories: ${rawName}`,
      );
    }
  }
}

function validateAssetManifest(manifestPath, assetsPath) {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Takos Worker asset manifest must be an object.");
  }
  const expected = new Set();
  for (const [key, entry] of Object.entries(parsed)) {
    if (
      !/^\/(?!\/)[^\\\0]+$/u.test(key) ||
      key.split("/").includes("..") ||
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.hash !== "string" ||
      !/^[a-f0-9]{32}$/u.test(entry.hash) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0
    ) {
      throw new Error(`Takos Worker asset manifest entry is invalid: ${key}`);
    }
    const relativePath = key.slice(1);
    const filePath = resolve(assetsPath, relativePath);
    if (!filePath.startsWith(`${resolve(assetsPath)}${sep}`)) {
      throw new Error(
        `Takos Worker asset manifest path escapes assets: ${key}`,
      );
    }
    assertRegularFile(filePath, key);
    if (statSync(filePath).size !== entry.size) {
      throw new Error(`Takos Worker asset size mismatch: ${key}`);
    }
    expected.add(relativePath.split(sep).join("/"));
  }
  const actual = new Set(
    walkFiles(assetsPath).map((path) =>
      relative(assetsPath, path).split(sep).join("/"),
    ),
  );
  if (
    expected.size !== actual.size ||
    [...expected].some((path) => !actual.has(path))
  ) {
    throw new Error("Takos Worker asset manifest does not match the archive.");
  }
}

function walkFiles(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(path));
    else if (entry.isFile()) output.push(path);
    else
      throw new Error(`Takos Worker release artifact entry is unsafe: ${path}`);
  }
  return output.sort();
}

function assertRegularFile(path, label) {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Takos Worker release artifact is missing ${label}.`);
  }
}

function assertDirectory(path, label) {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(`Takos Worker release artifact is missing ${label}.`);
  }
}

function stringValue(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function normalizeSha256(value) {
  const normalized = stringValue(value)?.replace(/^sha256:/u, "");
  if (!normalized) return undefined;
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error("Takos Worker release artifact SHA-256 is invalid.");
  }
  return normalized;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
