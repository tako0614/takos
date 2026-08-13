#!/usr/bin/env bun

import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  smokeWorkerReleaseArchive,
  type WorkerReleaseSmokeResult,
} from "./smoke-worker-release-artifact.ts";
import {
  assertTakosumiCompositionSourceIdentityMatch,
  parseTakosumiCompositionSourceIdentity,
  verifyTakosumiCompositionSource,
  type TakosumiCompositionSourceIdentity,
} from "./check-takosumi-composition-source.ts";

const REPOSITORY = "tako0614/takos";
const IMAGE_NAMES = ["takos-agent"] as const;
const DIGEST_REF =
  /^registry\.cloudflare\.com\/([0-9a-f]{32})\/(takos-agent)@(sha256:[0-9a-f]{64})$/u;
const PUBLIC_AGENT_DIGEST_REF =
  /^ghcr\.io\/tako0614\/takos-agent@(sha256:[0-9a-f]{64})$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ACCOUNT_ID = /^[0-9a-f]{32}$/u;
const SEMVER_TAG = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const MAX_IMAGE_LAYERS = 256;

export const TAKOS_RELEASE_ARTIFACT_SURFACE = {
  surface: "takos-release-artifact",
  target: "github-release-cloudflare-registry-and-public-oci:takos",
  covers: [
    "deploy/cloudflare/wrangler.toml",
    "containers/agent",
    "takosumi-composition-source.json",
    "tsconfig.json",
    "scripts/check-takosumi-composition-source.ts",
    "scripts/build-worker-release-artifact.ts",
    "scripts/smoke-worker-release-artifact.ts",
  ],
  requiresScripts: ["check", "deploy", "release-worker-artifact:build"],
  requiresTools: ["bun", "docker", "git", "gh", "tar", "wrangler"],
  requiresEnv: [],
  triggers: ["published-identity", "authority", "irreversible"],
  obligations: {
    provenance:
      "prepare binds clean pushed Takos main, package version, the Takos-owned exact Takosumi composition pin and clean physical sibling source, pinned agent-engine commit, target Cloudflare account, digest-pinned Cloudflare images, the same agent bytes in public GHCR, exact Worker archive bytes, and descriptor digest in operator-private evidence",
    "post-conditions":
      "publish anonymously re-reads the prepared public GHCR agent identity, verifies the create-only remote tag resolves to the prepared commit, downloads every GitHub release asset to recheck its exact SHA-256, then boots the exact downloaded Worker archive in Wrangler local workerd and exercises Takos health, auth-boundary API, and product discovery responses",
    reversal:
      "published Git tags, registry digest references, and release assets are immutable identities; correction uses a new package version and tag rather than overwriting bytes",
    "failure-handling":
      "both phases are dry-run by default, redact provider output, record no credentials, refuse conflicting identities, and after a possible lost acknowledgment accept success only from authoritative exact tag, release, asset, and runtime readback; otherwise publication is indeterminate and must not be retried",
    "no-overwrite":
      "prepare uses non-authoritative nonce upload tags in both registries and rejects existing output/evidence paths; publish requires absent tag and Release identities and performs one create-only GitHub Release operation containing the complete asset closure, with no update, upload, edit, delete, force, or retry path",
    "pre-mutation-proof":
      "prepare reruns the portable complete gate, proves clean pushed Takos main and unused version tag/release identities, verifies the exact non-symlink ../takosumi checkout against the composition pin plus synchronized local/live origin/main and canonical ancestry before and after compilation, verifies the registry config account against the operator account file, fetches the pinned agent engine commit from its canonical remote, and completes both local image and Worker builds before the first remote push",
    "independent-review":
      "the release publisher implementation and its dry-run/mutation boundary receive an independent review before execute; no task, branch, green check, or source repository authorizes publication by itself",
  },
} as const;

type Phase = "prepare" | "publish";

export type ReleaseArtifactOptions = Readonly<{
  phase: Phase;
  tag: string;
  evidence: string;
  execute: boolean;
  config?: string;
  accountIdFile?: string;
  tokenFile?: string;
  outputDir?: string;
  prepareEvidence?: string;
}>;

export type ReleaseArtifactRuntime = Readonly<{
  verifyTakosumiCompositionSource?: (
    takosRoot: string,
  ) => Promise<TakosumiCompositionSourceIdentity>;
}>;

type CommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

/**
 * Registry-independent identity for a single-platform image manifest.
 *
 * Registry manifest digests are not sufficient here: registries may rewrite
 * the outer media type while preserving the image bytes.  The config digest
 * and ordered layer digests are the bounded, content-bearing identity we
 * record in release evidence instead.
 */
export type ImageContentIdentity = Readonly<{
  configDigest: string;
  layerDigests: readonly string[];
}>;

export type ImageManifestReadback = Readonly<{
  manifestDigest: string;
  content: ImageContentIdentity;
}>;

export function isolatedDockerEnv(
  baseEnv: NodeJS.ProcessEnv,
  dockerConfig: string,
): NodeJS.ProcessEnv {
  if (!dockerConfig || !dockerConfig.startsWith("/")) {
    throw new Error("isolated Docker config path must be absolute");
  }
  const isolated = { ...baseEnv, DOCKER_CONFIG: dockerConfig };
  // DOCKER_AUTH_CONFIG bypasses DOCKER_CONFIG and can silently reintroduce
  // operator credentials into the supposedly isolated registry session.
  delete isolated.DOCKER_AUTH_CONFIG;
  return isolated;
}

export function assertImageContentMatch(
  left: ImageContentIdentity,
  right: ImageContentIdentity,
): void {
  if (
    left.configDigest !== right.configDigest ||
    left.layerDigests.length !== right.layerDigests.length ||
    left.layerDigests.some(
      (digest, index) => digest !== right.layerDigests[index],
    )
  ) {
    throw new Error(
      "Cloudflare and public agent image content identities differ",
    );
  }
}

export function assertPublicAgentReadback(
  expectedReference: string,
  expectedContent: ImageContentIdentity,
  actual: ImageManifestReadback,
): void {
  const expectedDigest = expectedReference.match(PUBLIC_AGENT_DIGEST_REF)?.[1];
  if (expectedDigest !== actual.manifestDigest) {
    throw new Error("public GHCR agent image anonymous readback drifted");
  }
  try {
    assertImageContentMatch(expectedContent, actual.content);
  } catch {
    throw new Error("public GHCR agent image anonymous content drifted");
  }
}

type PreparedRecord = Readonly<{
  kind: "takos.release-artifact-prepare@v2";
  status: "prepared";
  tag: string;
  commit: string;
  version: string;
  repository: typeof REPOSITORY;
  takosumiCompositionSource: TakosumiCompositionSourceIdentity;
  accountId: string;
  portableCheck: { command: "bun run check"; status: "passed" };
  outputDir: string;
  descriptor: { path: string; digest: string; url: string };
  assets: readonly { name: string; path: string; digest: string }[];
  images: Readonly<Record<(typeof IMAGE_NAMES)[number], string>>;
  publicAgentImage: string;
  imageContent: Readonly<{
    cloudflare: ImageContentIdentity;
    publicOci: ImageContentIdentity;
  }>;
  workerSmoke: WorkerReleaseSmokeResult;
  observedAt: string;
}>;

export const RELEASE_ARTIFACT_USAGE = `Takos release artifact deployment

Usage:
  bun run deploy -- takos-release-artifact prepare --tag <vsemver> --config <absolute-wrangler.toml> --account-id-file <absolute-0600-file> --cloudflare-api-token-file <absolute-0600-file> --output-dir <absolute-private-dir> --evidence <absolute-json> [--execute]
  bun run deploy -- takos-release-artifact publish --tag <vsemver> --prepare-evidence <absolute-json> --evidence <absolute-json> [--execute]

Both phases are read-only without --execute. Secret values and provider command
output are never written to evidence or stdout.`;

export function parseReleaseArtifactArgs(
  args: readonly string[],
): ReleaseArtifactOptions {
  const [phaseValue, ...rest] = args;
  if (phaseValue !== "prepare" && phaseValue !== "publish") {
    throw new Error(RELEASE_ARTIFACT_USAGE);
  }
  const values = new Map<string, string>();
  let execute = false;
  const allowed = new Set([
    "tag",
    "config",
    "account-id-file",
    "cloudflare-api-token-file",
    "output-dir",
    "evidence",
    "prepare-evidence",
  ]);
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (token === "--execute") {
      if (execute) throw new Error("duplicate argument: --execute");
      execute = true;
      continue;
    }
    if (!token.startsWith("--") || !allowed.has(token.slice(2))) {
      throw new Error(`unknown argument: ${token}`);
    }
    const key = token.slice(2);
    if (values.has(key)) throw new Error(`duplicate argument: --${key}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    values.set(key, value);
    index += 1;
  }
  const required = (name: string): string => {
    const value = values.get(name)?.trim();
    if (!value) throw new Error(`--${name} is required`);
    return value;
  };
  const tag = required("tag");
  if (!SEMVER_TAG.test(tag)) throw new Error("--tag must be v-prefixed SemVer");
  const common = {
    phase: phaseValue,
    tag,
    evidence: required("evidence"),
    execute,
  } as const;
  if (phaseValue === "prepare") {
    if (values.has("prepare-evidence")) {
      throw new Error("--prepare-evidence is publish-only");
    }
    return {
      ...common,
      config: required("config"),
      accountIdFile: required("account-id-file"),
      tokenFile: required("cloudflare-api-token-file"),
      outputDir: required("output-dir"),
    };
  }
  for (const name of [
    "config",
    "account-id-file",
    "cloudflare-api-token-file",
    "output-dir",
  ]) {
    if (values.has(name)) throw new Error(`--${name} is prepare-only`);
  }
  return { ...common, prepareEvidence: required("prepare-evidence") };
}

export async function runReleaseArtifact(
  options: ReleaseArtifactOptions,
  runtime: ReleaseArtifactRuntime = {},
): Promise<unknown> {
  assertCanonicalAuthorityEnvironment();
  const root = await realpath(resolve(import.meta.dir, ".."));
  const identity = await repositoryIdentity(root, options.execute);
  const verifyComposition = async () =>
    await (runtime.verifyTakosumiCompositionSource
      ? runtime.verifyTakosumiCompositionSource(root)
      : verifyTakosumiCompositionSource({ takosRoot: root }));
  const takosumiCompositionSource = await verifyComposition();
  const version = await packageVersion(root);
  if (options.tag !== `v${version}`) {
    throw new Error(`release tag must equal package version v${version}`);
  }
  await assertPrivatePath(options.evidence, root, false);
  if (options.phase === "prepare") {
    return await prepareRelease(
      root,
      identity.commit,
      version,
      takosumiCompositionSource,
      verifyComposition,
      options,
    );
  }
  return await publishRelease(
    root,
    identity.commit,
    version,
    takosumiCompositionSource,
    options,
  );
}

async function prepareRelease(
  root: string,
  commit: string,
  version: string,
  takosumiCompositionSource: TakosumiCompositionSourceIdentity,
  verifyComposition: () => Promise<TakosumiCompositionSourceIdentity>,
  options: ReleaseArtifactOptions,
): Promise<unknown> {
  const config = await physicalFile(options.config!, "config", false);
  const accountIdFile = await physicalFile(
    options.accountIdFile!,
    "account id file",
    true,
  );
  const tokenFile = await physicalFile(options.tokenFile!, "token file", true);
  const accountId = (await readFile(accountIdFile, "utf8")).trim();
  if (!ACCOUNT_ID.test(accountId)) throw new Error("account id file is invalid");
  await assertRegistryConfigAccount(config, accountId);
  const outputDir = resolve(options.outputDir!);
  await assertPrivatePath(outputDir, root, false);
  await assertRemoteReleaseIdentityAvailable(root, options.tag, commit, true);

  const planned = {
    kind: "takos.release-artifact-prepare@v2",
    status: "planned",
    tag: options.tag,
    commit,
    version,
    repository: REPOSITORY,
    takosumiCompositionSource,
    accountId,
    outputDir,
    observedAt: new Date().toISOString(),
  } as const;
  if (!options.execute) return planned;
  await ensurePathAbsent(options.evidence);
  await ensurePathAbsent(outputDir);
  await checked(root, "bun", ["run", "check"]);
  assertTakosumiCompositionSourceIdentityMatch(
    takosumiCompositionSource,
    await verifyComposition(),
  );
  await mkdir(outputDir, { recursive: false, mode: 0o700 });
  await chmod(outputDir, 0o700);

  const token = (await readFile(tokenFile, "utf8")).trim();
  if (token.length < 20 || token.length > 16_384) {
    throw new Error("Cloudflare API token file is invalid");
  }
  const providerEnv = { ...process.env };
  for (const name of CLOUDFLARE_AMBIGUOUS_ENV) delete providerEnv[name];
  providerEnv.CLOUDFLARE_API_TOKEN = token;
  providerEnv.CLOUDFLARE_ACCOUNT_ID = accountId;
  providerEnv.WRANGLER_SEND_METRICS = "false";
  const imageTag = `${version}-${commit.slice(0, 12)}-${randomBytes(8).toString("hex")}`;
  const temporary = await mkdtemp(join(tmpdir(), "takos-release-artifact-"));
  try {
    const cloudflareDockerConfig = join(
      temporary,
      "cloudflare-docker-config",
    );
    await mkdir(cloudflareDockerConfig, { mode: 0o700 });
    const cloudflareEnv = isolatedDockerEnv(
      providerEnv,
      cloudflareDockerConfig,
    );
    const agentContext = await prepareAgentBuildContext(root, temporary);
    const agentLocal = `takos-agent:${imageTag}`;
    await checked(root, "docker", [
      "buildx",
      "build",
      "--load",
      "--platform",
      "linux/amd64",
      "--file",
      join(agentContext, "takos/containers/agent/Dockerfile"),
      "--tag",
      agentLocal,
      agentContext,
    ]);
    assertTakosumiCompositionSourceIdentityMatch(
      takosumiCompositionSource,
      await verifyComposition(),
    );
    await checked(root, "bun", ["run", "web:build"]);
    const bundleDir = join(temporary, "worker-bundle");
    await mkdir(bundleDir, { mode: 0o700 });
    await checked(root, "bunx", [
      "wrangler",
      "deploy",
      "--config",
      join(root, "deploy/cloudflare/wrangler.toml"),
      "--env=",
      "--dry-run",
      "--containers-rollout",
      "none",
      "--outdir",
      bundleDir,
    ], cloudflareEnv);
    const epoch = (
      await checked(root, "git", ["show", "-s", "--format=%ct", commit])
    ).stdout.trim();
    const preflightImageDir = join(temporary, "preflight-image-digests");
    const preflightOutputDir = join(temporary, "preflight-worker-artifact");
    await mkdir(preflightImageDir, { mode: 0o700 });
    await buildReleaseAssets(
      root,
      options.tag,
      commit,
      epoch,
      bundleDir,
      preflightImageDir,
      preflightOutputDir,
      false,
    );
    const preflightArchive = join(
      preflightOutputDir,
      "takos-worker-release.tar.gz",
    );
    const preflightArchiveDigest = await fileDigest(preflightArchive);
    await assertSourceWorkerIdentity(
      root,
      options.tag,
      commit,
      preflightArchiveDigest,
      takosumiCompositionSource,
      join(preflightOutputDir, "takosumi-artifact.json"),
    );
    const workerSmoke = await smokeWorkerReleaseArchive(root, preflightArchive);
    if (workerSmoke.archiveDigest !== preflightArchiveDigest) {
      throw new Error("Worker smoke did not exercise the preflight archive bytes");
    }
    assertTakosumiCompositionSourceIdentityMatch(
      takosumiCompositionSource,
      await verifyComposition(),
    );
    const cloudflareAgent = await pushImage(
      root,
      config,
      agentLocal,
      accountId,
      cloudflareEnv,
      temporary,
    );
    const publicAgent = await pushPublicAgentImage(
      root,
      agentLocal,
      imageTag,
      temporary,
      cloudflareAgent.content,
    );
    assertImageContentMatch(cloudflareAgent.content, publicAgent.content);
    const images = {
      "takos-agent": cloudflareAgent.reference,
    } as const;
    const imageDir = join(temporary, "image-digests");
    await mkdir(imageDir, { mode: 0o700 });
    for (const name of IMAGE_NAMES) {
      await writeFile(
        join(imageDir, `${name}.json`),
        `${JSON.stringify({
          name,
          cloudflareRegistryRef: images[name],
          ...(name === "takos-agent"
            ? { publicOciRef: publicAgent.reference }
            : {}),
        })}\n`,
        { mode: 0o600 },
      );
    }
    await buildReleaseAssets(
      root,
      options.tag,
      commit,
      epoch,
      bundleDir,
      imageDir,
      outputDir,
      true,
    );
    await assertSourceWorkerIdentity(
      root,
      options.tag,
      commit,
      preflightArchiveDigest,
      takosumiCompositionSource,
      join(outputDir, "takosumi-artifact.json"),
    );
    await chmod(outputDir, 0o700);
    const assetNames = [
      "takos-worker-release.tar.gz",
      "takos-worker-release.tar.gz.sha256",
      "takosumi-artifact.json",
    ] as const;
    await Promise.all(
      assetNames.map((name) => chmod(join(outputDir, name), 0o600)),
    );
    const assets = await Promise.all(
      assetNames.map(async (name) => ({
        name,
        path: join(outputDir, name),
        digest: await fileDigest(join(outputDir, name)),
      })),
    );
    const descriptor = assets.find(
      (asset) => asset.name === "takosumi-artifact.json",
    )!;
    const workerArchive = assets.find(
      (asset) => asset.name === "takos-worker-release.tar.gz",
    )!;
    if (workerArchive.digest !== preflightArchiveDigest) {
      throw new Error("Worker archive changed after registry image readback");
    }
    const record: PreparedRecord = {
      kind: "takos.release-artifact-prepare@v2",
      status: "prepared",
      tag: options.tag,
      commit,
      version,
      repository: REPOSITORY,
      takosumiCompositionSource,
      accountId,
      portableCheck: { command: "bun run check", status: "passed" },
      outputDir,
      descriptor: {
        path: descriptor.path,
        digest: descriptor.digest,
        url: `https://github.com/${REPOSITORY}/releases/download/${options.tag}/takosumi-artifact.json`,
      },
      assets,
      images,
      publicAgentImage: publicAgent.reference,
      imageContent: {
        cloudflare: cloudflareAgent.content,
        publicOci: publicAgent.content,
      },
      workerSmoke,
      observedAt: new Date().toISOString(),
    };
    await writePrivateJson(options.evidence, record);
    return publicPrepareResult(record);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function buildReleaseAssets(
  root: string,
  tag: string,
  commit: string,
  epoch: string,
  bundleDir: string,
  imageDigestDir: string,
  outputDir: string,
  requireCloudflareContainerImages: boolean,
): Promise<void> {
  await checked(
    root,
    "bun",
    [
      "scripts/build-worker-release-artifact.ts",
      "--release-tag",
      tag,
      "--bundle-dir",
      bundleDir,
      "--assets-dir",
      join(root, "dist"),
      "--image-digest-dir",
      imageDigestDir,
      "--output-dir",
      outputDir,
      ...(requireCloudflareContainerImages
        ? ["--require-cloudflare-container-images"]
        : []),
    ],
    {
      ...process.env,
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_SHA: commit,
      GITHUB_REF_NAME: tag,
      SOURCE_DATE_EPOCH: epoch,
    },
  );
}

async function publishRelease(
  root: string,
  commit: string,
  version: string,
  takosumiCompositionSource: TakosumiCompositionSourceIdentity,
  options: ReleaseArtifactOptions,
): Promise<unknown> {
  const preparePath = await physicalFile(
    options.prepareEvidence!,
    "prepare evidence",
    true,
  );
  const prepared = parsePreparedRecord(
    JSON.parse(await readFile(preparePath, "utf8")) as unknown,
  );
  if (
    prepared.tag !== options.tag ||
    prepared.commit !== commit ||
    prepared.version !== version
  ) {
    throw new Error("prepare evidence does not match current release identity");
  }
  assertTakosumiCompositionSourceIdentityMatch(
    takosumiCompositionSource,
    prepared.takosumiCompositionSource,
  );
  await assertPrivatePath(prepared.outputDir, root, true);
  await physicalDirectory(prepared.outputDir, "prepared output directory");
  for (const asset of prepared.assets) {
    await assertPrivatePath(asset.path, root, true);
    await physicalFile(asset.path, `prepared asset ${asset.name}`, true);
    if ((await fileDigest(asset.path)) !== asset.digest) {
      throw new Error(`prepared asset changed: ${asset.name}`);
    }
  }
  await assertRemoteReleaseIdentityAvailable(root, options.tag, commit, true);
  const planned = {
    kind: "takos.release-artifact-publish@v2",
    status: "planned",
    tag: options.tag,
    commit,
    takosumiCompositionSource,
    descriptor: prepared.descriptor,
    observedAt: new Date().toISOString(),
  } as const;
  if (!options.execute) return planned;
  await ensurePathAbsent(options.evidence);

  // The prepared digest is the only public identity available to this phase.
  // Re-read it anonymously immediately before creating the release
  // so a deleted/private GHCR package cannot be published as usable output.
  await assertPreparedPublicAgentReadback(root, prepared);
  const localArchive = prepared.assets.find(
    (asset) => asset.name === "takos-worker-release.tar.gz",
  )!;
  const localSmoke = await smokeWorkerReleaseArchive(root, localArchive.path);
  if (localSmoke.archiveDigest !== localArchive.digest) {
    throw new Error("pre-publication smoke did not exercise the prepared bytes");
  }
  const creation = await command(
    root,
    "gh",
    createOnlyReleaseCommand(
      options.tag,
      commit,
      prepared.assets.map((asset) => asset.path),
    ),
  );
  let verified: PublishedReleaseVerification;
  try {
    verified = await verifyPublishedRelease(root, prepared);
  } catch (error) {
    const outcome = creation.exitCode === 0
      ? "create-only publication was acknowledged but its exact post-condition failed"
      : "publication may have lost its acknowledgment and is indeterminate";
    throw new Error(
      `${outcome}; do not retry or mutate the identity. Authoritative readback failed: ${
        error instanceof Error ? error.message : String(error)
      }${commandFailureDetail(creation)}`,
    );
  }
  const publicationAcknowledgment =
    creation.exitCode === 0 ? "confirmed" : "lost-acknowledgment-read-back";
  const record = {
    kind: "takos.release-artifact-publish@v2",
    status: "published",
    tag: options.tag,
    commit,
    takosumiCompositionSource,
    releaseUrl: verified.release.url,
    descriptor: prepared.descriptor,
    assetDigests: Object.fromEntries(
      prepared.assets.map((asset) => [asset.name, asset.digest]),
    ),
    images: prepared.images,
    publicAgentImage: prepared.publicAgentImage,
    imageContent: prepared.imageContent,
    githubImmutable: verified.release.isImmutable,
    publicationAcknowledgment,
    workerSmoke: verified.workerSmoke,
    observedAt: new Date().toISOString(),
  } as const;
  await writePrivateJson(options.evidence, record);
  return record;
}

async function repositoryIdentity(
  root: string,
  requireMain: boolean,
): Promise<{ commit: string }> {
  const status = await checked(root, "git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status.stdout.trim()) throw new Error("Takos repository must be clean");
  const branch = (await checked(root, "git", ["branch", "--show-current"]))
    .stdout.trim();
  if (!branch) throw new Error("Takos repository must not be detached");
  if (requireMain && branch !== "main") {
    throw new Error("Takos release execution must be on main");
  }
  const originUrl = (
    await checked(root, "git", ["remote", "get-url", "origin"])
  ).stdout.trim();
  if (originUrl !== "https://github.com/tako0614/takos.git") {
    throw new Error("Takos origin must be the canonical GitHub repository");
  }
  const commit = (await checked(root, "git", ["rev-parse", "HEAD"]))
    .stdout.trim();
  const upstream = requireMain || branch === "main"
    ? "origin/main"
    : (await checked(root, "git", [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ])).stdout.trim();
  if (!upstream.startsWith("origin/") || upstream === "origin/") {
    throw new Error("Takos branch must track the canonical origin");
  }
  const origin = (await checked(root, "git", ["rev-parse", upstream]))
    .stdout.trim();
  const remoteBranch = upstream.slice("origin/".length);
  const remote = (
    await checked(root, "git", [
      "ls-remote",
      "--exit-code",
      "origin",
      `refs/heads/${remoteBranch}`,
    ])
  ).stdout.trim().split(/\s+/u)[0];
  if (!COMMIT.test(commit) || commit !== origin || commit !== remote) {
    throw new Error("Takos HEAD must equal its pushed canonical origin branch");
  }
  return { commit };
}

async function packageVersion(root: string): Promise<string> {
  const value = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as { version?: unknown; takosRelease?: { version?: unknown } };
  const version = value.takosRelease?.version;
  if (typeof version !== "string" || value.version !== version) {
    throw new Error("package release versions are missing or inconsistent");
  }
  if (!SEMVER_TAG.test(`v${version}`)) {
    throw new Error("package release version is not SemVer");
  }
  return version;
}

async function assertSourceWorkerIdentity(
  root: string,
  tag: string,
  commit: string,
  archiveDigest: string,
  takosumiCompositionSource: TakosumiCompositionSourceIdentity,
  descriptorPath: string,
): Promise<void> {
  const source = await readFile(
    join(root, "deploy/opentofu/takoform/main.tf"),
    "utf8",
  );
  const moduleDefault = (name: string): string | undefined => {
    const block = source.match(
      new RegExp(`variable\\s+"${name}"\\s*\\{([\\s\\S]*?)\\n\\}`, "u"),
    )?.[1];
    return block?.match(/\bdefault\s+=\s+"([^"]+)"/u)?.[1];
  };
  const expectedUrl =
    `https://github.com/${REPOSITORY}/releases/download/${tag}/takos-worker-release.tar.gz`;
  if (
    moduleDefault("worker_release_tag") !== tag ||
    moduleDefault("worker_artifact_url") !== expectedUrl ||
    moduleDefault("worker_artifact_sha256") !== archiveDigest
  ) {
    throw new Error(
      "portable Takoform defaults do not select the exact prepared Worker release",
    );
  }
  const descriptor = JSON.parse(
    await readFile(descriptorPath, "utf8"),
  ) as Record<string, unknown>;
  if (
    descriptor.kind !== "takosumi.worker-artifact@v2" ||
    descriptor.app !== "takos" ||
    descriptor.commit !== commit ||
    descriptor.releaseTag !== tag
  ) {
    throw new Error("Worker artifact descriptor source identity is invalid");
  }
  assertTakosumiCompositionSourceIdentityMatch(
    takosumiCompositionSource,
    parseTakosumiCompositionSourceIdentity(
      descriptor.takosumiCompositionSource,
    ),
  );
}

async function prepareAgentBuildContext(
  root: string,
  temporary: string,
): Promise<string> {
  const contract = JSON.parse(
    await readFile(join(root, "containers/agent/engine-source.json"), "utf8"),
  ) as { repository?: unknown; commit?: unknown };
  if (
    contract.repository !== "tako0614/takos-agent-engine" ||
    typeof contract.commit !== "string" ||
    !COMMIT.test(contract.commit)
  ) {
    throw new Error("agent engine source pin is invalid");
  }
  const context = join(temporary, "agent-context");
  const source = join(root, "containers/agent");
  const destination = join(context, "takos/containers/agent");
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const name of ["Cargo.toml", "Cargo.lock", "Dockerfile"] as const) {
    await cp(join(source, name), join(destination, name));
  }
  await cp(join(source, "src"), join(destination, "src"), {
    recursive: true,
  });
  const engine = join(context, "takos-agent-engine");
  await mkdir(engine, { mode: 0o700 });
  await checked(engine, "git", ["init", "--quiet"]);
  await checked(engine, "git", [
    "remote",
    "add",
    "origin",
    "https://github.com/tako0614/takos-agent-engine.git",
  ]);
  await checked(engine, "git", [
    "fetch",
    "--quiet",
    "--depth=1",
    "origin",
    contract.commit,
  ]);
  await checked(engine, "git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  const fetchedCommit = (await checked(engine, "git", ["rev-parse", "HEAD"]))
    .stdout.trim();
  if (fetchedCommit !== contract.commit) {
    throw new Error("agent engine remote commit readback is inconsistent");
  }
  return context;
}

async function pushImage(
  root: string,
  config: string,
  localTag: string,
  accountId: string,
  env: NodeJS.ProcessEnv,
  temporary: string,
): Promise<{ reference: string; content: ImageContentIdentity }> {
  const local = /^(takos-agent):([0-9A-Za-z._-]+)$/u.exec(
    localTag,
  );
  if (!local) throw new Error("local release image tag is invalid");
  const name = local[1]!;
  const dockerConfig = join(temporary, "cloudflare-docker-config");
  await mkdir(dockerConfig, { recursive: true, mode: 0o700 });
  const dockerEnv = isolatedDockerEnv(env, dockerConfig);
  await checked(
    root,
    "bunx",
    ["wrangler", "containers", "push", localTag, "--config", config],
    dockerEnv,
  );
  const remoteTag = `registry.cloudflare.com/${accountId}/${localTag}`;
  const manifest = await imageManifestReadback(root, remoteTag, dockerEnv);
  return {
    reference: `registry.cloudflare.com/${accountId}/${name}@${manifest.manifestDigest}`,
    content: manifest.content,
  };
}

async function pushPublicAgentImage(
  root: string,
  localTag: string,
  imageTag: string,
  temporary: string,
  expectedCloudflareContent: ImageContentIdentity,
): Promise<{ reference: string; content: ImageContentIdentity }> {
  const dockerConfig = join(temporary, "ghcr-docker-config");
  await mkdir(dockerConfig, { mode: 0o700 });
  const token = (await checked(root, "gh", ["auth", "token"])).stdout.trim();
  if (token.length < 20 || token.length > 16_384) {
    throw new Error("GitHub authentication token is invalid");
  }
  const env = isolatedDockerEnv(process.env, dockerConfig);
  await checkedWithInput(
    root,
    "docker",
    ["login", "ghcr.io", "--username", "tako0614", "--password-stdin"],
    `${token}\n`,
    env,
  );
  const remoteTag = `ghcr.io/tako0614/takos-agent:${imageTag}`;
  await checked(root, "docker", ["tag", localTag, remoteTag], env);
  await checked(root, "docker", ["push", remoteTag], env);
  const authenticated = await imageManifestReadback(root, remoteTag, env);
  assertImageContentMatch(expectedCloudflareContent, authenticated.content);

  const anonymousConfig = join(temporary, "ghcr-anonymous-config");
  await mkdir(anonymousConfig, { mode: 0o700 });
  const anonymous = await imageManifestReadback(
    root,
    remoteTag,
    isolatedDockerEnv(process.env, anonymousConfig),
  );
  assertPublicAgentReadback(
    `ghcr.io/tako0614/takos-agent@${authenticated.manifestDigest}`,
    authenticated.content,
    anonymous,
  );
  return {
    reference: `ghcr.io/tako0614/takos-agent@${authenticated.manifestDigest}`,
    content: authenticated.content,
  };
}

async function imageManifestReadback(
  root: string,
  reference: string,
  env: NodeJS.ProcessEnv,
): Promise<ImageManifestReadback> {
  const manifest = await checked(
    root,
    "docker",
    ["manifest", "inspect", "-v", reference],
    env,
  );
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(manifest.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`published image manifest was invalid for ${reference}`);
  }
  const descriptor = parsed.Descriptor;
  const manifestDigest =
    descriptor && typeof descriptor === "object" && !Array.isArray(descriptor)
      ? (descriptor as Record<string, unknown>).digest
      : undefined;
  if (typeof manifestDigest !== "string" || !SHA256.test(manifestDigest)) {
    throw new Error(`published image digest was not observable for ${reference}`);
  }
  const body =
    parsed.OCIManifest ??
    parsed.SchemaV2Manifest ??
    parsed.DockerV2Schema2;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`published image content manifest was missing for ${reference}`);
  }
  const content = body as Record<string, unknown>;
  const config = content.config;
  const configDigest =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>).digest
      : undefined;
  const layers = content.layers;
  if (
    typeof configDigest !== "string" ||
    !SHA256.test(configDigest) ||
    !Array.isArray(layers) ||
    layers.length > MAX_IMAGE_LAYERS ||
    layers.some(
      (layer) =>
        !layer ||
        typeof layer !== "object" ||
        Array.isArray(layer) ||
        typeof (layer as Record<string, unknown>).digest !== "string" ||
        !SHA256.test((layer as Record<string, unknown>).digest as string),
    )
  ) {
    throw new Error(`published image content identity was invalid for ${reference}`);
  }
  return {
    manifestDigest,
    content: {
      configDigest,
      layerDigests: layers.map(
        (layer) => (layer as Record<string, unknown>).digest as string,
      ),
    },
  };
}

async function assertPreparedPublicAgentReadback(
  root: string,
  prepared: PreparedRecord,
): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "takos-release-ghcr-readback-"));
  try {
    const dockerConfig = join(temporary, "anonymous-docker-config");
    await mkdir(dockerConfig, { mode: 0o700 });
    const readback = await imageManifestReadback(
      root,
      prepared.publicAgentImage,
      isolatedDockerEnv(process.env, dockerConfig),
    );
    assertPublicAgentReadback(
      prepared.publicAgentImage,
      prepared.imageContent.publicOci,
      readback,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function assertRemoteReleaseIdentityAvailable(
  root: string,
  tag: string,
  commit: string,
  requireAbsent: boolean,
): Promise<void> {
  const tags = await command(root, "git", [
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  if (tags.exitCode !== 0) throw new Error("remote tag readback failed");
  const lines = tags.stdout.trim().split("\n").filter(Boolean);
  if (requireAbsent && lines.length > 0) {
    throw new Error(`remote tag already exists: ${tag}`);
  }
  if (!requireAbsent && lines.length > 0) {
    const resolved = lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`)) ?? lines[0]!;
    if (resolved.split(/\s+/u)[0] !== commit) {
      throw new Error(`remote tag ${tag} belongs to another commit`);
    }
  }
  const release = await readRelease(tag);
  if (requireAbsent && release) throw new Error(`GitHub release already exists: ${tag}`);
  if (!requireAbsent && release && !release.isDraft) {
    throw new Error(`GitHub release is already published: ${tag}`);
  }
}

export type ReleaseReadback = {
  isDraft: boolean;
  isPrerelease: boolean;
  isImmutable: boolean;
  tagName: string;
  url: string;
  assets: { name: string; digest?: string }[];
};

async function readRelease(tag: string): Promise<ReleaseReadback | undefined> {
  const result = await command(process.cwd(), "gh", [
    "release",
    "view",
    tag,
    "--repo",
    REPOSITORY,
    "--json",
    "isDraft,isPrerelease,isImmutable,tagName,url,assets",
  ]);
  if (result.exitCode !== 0) {
    if (/release not found|HTTP 404/iu.test(result.stderr)) return undefined;
    throw new Error("GitHub release readback failed");
  }
  const parsed = JSON.parse(result.stdout) as ReleaseReadback;
  if (
    typeof parsed.isDraft !== "boolean" ||
    typeof parsed.isPrerelease !== "boolean" ||
    typeof parsed.isImmutable !== "boolean" ||
    typeof parsed.tagName !== "string" ||
    typeof parsed.url !== "string" ||
    !Array.isArray(parsed.assets) ||
    parsed.assets.some(
      (asset) =>
        !asset ||
        typeof asset !== "object" ||
        typeof asset.name !== "string" ||
        (asset.digest !== undefined && typeof asset.digest !== "string"),
    )
  ) {
    throw new Error("GitHub release readback is invalid");
  }
  return parsed;
}

export function createOnlyReleaseCommand(
  tag: string,
  commit: string,
  assetPaths: readonly string[],
): string[] {
  return [
    "release",
    "create",
    tag,
    ...assetPaths,
    "--repo",
    REPOSITORY,
    "--target",
    commit,
    "--title",
    `Takos ${tag}`,
    "--notes",
    `Immutable Takos worker artifact for ${commit}.`,
  ];
}

export function assertPublishedReleaseReadback(
  tag: string,
  expectedAssets: readonly { name: string; digest: string }[],
  release: ReleaseReadback,
): void {
  if (
    release.tagName !== tag ||
    release.isDraft ||
    release.isPrerelease ||
    !release.isImmutable ||
    !release.url.trim()
  ) {
    throw new Error("published GitHub Release state is not exact and immutable");
  }
  const expectedByName = new Map(
    expectedAssets.map((asset) => [asset.name, asset.digest]),
  );
  if (
    release.assets.length !== expectedByName.size ||
    release.assets.some(
      (asset) => expectedByName.get(asset.name) !== asset.digest,
    )
  ) {
    throw new Error("published GitHub Release asset closure or digest drifted");
  }
}

type PublishedReleaseVerification = Readonly<{
  release: ReleaseReadback;
  workerSmoke: WorkerReleaseSmokeResult;
}>;

async function verifyPublishedRelease(
  root: string,
  prepared: PreparedRecord,
): Promise<PublishedReleaseVerification> {
  const deadline = Date.now() + 30_000;
  let lastReadbackError = "published identity was not visible";
  let release: ReleaseReadback | undefined;
  let metadataVerified = false;
  while (Date.now() < deadline) {
    try {
      const remoteCommit = await remoteTagCommit(root, prepared.tag);
      if (remoteCommit !== prepared.commit) {
        throw new Error(
          `published tag resolved to ${remoteCommit || "<missing>"}, expected ${prepared.commit}`,
        );
      }
      release = await readRelease(prepared.tag);
      if (!release) throw new Error("published GitHub Release is missing");
      assertPublishedReleaseReadback(prepared.tag, prepared.assets, release);
      metadataVerified = true;
      break;
    } catch (error) {
      lastReadbackError = error instanceof Error ? error.message : String(error);
      await Bun.sleep(250);
    }
  }
  if (!release || !metadataVerified) {
    throw new Error(`published identity readback timed out: ${lastReadbackError}`);
  }

  const directory = await mkdtemp(join(tmpdir(), "takos-release-readback-"));
  try {
    await checked(root, "gh", [
      "release",
      "download",
      prepared.tag,
      "--repo",
      REPOSITORY,
      "--dir",
      directory,
    ]);
    const downloadedNames = (await readdir(directory)).sort();
    const expectedNames = prepared.assets.map((asset) => asset.name).sort();
    if (downloadedNames.join("\n") !== expectedNames.join("\n")) {
      throw new Error("downloaded GitHub Release asset closure drifted");
    }
    for (const asset of prepared.assets) {
      const downloaded = join(directory, asset.name);
      await physicalFile(downloaded, `downloaded asset ${asset.name}`, false);
      if ((await fileDigest(downloaded)) !== asset.digest) {
        throw new Error(`downloaded release asset digest drifted: ${asset.name}`);
      }
    }
    const archive = prepared.assets.find(
      (asset) => asset.name === "takos-worker-release.tar.gz",
    )!;
    const workerSmoke = await smokeWorkerReleaseArchive(
      root,
      join(directory, archive.name),
    );
    if (workerSmoke.archiveDigest !== archive.digest) {
      throw new Error("downloaded Worker smoke exercised different bytes");
    }
    return { release, workerSmoke };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function remoteTagCommit(root: string, tag: string): Promise<string> {
  const remote = await command(root, "git", [
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  if (remote.exitCode !== 0) throw new Error("remote tag readback failed");
  const lines = remote.stdout.trim().split("\n").filter(Boolean);
  const resolved =
    lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`)) ?? lines[0];
  return resolved?.split(/\s+/u)[0] ?? "";
}

function commandFailureDetail(result: CommandResult): string {
  return result.exitCode === 0
    ? ""
    : ` Create command exited ${result.exitCode}; output is intentionally omitted.`;
}

function parsePreparedRecord(value: unknown): PreparedRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("prepare evidence is invalid");
  }
  const input = value as Record<string, unknown>;
  if (
    input.kind !== "takos.release-artifact-prepare@v2" ||
    input.status !== "prepared" ||
    typeof input.tag !== "string" ||
    typeof input.commit !== "string" ||
    typeof input.version !== "string" ||
    input.repository !== REPOSITORY ||
    !input.takosumiCompositionSource ||
    typeof input.takosumiCompositionSource !== "object" ||
    typeof input.accountId !== "string" ||
    !input.portableCheck ||
    typeof input.portableCheck !== "object" ||
    typeof input.outputDir !== "string" ||
    !input.descriptor ||
    typeof input.descriptor !== "object" ||
    !Array.isArray(input.assets) ||
    !input.images ||
    typeof input.images !== "object" ||
    typeof input.publicAgentImage !== "string" ||
    !input.imageContent ||
    typeof input.imageContent !== "object" ||
    !input.workerSmoke ||
    typeof input.workerSmoke !== "object" ||
    typeof input.observedAt !== "string"
  ) {
    throw new Error("prepare evidence is invalid");
  }
  const descriptor = input.descriptor as Record<string, unknown>;
  const takosumiCompositionSource = parseTakosumiCompositionSourceIdentity(
    input.takosumiCompositionSource,
  );
  const portableCheck = input.portableCheck as Record<string, unknown>;
  const assets = input.assets.map((asset) => {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      throw new Error("prepare evidence asset is invalid");
    }
    const record = asset as Record<string, unknown>;
    if (
      typeof record.name !== "string" ||
      typeof record.path !== "string" ||
      typeof record.digest !== "string" ||
      !SHA256.test(record.digest)
    ) {
      throw new Error("prepare evidence asset is invalid");
    }
    return { name: record.name, path: record.path, digest: record.digest };
  });
  const imagesInput = input.images as Record<string, unknown>;
  const images = Object.fromEntries(
    IMAGE_NAMES.map((name) => {
      const reference = imagesInput[name];
      if (typeof reference !== "string" || !DIGEST_REF.test(reference)) {
        throw new Error(`prepare evidence image is invalid: ${name}`);
      }
      return [name, reference];
    }),
  ) as Record<(typeof IMAGE_NAMES)[number], string>;
  const imageContentInput = input.imageContent as Record<string, unknown>;
  const parseContentIdentity = (value: unknown): ImageContentIdentity => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("prepare evidence image content identity is invalid");
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.configDigest !== "string" ||
      !SHA256.test(record.configDigest) ||
      !Array.isArray(record.layerDigests) ||
      record.layerDigests.length > MAX_IMAGE_LAYERS ||
      record.layerDigests.some(
        (digest) => typeof digest !== "string" || !SHA256.test(digest),
      )
    ) {
      throw new Error("prepare evidence image content identity is invalid");
    }
    return {
      configDigest: record.configDigest,
      layerDigests: [...record.layerDigests],
    };
  };
  const imageContent = {
    cloudflare: parseContentIdentity(imageContentInput.cloudflare),
    publicOci: parseContentIdentity(imageContentInput.publicOci),
  };
  const workerSmoke = parseWorkerSmoke(input.workerSmoke);
  if (
    !SEMVER_TAG.test(input.tag) ||
    !COMMIT.test(input.commit) ||
    `v${input.version}` !== input.tag ||
    !ACCOUNT_ID.test(input.accountId) ||
    portableCheck.command !== "bun run check" ||
    portableCheck.status !== "passed" ||
    typeof descriptor.path !== "string" ||
    typeof descriptor.digest !== "string" ||
    !SHA256.test(descriptor.digest) ||
    typeof descriptor.url !== "string"
  ) {
    throw new Error("prepare evidence descriptor is invalid");
  }
  const expectedAssetNames = [
    "takos-worker-release.tar.gz",
    "takos-worker-release.tar.gz.sha256",
    "takosumi-artifact.json",
  ] as const;
  if (
    assets.length !== expectedAssetNames.length ||
    new Set(assets.map((asset) => asset.name)).size !== assets.length ||
    expectedAssetNames.some(
      (name) => !assets.some((asset) => asset.name === name),
    ) ||
    assets.some(
      (asset) =>
        resolve(asset.path) !==
        join(resolve(input.outputDir as string), asset.name),
    )
  ) {
    throw new Error("prepare evidence asset closure is invalid");
  }
  const descriptorAsset = assets.find(
    (asset) => asset.name === "takosumi-artifact.json",
  )!;
  if (
    descriptor.path !== descriptorAsset.path ||
    descriptor.digest !== descriptorAsset.digest ||
    descriptor.url !==
      `https://github.com/${REPOSITORY}/releases/download/${input.tag}/takosumi-artifact.json` ||
    IMAGE_NAMES.some(
      (name) => (images[name].match(DIGEST_REF)?.[1] ?? "") !== input.accountId,
    ) ||
    !PUBLIC_AGENT_DIGEST_REF.test(input.publicAgentImage) ||
    imageContent.cloudflare.configDigest !== imageContent.publicOci.configDigest ||
    imageContent.cloudflare.layerDigests.length !==
      imageContent.publicOci.layerDigests.length ||
    imageContent.cloudflare.layerDigests.some(
      (digest, index) => digest !== imageContent.publicOci.layerDigests[index],
    ) ||
    workerSmoke.archiveDigest !==
      assets.find((asset) => asset.name === "takos-worker-release.tar.gz")?.digest
  ) {
    throw new Error("prepare evidence identity closure is invalid");
  }
  return {
    kind: "takos.release-artifact-prepare@v2",
    status: "prepared",
    tag: input.tag,
    commit: input.commit,
    version: input.version,
    repository: REPOSITORY,
    takosumiCompositionSource,
    accountId: input.accountId,
    portableCheck: { command: "bun run check", status: "passed" },
    outputDir: input.outputDir,
    descriptor: {
      path: descriptor.path,
      digest: descriptor.digest,
      url: descriptor.url,
    },
    assets,
    images,
    publicAgentImage: input.publicAgentImage,
    imageContent,
    workerSmoke,
    observedAt: input.observedAt,
  };
}

function publicPrepareResult(record: PreparedRecord): unknown {
  return {
    kind: record.kind,
    status: record.status,
    tag: record.tag,
    commit: record.commit,
    takosumiCompositionSource: record.takosumiCompositionSource,
    descriptor: record.descriptor,
    portableCheck: record.portableCheck,
    images: record.images,
    publicAgentImage: record.publicAgentImage,
    imageContent: record.imageContent,
    workerSmoke: record.workerSmoke,
    observedAt: record.observedAt,
  };
}

function parseWorkerSmoke(value: unknown): WorkerReleaseSmokeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("prepare evidence Worker smoke is invalid");
  }
  const input = value as Record<string, unknown>;
  const health = input.health as Record<string, unknown> | undefined;
  const api = input.api as Record<string, unknown> | undefined;
  const discovery = input.productDiscovery as Record<string, unknown> | undefined;
  if (
    input.kind !== "takos.worker-release-smoke@v1" ||
    input.runtime !== "wrangler-local-workerd" ||
    typeof input.archiveDigest !== "string" ||
    !SHA256.test(input.archiveDigest) ||
    !health ||
    health.path !== "/health" ||
    health.status !== 200 ||
    typeof health.bodyDigest !== "string" ||
    !SHA256.test(health.bodyDigest) ||
    !api ||
    api.path !== "/api/auth/me" ||
    api.status !== 401 ||
    typeof api.bodyDigest !== "string" ||
    !SHA256.test(api.bodyDigest) ||
    !discovery ||
    discovery.path !== "/.well-known/takosumi" ||
    discovery.status !== 200 ||
    typeof discovery.bodyDigest !== "string" ||
    !SHA256.test(discovery.bodyDigest) ||
    discovery.apiPath !== "/api/v1"
  ) {
    throw new Error("prepare evidence Worker smoke is invalid");
  }
  return {
    kind: "takos.worker-release-smoke@v1",
    runtime: "wrangler-local-workerd",
    archiveDigest: input.archiveDigest,
    health: {
      path: "/health",
      status: 200,
      bodyDigest: health.bodyDigest,
    },
    api: {
      path: "/api/auth/me",
      status: 401,
      bodyDigest: api.bodyDigest,
    },
    productDiscovery: {
      path: "/.well-known/takosumi",
      status: 200,
      bodyDigest: discovery.bodyDigest,
      apiPath: "/api/v1",
    },
  };
}

async function physicalFile(
  path: string,
  label: string,
  requirePrivate: boolean,
): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`${label} path must be absolute`);
  const info = await lstat(path);
  const canonical = await realpath(path);
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.nlink !== 1 ||
    canonical !== resolve(path)
  ) {
    throw new Error(`${label} must be a physical canonical file`);
  }
  if (requirePrivate && (info.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be group/world accessible`);
  }
  return canonical;
}

async function physicalDirectory(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`${label} path must be absolute`);
  const info = await lstat(path);
  const canonical = await realpath(path);
  if (info.isSymbolicLink() || !info.isDirectory() || canonical !== resolve(path)) {
    throw new Error(`${label} must be a physical canonical directory`);
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be group/world accessible`);
  }
  return canonical;
}

async function assertRegistryConfigAccount(
  path: string,
  accountId: string,
): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = Bun.TOML.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("registry Wrangler config is invalid TOML");
  }
  const configured = parsed.account_id;
  if (configured !== undefined && configured !== accountId) {
    throw new Error("registry Wrangler config account_id does not match account file");
  }
}

const CLOUDFLARE_AMBIGUOUS_ENV = [
  "CF_API_EMAIL",
  "CF_API_KEY",
  "CLOUDFLARE_API_EMAIL",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_API_USER_SERVICE_KEY",
  "CLOUDFLARE_BASE_URL",
  "CLOUDFLARE_CONTAINER_REGISTRY",
  "CLOUDFLARE_EMAIL",
  "WRANGLER_API_ENVIRONMENT",
] as const;

function assertCanonicalAuthorityEnvironment(): void {
  for (const name of CLOUDFLARE_AMBIGUOUS_ENV) {
    if (process.env[name]?.trim()) {
      throw new Error(`ambiguous Cloudflare authority environment: ${name}`);
    }
  }
  const ghHost = process.env.GH_HOST?.trim();
  if (ghHost && ghHost !== "github.com") {
    throw new Error("GH_HOST must be github.com for the Takos release");
  }
  for (const name of ["GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"] as const) {
    if (process.env[name]?.trim()) {
      throw new Error(`ambiguous GitHub authority environment: ${name}`);
    }
  }
}

async function assertPrivatePath(
  path: string,
  root: string,
  mustExist: boolean,
): Promise<void> {
  if (!isAbsolute(path)) throw new Error("operator-private path must be absolute");
  const absolute = resolve(path);
  const nested = relative(root, absolute);
  if (nested === "" || (!nested.startsWith("..") && !isAbsolute(nested))) {
    throw new Error("operator-private path must be outside the repository");
  }
  if (mustExist) await stat(absolute);
}

async function ensurePathAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`refusing to overwrite existing path: ${path}`);
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

async function fileDigest(path: string): Promise<string> {
  return digestBytes(await readFile(path));
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function checked(
  cwd: string,
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  const result = await command(cwd, executable, args, env);
  if (result.exitCode !== 0) {
    throw new Error(`${executable} ${args[0] ?? ""} failed with exit ${result.exitCode}`);
  }
  return result;
}

async function checkedWithInput(
  cwd: string,
  executable: string,
  args: readonly string[],
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  const child = Bun.spawn([executable, ...args], {
    cwd,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(input);
  child.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    readBoundedText(child.stdout),
    readBoundedText(child.stderr),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${executable} ${args[0] ?? ""} failed with exit ${exitCode}`);
  }
  return { exitCode, stdout, stderr };
}

async function command(
  cwd: string,
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  const child = Bun.spawn([executable, ...args], {
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readBoundedText(child.stdout),
    readBoundedText(child.stderr),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function readBoundedText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const limit = 4 * 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let retained = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (retained >= limit) continue;
    const remaining = limit - retained;
    const chunk = value.byteLength <= remaining ? value : value.slice(0, remaining);
    chunks.push(chunk);
    retained += chunk.byteLength;
  }
  const bytes = new Uint8Array(retained);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

if (import.meta.main) {
  try {
    const result = await runReleaseArtifact(parseReleaseArtifactArgs(Bun.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n${RELEASE_ARTIFACT_USAGE}\n`,
    );
    process.exit(1);
  }
}
