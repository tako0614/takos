import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  type CandidateManifest,
  sha256Bytes,
  sha256File,
  verifyCandidateManifest,
} from "./release-candidate-contract.ts";
import {
  buildStagingActivationEnv,
  cleanGitCheckoutCommit,
  sealedStagingContainerSelection,
  writePrivateEvidence,
} from "./release-staging-qualification.ts";

export const SURFACE_ID = "takos-release-artifacts";
export const DIRECT_STAGING_RESULT_KIND =
  "takos.release-safety-direct-staging-action-result@v1";
export const REPLICA_ACTION_RESULT_KIND =
  "takos.release-safety-replica-action-result@v1";
export const STAGING_ATTESTATION_KIND =
  "takos.managed-edge-worker-staging-attestation@v1";
export const REPLICA_ATTESTATION_KIND =
  "takos.release-safety-replica-attestation@v1";
export const CANDIDATE_CACHE_DIRECTORY = ".takos-release-candidate";
export const MAX_HTTP_BYTES = 1024 * 1024;

const SHA256_RE = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_RE = /^[0-9a-f]{40}$/u;
const RESOURCE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MANAGED_VERSION_RE = /^ewv_[0-9a-f]{64}$/u;
const MANAGED_DEPLOYMENT_RE = /^ewd_[0-9a-f]{64}$/u;
const PREVIOUS_QUALIFICATION_IMAGES = Object.freeze({
  worker:
    "ghcr.io/tako0614/takos-worker@sha256:ba8f0af05473728707168fc3a2e37568691767b706b3a78378c0e61ad485fc9b",
  agent:
    "ghcr.io/tako0614/takos-agent@sha256:8e01bf1a2eb3530d8ed941acc455ebe01e021e9e025eaa5bfe1119dd8647c0d6",
  runtime:
    "ghcr.io/tako0614/takos-worker-runtime@sha256:3164eb048307bc054b848f61656d4899ef1bed6ea4e43636ec852580eca4e474",
});
const LOCAL_QUALIFICATION_CHECK_NAMES = Object.freeze([
  "previous worker health",
  "previous Takosumi discovery",
  "previous agent health",
  "previous runtime health",
  "candidate worker health",
  "candidate Takosumi discovery",
  "candidate capabilities",
  "candidate agent health",
  "candidate runtime health",
  "previous worker health after rollback",
  "final candidate worker health",
  "final candidate agent health",
  "final candidate runtime health",
]);
const LOCAL_QUALIFICATION_IMAGE_KEYS = Object.freeze([
  "worker",
  "agent",
  "runtime",
] as const);
const LOCAL_QUALIFICATION_TOPOLOGY = Object.freeze([
  "takos-worker",
  "takos-agent",
  "takos-worker-runtime",
  "postgres@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229",
  "redis@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99",
]);
const LOCAL_QUALIFICATION_SECURITY_OPTIONS = Object.freeze([
  "name=apparmor",
  "name=seccomp,profile=builtin",
  "name=cgroupns",
]);
const LOCAL_QUALIFICATION_CONTAINER_KEYS = Object.freeze([
  "worker",
  "agent",
  "runtime",
  "postgres",
  "redis",
]);
const LOCAL_QUALIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;

export const REPLICA_CHECK_NAMES = [
  "exact immutable candidate archive and Cloudflare Container digests",
  "fresh isolated Takosumi workspace and canonical EdgeWorker identity",
  "canonical EdgeWorker Ready and exact active deployment confirmation",
  "public replica health and API readback",
  "v0.10.35 comparison, cleanup fencing, and no production fallback",
] as const;

export type ReleaseEnvelope = {
  releaseId: string;
  surfaceId: string;
  source: { commit: string };
  controllerSource: { commit: string };
  authority: {
    controllerDigest: string;
    stagingAdapterDigest?: string;
    replicaAdapterDigest?: string;
    operatorPolicyDigest?: string;
  };
  candidate: CandidateManifest & { manifestDigest: string };
  staging: { verifiedAt: string | null };
  replica: {
    id: string | null;
    status: string;
    accessPolicy: string;
    createdAt: string | null;
    verifiedAt: string | null;
    expiresAt: string | null;
    configFingerprint: string | null;
    migrationPlanDigest: string | null;
    targetInventoryDigest: string | null;
  };
  evidence: { directory: string };
};

export type ManagedPaths = {
  root: string;
  outputs: string;
  origin: string;
  workspace: string;
  access: string;
  config: string;
  secrets: string;
  health: string;
};

export type ManagedTarget = {
  paths: ManagedPaths;
  outputsText: string;
  outputs: Record<string, unknown>;
  origin: string;
  workspaceId: string;
  resourceName: string;
  accessFile: string;
  configFile: string;
  secretsFile: string;
  healthUrl: string;
};

export type CandidateContext = {
  candidateDir: string;
  manifest: CandidateManifest;
  manifestDigest: string;
  containers: ReturnType<typeof sealedStagingContainerSelection>;
};

export type ManagedEvidence = {
  archiveDigest: string;
  runtimeRegistryDigest: string;
  executorRegistryDigest: string;
  canonicalManifestDigest: string;
  managedVersionId: string;
  managedVersionDigest: string;
  managedDeploymentId: string;
  managedDeploymentDigest: string;
  canonicalResourceEtag: string;
  resourceGeneration: number;
  healthReadbackDigest: string;
  healthStatus: number;
};

export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

export function record(value: unknown, label: string): Record<string, unknown> {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as Record<string, unknown>;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function exactArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  invariant(value, `${name} is required`);
  return value;
}

export function envelopeArgument(): string {
  const path = resolve(exactArgument("--envelope"));
  invariant(
    path === process.env.TAKOS_RELEASE_SAFETY_ENVELOPE,
    "release envelope path differs from controller authority",
  );
  return path;
}

export function readEnvelope(path: string): ReleaseEnvelope {
  const envelope = record(JSON.parse(readFileSync(path, "utf8")), "envelope");
  invariant(envelope.surfaceId === SURFACE_ID, "surface identity drifted");
  invariant(
    typeof envelope.releaseId === "string" && envelope.releaseId.length > 0,
    "release identity is missing",
  );
  return envelope as unknown as ReleaseEnvelope;
}

function ensurePrivateFile(path: string, root: string, label: string): string {
  const canonicalRoot = realpathSync(root);
  const canonicalPath = realpathSync(path);
  invariant(
    canonicalPath === resolve(path) &&
      !relative(canonicalRoot, canonicalPath).startsWith(".."),
    `${label} escapes its fixed operator root`,
  );
  const metadata = lstatSync(canonicalPath);
  invariant(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${label} must be a regular non-symlink file`,
  );
  invariant((metadata.mode & 0o777) === 0o600, `${label} must have mode 0600`);
  const uid = process.getuid?.();
  invariant(
    uid === undefined || metadata.uid === uid,
    `${label} must be owned by the invoking operator`,
  );
  return canonicalPath;
}

function readPrivateText(path: string, root: string, label: string): string {
  return readFileSync(ensurePrivateFile(path, root, label), "utf8").trim();
}

function outputValue(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "value")
  ) {
    return (value as Record<string, unknown>).value;
  }
  return value;
}

export function managedPaths(kind: "staging" | "replica"): ManagedPaths {
  const root = process.env.TAKOS_RELEASE_SAFETY_OPERATOR_ROOT;
  invariant(
    root && resolve(root) === realpathSync(root),
    "operator root is invalid",
  );
  const base = join(root, SURFACE_ID, kind);
  return {
    root,
    outputs: join(base, "outputs.json"),
    origin: join(base, "managed-origin"),
    workspace: join(base, "workspace-id"),
    access: join(base, "access-token"),
    config: join(base, "managed-config.json"),
    secrets: join(base, "managed-secrets.json"),
    health: join(base, "health-url"),
  };
}

export function managedTarget(kind: "staging" | "replica"): ManagedTarget {
  const paths = managedPaths(kind);
  const outputsText = readPrivateText(
    paths.outputs,
    paths.root,
    `${kind} outputs`,
  );
  const outputs = record(JSON.parse(outputsText), `${kind} outputs`);
  const accountId = outputValue(outputs.cloudflare_account_id);
  invariant(
    typeof accountId === "string" && accountId.startsWith("ts_acc_"),
    `${kind} must select a Takosumi-managed target`,
  );
  const resourceName = outputValue(outputs.service_runtime_name);
  invariant(
    typeof resourceName === "string" && RESOURCE_NAME_RE.test(resourceName),
    `${kind} service_runtime_name is invalid`,
  );
  const origin = readPrivateText(
    paths.origin,
    paths.root,
    `${kind} managed origin`,
  );
  const originUrl = new URL(origin);
  invariant(
    originUrl.protocol === "https:" &&
      !originUrl.username &&
      !originUrl.password &&
      !originUrl.search &&
      !originUrl.hash &&
      originUrl.pathname === "/",
    `${kind} managed origin must be a bare HTTPS origin`,
  );
  const workspaceId = readPrivateText(
    paths.workspace,
    paths.root,
    `${kind} workspace`,
  );
  invariant(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(workspaceId),
    `${kind} workspace is invalid`,
  );
  const healthUrl = readPrivateText(
    paths.health,
    paths.root,
    `${kind} health URL`,
  );
  const parsedHealth = new URL(healthUrl);
  invariant(
    parsedHealth.protocol === "https:" &&
      !parsedHealth.username &&
      !parsedHealth.password &&
      !parsedHealth.hash,
    `${kind} health URL must be credential-free HTTPS`,
  );
  invariant(
    !new Set(["takos.jp", "www.takos.jp", "app.takosumi.com"]).has(
      parsedHealth.hostname,
    ),
    `${kind} health URL points at a production hostname`,
  );
  ensurePrivateFile(paths.access, paths.root, `${kind} access file`);
  ensurePrivateFile(paths.config, paths.root, `${kind} config file`);
  ensurePrivateFile(paths.secrets, paths.root, `${kind} secrets file`);
  JSON.parse(readFileSync(paths.config, "utf8"));
  JSON.parse(readFileSync(paths.secrets, "utf8"));
  return {
    paths,
    outputsText,
    outputs,
    origin: originUrl.origin,
    workspaceId,
    resourceName,
    accessFile: realpathSync(paths.access),
    configFile: realpathSync(paths.config),
    secretsFile: realpathSync(paths.secrets),
    healthUrl: parsedHealth.toString(),
  };
}

export function assertDistinctTargets(
  staging: ManagedTarget,
  replica: ManagedTarget,
): void {
  invariant(
    staging.workspaceId !== replica.workspaceId,
    "staging and replica Workspace identities must be distinct",
  );
  invariant(
    staging.resourceName !== replica.resourceName,
    "staging and replica EdgeWorker names must be distinct",
  );
  invariant(
    staging.healthUrl !== replica.healthUrl,
    "staging and replica health URLs must be distinct",
  );
}

function workflowTakosumiCommit(sourceDir: string): string {
  const workflow = readFileSync(
    join(sourceDir, ".github", "workflows", "release-artifacts.yml"),
    "utf8",
  );
  const commit = workflow.match(
    /^\s*TAKOSUMI_SOURCE_REF:\s*([0-9a-f]{40})\s*$/mu,
  )?.[1];
  invariant(commit && COMMIT_RE.test(commit), "Takosumi source pin is missing");
  return commit;
}

function validateCandidateTree(root: string): void {
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const metadata = lstatSync(path);
      invariant(
        !metadata.isSymbolicLink(),
        "candidate artifact contains a symlink",
      );
      if (metadata.isDirectory()) {
        chmodSync(path, 0o700);
        walk(path);
      } else {
        invariant(
          metadata.isFile(),
          "candidate artifact contains a special file",
        );
        chmodSync(path, 0o600);
      }
    }
  };
  walk(root);
}

function verifyWorkflowRun(envelope: ReleaseEnvelope): void {
  const result = spawnSync(
    "gh",
    [
      "api",
      `repos/tako0614/takos/actions/runs/${envelope.candidate.workflowRunId}`,
      "--jq",
      "[.head_sha,.event,.status,.conclusion,(.run_attempt|tostring),.path]|@tsv",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  invariant(
    result.status === 0,
    "candidate workflow authority readback failed",
  );
  invariant(
    result.stdout.trim() ===
      [
        envelope.source.commit,
        "workflow_dispatch",
        "completed",
        "success",
        "1",
        ".github/workflows/release-artifacts.yml",
      ].join("\t"),
    "candidate workflow authority drifted",
  );
}

export function candidateContext(
  envelope: ReleaseEnvelope,
  sourceDir: string,
): CandidateContext {
  invariant(
    cleanGitCheckoutCommit(sourceDir, "Takos release source") ===
      envelope.source.commit,
    "Takos source checkout drifted",
  );
  const evidenceDir = realpathSync(envelope.evidence.directory);
  const candidateDir = join(evidenceDir, CANDIDATE_CACHE_DIRECTORY);
  if (!existsSync(candidateDir)) {
    verifyWorkflowRun(envelope);
    const temporary = mkdtempSync(join(evidenceDir, ".candidate-download-"));
    chmodSync(temporary, 0o700);
    try {
      const artifactName = `takos-release-candidate-${envelope.candidate.version}-${envelope.source.commit.slice(0, 12)}`;
      const result = spawnSync(
        "gh",
        [
          "run",
          "download",
          envelope.candidate.workflowRunId,
          "--repo",
          "tako0614/takos",
          "--name",
          artifactName,
          "--dir",
          temporary,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      invariant(result.status === 0, "candidate artifact download failed");
      validateCandidateTree(temporary);
      renameSync(temporary, candidateDir);
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  invariant(
    realpathSync(candidateDir) === candidateDir &&
      statSync(candidateDir).isDirectory(),
    "candidate cache is invalid",
  );
  validateCandidateTree(candidateDir);
  const candidate = { ...envelope.candidate } as Record<string, unknown>;
  delete candidate.manifestDigest;
  const manifest = verifyCandidateManifest({
    candidateDir,
    repository: "https://github.com/tako0614/takos.git",
    sourceCommit: envelope.source.commit,
    version: envelope.candidate.version,
    takosumiSourceCommit: workflowTakosumiCommit(sourceDir),
    candidateRunId: envelope.candidate.workflowRunId,
    expectedManifestDigest: envelope.candidate.manifestDigest,
    policyPath: join(
      sourceDir,
      ".github",
      "workflows",
      "release-artifacts.yml",
    ),
    toolchainPath: join(sourceDir, "bun.lock"),
  });
  invariant(
    canonicalJson(manifest) === canonicalJson(candidate),
    "candidate envelope differs from retained candidate bytes",
  );
  return {
    candidateDir,
    manifest,
    manifestDigest: sha256File(
      join(candidateDir, "release-candidate-manifest.json"),
    ),
    containers: sealedStagingContainerSelection({ candidateDir, manifest }),
  };
}

export function managedActivationEnv(input: {
  candidate: CandidateContext;
  target: ManagedTarget;
  releaseId: string;
  role: "staging" | "replica";
}): Record<string, string | undefined> {
  return buildStagingActivationEnv({
    candidateDir: input.candidate.candidateDir,
    manifest: input.candidate.manifest,
    baseEnv: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
      TAKOSUMI_OUTPUTS_JSON: input.target.outputsText,
      TAKOS_MANAGED_RELEASE_URL: input.target.origin,
      TAKOS_MANAGED_RELEASE_WORKSPACE_ID: input.target.workspaceId,
      TAKOS_MANAGED_RELEASE_RESOURCE_NAME: input.target.resourceName,
      TAKOS_MANAGED_RELEASE_ACCESS_TOKEN_FILE: input.target.accessFile,
      TAKOS_MANAGED_RELEASE_CONFIG_FILE: input.target.configFile,
      TAKOS_MANAGED_RELEASE_SECRETS_FILE: input.target.secretsFile,
      TAKOS_MANAGED_RELEASE_IDEMPOTENCY_KEY: `${input.releaseId}-${input.role}`,
    },
  });
}

export async function withoutConsole<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await operation();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function imageDigest(
  manifest: CandidateManifest,
  name: "takos-agent" | "takos-worker-runtime",
): string {
  const value = manifest.ociImages.find(
    (image) => image.name === name,
  )?.cloudflareRegistryDigest;
  invariant(
    value && SHA256_RE.test(value),
    `${name} registry digest is absent`,
  );
  return value;
}

export async function healthReadback(url: string): Promise<{
  status: number;
  digest: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json, text/plain;q=0.9" },
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  invariant(
    response.ok,
    `managed health readback failed with HTTP ${response.status}`,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  invariant(
    bytes.byteLength <= MAX_HTTP_BYTES,
    "managed health response is too large",
  );
  return {
    status: response.status,
    digest: sha256Bytes(bytes),
  };
}

export function managedEvidence(input: {
  candidate: CandidateContext;
  activation: Record<string, unknown>;
  health: { status: number; digest: string };
}): { resourceId: string; evidence: ManagedEvidence } {
  const managed = record(input.activation.managed, "managed activation");
  invariant(
    managed.mode === "takosumi-managed",
    "managed activation mode drifted",
  );
  const archive = record(managed.archive, "managed archive");
  const manifest = record(managed.manifest, "managed manifest");
  const version = record(managed.version, "managed version");
  const deployment = record(managed.deployment, "managed deployment");
  const resource = record(managed.resource, "managed resource");
  const archiveDigest = input.candidate.manifest.releaseAssets.find(
    (asset) => asset.name === "takos-worker-release.tar.gz",
  )?.digest;
  invariant(
    archive.sha256 === archiveDigest && SHA256_RE.test(String(archive.sha256)),
    "managed archive digest drifted",
  );
  invariant(
    typeof resource.id === "string" &&
      resource.id.startsWith("tkrn:") &&
      resource.phase === "Ready" &&
      Number.isSafeInteger(resource.generation) &&
      Number(resource.generation) > 0,
    "managed Resource is not exact Ready",
  );
  invariant(
    deployment.state === "active" &&
      MANAGED_DEPLOYMENT_RE.test(String(deployment.id)) &&
      SHA256_RE.test(String(deployment.digest)) &&
      typeof deployment.canonicalResourceEtag === "string" &&
      deployment.canonicalResourceEtag.length > 0,
    "managed deployment is not exact active",
  );
  invariant(
    MANAGED_VERSION_RE.test(String(version.id)) &&
      SHA256_RE.test(String(version.digest)) &&
      SHA256_RE.test(String(manifest.sha256)),
    "managed version or manifest evidence is invalid",
  );
  return {
    resourceId: resource.id,
    evidence: {
      archiveDigest: archiveDigest!,
      runtimeRegistryDigest: imageDigest(
        input.candidate.manifest,
        "takos-worker-runtime",
      ),
      executorRegistryDigest: imageDigest(
        input.candidate.manifest,
        "takos-agent",
      ),
      canonicalManifestDigest: String(manifest.sha256),
      managedVersionId: String(version.id),
      managedVersionDigest: String(version.digest),
      managedDeploymentId: String(deployment.id),
      managedDeploymentDigest: String(deployment.digest),
      canonicalResourceEtag: String(deployment.canonicalResourceEtag),
      resourceGeneration: Number(resource.generation),
      healthReadbackDigest: input.health.digest,
      healthStatus: input.health.status,
    },
  };
}

function bearer(target: ManagedTarget): string {
  const value = readFileSync(target.accessFile, "utf8").trim();
  invariant(
    value.length >= 16 && value.length <= 8192 && !/\s/u.test(value),
    "managed access file is invalid",
  );
  return value;
}

export async function managedRequest(
  target: ManagedTarget,
  method: "GET" | "DELETE",
  path: string,
  { allowNotFound = false }: { allowNotFound?: boolean } = {},
): Promise<{ status: number; body?: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch(new URL(path, `${target.origin}/`), {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${bearer(target)}`,
      },
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (allowNotFound && response.status === 404) return { status: 404 };
  invariant(
    response.ok,
    `managed ${method} readback failed with HTTP ${response.status}`,
  );
  if (response.status === 204) return { status: response.status };
  const bytes = new Uint8Array(await response.arrayBuffer());
  invariant(
    bytes.byteLength <= MAX_HTTP_BYTES,
    "managed API response is too large",
  );
  return {
    status: response.status,
    body: record(
      JSON.parse(new TextDecoder().decode(bytes)),
      "managed API response",
    ),
  };
}

export function resourcePath(target: ManagedTarget): string {
  return `/v1/resources/EdgeWorker/${encodeURIComponent(target.resourceName)}?space=${encodeURIComponent(target.workspaceId)}`;
}

export function releaseStatusPath(target: ManagedTarget): string {
  return `/v1/cloud/edge-worker-releases/${encodeURIComponent(target.resourceName)}?workspaceId=${encodeURIComponent(target.workspaceId)}`;
}

export async function assertFreshReplica(target: ManagedTarget): Promise<void> {
  const result = await managedRequest(target, "GET", resourcePath(target), {
    allowNotFound: true,
  });
  invariant(
    result.status === 404,
    "replica EdgeWorker already exists; freshness is not proven",
  );
}

export async function exactManagedReadback(input: {
  target: ManagedTarget;
  expected: ManagedEvidence;
  resourceId: string;
}): Promise<{
  health: { status: number; digest: string };
  bindingDigest: string;
}> {
  const [resourceResponse, statusResponse, health] = await Promise.all([
    managedRequest(input.target, "GET", resourcePath(input.target)),
    managedRequest(input.target, "GET", releaseStatusPath(input.target)),
    healthReadback(input.target.healthUrl),
  ]);
  const resource = record(resourceResponse.body, "canonical Resource");
  const metadata = record(resource.metadata, "Resource metadata");
  const spec = record(resource.spec, "Resource spec");
  const source = record(spec.source, "Resource source");
  const resourceStatus = record(resource.status, "Resource status");
  invariant(
    resource.id === input.resourceId &&
      resource.kind === "EdgeWorker" &&
      metadata.space === input.target.workspaceId &&
      metadata.name === input.target.resourceName &&
      metadata.generation === input.expected.resourceGeneration &&
      resourceStatus.phase === "Ready" &&
      resourceStatus.observedGeneration === metadata.generation &&
      source.artifactSha256 === input.expected.canonicalManifestDigest,
    "canonical replica Resource readback drifted",
  );
  const status = record(statusResponse.body, "managed release status");
  invariant(
    Array.isArray(status.deployments),
    "managed deployment list is missing",
  );
  const deployment = status.deployments.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).id ===
        input.expected.managedDeploymentId,
  ) as Record<string, unknown> | undefined;
  invariant(
    deployment?.digest === input.expected.managedDeploymentDigest &&
      deployment.state === "active",
    "managed replica deployment readback drifted",
  );
  invariant(
    health.status === input.expected.healthStatus &&
      health.digest === input.expected.healthReadbackDigest,
    "public replica health readback drifted",
  );
  return {
    health,
    bindingDigest: digestJson({
      resource,
      deployment: {
        id: deployment.id,
        digest: deployment.digest,
        state: deployment.state,
      },
      health,
    }),
  };
}

export function adapterDigest(path: string): string {
  return sha256File(resolve(path));
}

export function assertControllerAuthority(
  envelope: ReleaseEnvelope,
  role: "staging" | "replica",
  adapterPath: string,
): void {
  const sourceDir = realpathSync(
    process.env.TAKOS_RELEASE_SAFETY_SOURCE_CHECKOUT ?? "",
  );
  invariant(sourceDir === process.cwd(), "adapter source checkout drifted");
  invariant(
    cleanGitCheckoutCommit(sourceDir, "Takos release source") ===
      envelope.source.commit,
    "Takos source commit drifted",
  );
  const expectedParent =
    role === "staging" ? `${SURFACE_ID}:staging@v1` : `${SURFACE_ID}@v1`;
  const parentName =
    role === "staging"
      ? "TAKOS_RELEASE_SAFETY_STAGING_PARENT_AUTHORIZED"
      : "TAKOS_RELEASE_SAFETY_REPLICA_PARENT_AUTHORIZED";
  invariant(
    process.env[parentName] === expectedParent,
    "controller parent authority is absent",
  );
  const expectedDigest =
    role === "staging"
      ? envelope.authority.stagingAdapterDigest
      : envelope.authority.replicaAdapterDigest;
  invariant(
    expectedDigest === adapterDigest(adapterPath),
    `${role} adapter digest drifted`,
  );
  invariant(
    COMMIT_RE.test(envelope.controllerSource.commit) &&
      SHA256_RE.test(envelope.authority.controllerDigest),
    "controller source authority is invalid",
  );
}

export function assertTimestamp(value: string, label: string): void {
  invariant(
    TIMESTAMP_RE.test(value) && Number.isFinite(Date.parse(value)),
    `${label} is not an exact timestamp`,
  );
}

export function writeEvidence(path: string, value: unknown): string {
  writePrivateEvidence(path, value);
  return sha256File(path);
}

export function safeDiagnostic(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/\b(?:gh[pousr]_|github_pat_|cf_)[A-Za-z0-9_-]+\b/gu, "[redacted]")
    .replace(/\s+/gu, " ")
    .slice(0, 400);
}

export function actionResult(input: {
  action: string;
  status: string;
  envelope: ReleaseEnvelope;
  evidenceFile: string;
  evidenceDigest: string;
  targetInventoryDigest: string;
}) {
  return {
    kind: REPLICA_ACTION_RESULT_KIND,
    status: input.status,
    action: input.action,
    surfaceId: SURFACE_ID,
    releaseId: input.envelope.releaseId,
    sourceCommit: input.envelope.source.commit,
    controllerCommit: input.envelope.controllerSource.commit,
    replicaAdapterDigest: input.envelope.authority.replicaAdapterDigest,
    evidenceFile: basename(input.evidenceFile),
    evidenceDigest: input.evidenceDigest,
    targetInventoryDigest: input.targetInventoryDigest,
    productionFallback: false,
  } as const;
}

export function localQualification(
  operatorRoot: string,
  envelope: ReleaseEnvelope,
): { digest: string; value: Record<string, unknown> } {
  const path = join(
    operatorRoot,
    SURFACE_ID,
    "replica",
    "local-docker-qualification.json",
  );
  ensurePrivateFile(path, operatorRoot, "local Docker qualification");
  const value = record(
    JSON.parse(readFileSync(path, "utf8")),
    "local qualification",
  );
  const candidateDigests = Object.fromEntries(
    envelope.candidate.ociImages.map((image) => [image.name, image.digest]),
  );
  const expectedCandidateImages = {
    worker: `ghcr.io/tako0614/takos-worker@${candidateDigests["takos-worker"]}`,
    agent: `ghcr.io/tako0614/takos-agent@${candidateDigests["takos-agent"]}`,
    runtime: `ghcr.io/tako0614/takos-worker-runtime@${candidateDigests["takos-worker-runtime"]}`,
  };
  const candidateImages = record(
    value.candidateImages,
    "local candidate images",
  );
  const previousImages = record(value.previousImages, "local previous images");
  const config = record(value.config, "local qualification config");
  const configPreviousImages = record(
    config.previousImages,
    "local config previous images",
  );
  const configCandidateImages = record(
    config.candidateImages,
    "local config candidate images",
  );
  const previousResolution = record(
    value.previousImageResolution,
    "local previous image resolution",
  );
  const publishedIndexes = record(
    previousResolution.publishedIndexes,
    "local published previous indexes",
  );
  const previousExecutionImages = record(
    previousResolution.platformExecutionImages,
    "local previous execution images",
  );
  const configPreviousExecutionImages = record(
    config.previousExecutionImages,
    "local config previous execution images",
  );
  const previousMappings = record(
    previousResolution.mappings,
    "local previous image mappings",
  );
  const previousPullReadback = record(
    previousResolution.exactPullReadback,
    "local previous pull readback",
  );
  const controllerRuntime = record(
    config.controllerRuntime,
    "local qualification controller runtime",
  );
  const osRelease = record(config.osRelease, "local qualification OS release");
  const containerProfiles = record(
    config.containerProfiles,
    "local qualification container profiles",
  );
  const dockerSecurityOptions = Array.isArray(config.dockerSecurityOptions)
    ? config.dockerSecurityOptions
    : [];
  const topology = Array.isArray(config.topology) ? config.topology : [];
  const migration = record(value.migration, "local qualification migration");
  const rollback = record(value.rollbackRehearsal, "local rollback rehearsal");
  const failure = record(value.failureRehearsal, "local failure rehearsal");
  const data = record(value.data, "local qualification data");
  const digestReadback = record(
    value.digestReadback,
    "local candidate digest readback",
  );
  const candidateReadback = record(
    digestReadback.candidate,
    "local candidate image readback",
  );
  const finalCandidateReadback = record(
    digestReadback.finalCandidate,
    "local final candidate image readback",
  );
  const checks = Array.isArray(value.checks) ? value.checks : [];
  const verifiedAt = String(value.verifiedAt ?? "");
  const expiresAt = String(value.expiresAt ?? "");
  const createdAt = String(value.createdAt ?? "");
  const candidateBuiltAt = String(value.candidateBuiltAt ?? "");
  assertTimestamp(verifiedAt, "local qualification verifiedAt");
  assertTimestamp(expiresAt, "local qualification expiresAt");
  assertTimestamp(createdAt, "local qualification createdAt");
  assertTimestamp(candidateBuiltAt, "local qualification candidateBuiltAt");
  const qualificationRunId = String(value.workflowRunId ?? "");
  const replicaSuffixStart = "sha256:".length;
  const expectedReplicaId = `takos-replica-${sha256Bytes(envelope.releaseId).slice(replicaSuffixStart, replicaSuffixStart + 12)}-${qualificationRunId}`;
  const previousMappingsValid = LOCAL_QUALIFICATION_IMAGE_KEYS.every((key) => {
    const publishedIndex = String(previousImages[key] ?? "");
    const executionImage = String(previousExecutionImages[key] ?? "");
    const mapping = record(
      previousMappings[key],
      `local previous ${key} image mapping`,
    );
    const separator = publishedIndex.lastIndexOf("@");
    const executionSeparator = executionImage.lastIndexOf("@");
    const repository = publishedIndex.slice(0, separator);
    const publishedDigest = publishedIndex.slice(separator + 1);
    const executionDigest = executionImage.slice(executionSeparator + 1);
    return (
      separator > 0 &&
      executionSeparator > 0 &&
      repository === executionImage.slice(0, executionSeparator) &&
      SHA256_RE.test(publishedDigest) &&
      SHA256_RE.test(executionDigest) &&
      mapping.publishedIndex === publishedIndex &&
      mapping.sourceTag === `${repository}:0.10.35` &&
      mapping.rawIndexDigest === publishedDigest &&
      Number.isSafeInteger(mapping.rawIndexBodySize) &&
      Number(mapping.rawIndexBodySize) > 0 &&
      Number.isSafeInteger(mapping.transportSize) &&
      Number(mapping.transportSize) ===
        Number(mapping.rawIndexBodySize) +
          (mapping.trailingLineFeedRemoved === true ? 1 : 0) &&
      typeof mapping.trailingLineFeedRemoved === "boolean" &&
      record(mapping.platform, `local previous ${key} platform`).os ===
        "linux" &&
      record(mapping.platform, `local previous ${key} platform`)
        .architecture === "amd64" &&
      mapping.executionImage === executionImage &&
      mapping.childManifestDigest === executionDigest &&
      Number.isSafeInteger(mapping.childManifestBodySize) &&
      Number(mapping.childManifestBodySize) > 0 &&
      Number.isSafeInteger(mapping.childManifestTransportSize) &&
      Number(mapping.childManifestTransportSize) ===
        Number(mapping.childManifestBodySize) +
          (mapping.childManifestTrailingLineFeedRemoved === true ? 1 : 0) &&
      typeof mapping.childManifestTrailingLineFeedRemoved === "boolean" &&
      previousPullReadback[key] === executionImage
    );
  });
  invariant(
    value.kind === "takos.release-replica-qualification@v1" &&
      value.surfaceId === SURFACE_ID &&
      value.releaseId === envelope.releaseId &&
      value.sourceCommit === envelope.source.commit &&
      value.candidateRunId === envelope.candidate.workflowRunId &&
      value.candidateManifestDigest === envelope.candidate.manifestDigest &&
      value.workflowCommit === envelope.source.commit &&
      typeof value.workflowRunId === "string" &&
      /^[1-9][0-9]*$/u.test(value.workflowRunId) &&
      value.replicaId === expectedReplicaId &&
      value.accessPolicy === "replica-only-no-production-fallback" &&
      value.dataSource === "empty" &&
      value.previousVersion === "0.10.35" &&
      value.status === "verified" &&
      value.productionEquivalent === true &&
      value.productionCredentialsUsed === false &&
      Date.parse(verifiedAt) < Date.parse(expiresAt) &&
      Date.parse(createdAt) <= Date.parse(verifiedAt) &&
      Date.parse(candidateBuiltAt) <= Date.parse(verifiedAt) &&
      Date.parse(verifiedAt) <= Date.now() &&
      Date.parse(expiresAt) > Date.now() &&
      Date.parse(expiresAt) - Date.parse(verifiedAt) ===
        LOCAL_QUALIFICATION_TTL_MS &&
      config.productionFallback === false &&
      config.productionCredentialsUsed === false &&
      config.environment === "production" &&
      config.defaultAppArmor === true &&
      config.defaultSeccomp === true &&
      config.cgroupNamespace === true &&
      config.runner === "github-hosted-ubuntu-24.04" &&
      typeof config.runnerImageOS === "string" &&
      config.runnerImageOS.length > 0 &&
      typeof config.runnerImageVersion === "string" &&
      config.runnerImageVersion.length > 0 &&
      controllerRuntime.version === "v24.18.0" &&
      controllerRuntime.versionReadback === "v24.18.0" &&
      typeof controllerRuntime.executable === "string" &&
      controllerRuntime.executable.startsWith("/") &&
      osRelease.path === "/etc/os-release" &&
      typeof osRelease.contents === "string" &&
      osRelease.contents.length > 0 &&
      osRelease.digest === sha256Bytes(osRelease.contents) &&
      typeof config.kernel === "string" &&
      config.kernel.length > 0 &&
      config.dockerArchitecture === "amd64" &&
      typeof config.dockerServer === "string" &&
      config.dockerServer.length > 0 &&
      LOCAL_QUALIFICATION_SECURITY_OPTIONS.every((option) =>
        dockerSecurityOptions.includes(option),
      ) &&
      LOCAL_QUALIFICATION_CONTAINER_KEYS.every(
        (key) =>
          typeof containerProfiles[key] === "string" &&
          containerProfiles[key].startsWith("docker-default"),
      ) &&
      canonicalJson(topology) === canonicalJson(LOCAL_QUALIFICATION_TOPOLOGY) &&
      config.domains === "reserved-.test-only" &&
      config.namedPersistentVolumes === 3 &&
      config.sourceCommit === envelope.source.commit &&
      config.workflowCommit === envelope.source.commit &&
      config.candidateRunId === envelope.candidate.workflowRunId &&
      config.candidateManifestDigest === envelope.candidate.manifestDigest &&
      value.configFingerprint === digestJson(config) &&
      previousResolution.publishedVersion === "0.10.35" &&
      canonicalJson(previousImages) ===
        canonicalJson(PREVIOUS_QUALIFICATION_IMAGES) &&
      canonicalJson(configPreviousImages) ===
        canonicalJson(PREVIOUS_QUALIFICATION_IMAGES) &&
      canonicalJson(publishedIndexes) ===
        canonicalJson(PREVIOUS_QUALIFICATION_IMAGES) &&
      previousMappingsValid &&
      canonicalJson(configPreviousExecutionImages) ===
        canonicalJson(previousExecutionImages) &&
      Object.values(candidateDigests).every((digest) =>
        SHA256_RE.test(String(digest ?? "")),
      ) &&
      canonicalJson(candidateImages) ===
        canonicalJson(expectedCandidateImages) &&
      canonicalJson(configCandidateImages) === canonicalJson(candidateImages) &&
      canonicalJson(candidateReadback) === canonicalJson(candidateImages) &&
      canonicalJson(finalCandidateReadback) ===
        canonicalJson(candidateImages) &&
      checks.length === LOCAL_QUALIFICATION_CHECK_NAMES.length &&
      checks.every((check, index) => {
        const item = record(check, `local qualification check ${index}`);
        return (
          item.name === LOCAL_QUALIFICATION_CHECK_NAMES[index] &&
          item.status === "passed" &&
          SHA256_RE.test(String(item.responseDigest ?? ""))
        );
      }) &&
      migration.directory === "db/migrations-control/migrations" &&
      Number.isSafeInteger(migration.count) &&
      Number(migration.count) > 0 &&
      typeof migration.first === "string" &&
      migration.first.endsWith(".sql") &&
      typeof migration.last === "string" &&
      migration.last.endsWith(".sql") &&
      SHA256_RE.test(String(migration.planDigest ?? "")) &&
      migration.schemaCanonicalization === "pg_dump-restrict-pair-v1" &&
      migration.countBeforeUpgrade === migration.count &&
      migration.countAfterUpgrade === migration.count &&
      SHA256_RE.test(String(migration.schemaFingerprintBefore ?? "")) &&
      migration.schemaFingerprintAfter === migration.schemaFingerprintBefore &&
      migration.changedFromPreviousRelease === false &&
      failure.status === "passed" &&
      failure.strategy === "stop-rollout-and-publish-new-version" &&
      typeof failure.result === "string" &&
      /^failed-closed-exit-[1-9][0-9]*$/u.test(failure.result) &&
      rollback.status === "passed" &&
      rollback.from === candidateImages.worker &&
      rollback.to === previousExecutionImages.worker &&
      rollback.final === candidateImages.worker &&
      data.source === "empty" &&
      Number.isSafeInteger(data.tableCount) &&
      Number(data.tableCount) > 0 &&
      data.nonMigrationRows === 0 &&
      data.piiScan === "passed" &&
      data.secretScan === "passed" &&
      data.referentialIntegrity === "passed" &&
      Number.isSafeInteger(data.foreignKeyConstraints) &&
      Number(data.foreignKeyConstraints) >= 0 &&
      value.cleanupPolicy ===
        "exact-replica-resources-destroyed-after-evidence",
    "local Docker qualification authority drifted",
  );
  return { digest: sha256File(path), value };
}
