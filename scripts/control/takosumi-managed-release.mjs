import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { readWorkerReleaseArtifactBytes } from "./worker-release-artifact.mjs";

const CONFIG_KIND = "takos.managed-edge-worker-release@v1";
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_SECRET_FILE_BYTES = 1024 * 1024;
const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MATERIALIZE_RESPONSE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_READY_ATTEMPTS = 40;
const DEFAULT_READY_INTERVAL_MS = 3000;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BINDING_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const CAPABILITY_TOKEN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SECRET_LIKE_NAME =
  /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_?KEY|API_?KEY)/iu;

/**
 * Materialize a Takos release through the one canonical Takosumi Resource
 * lifecycle. Cloud-only release material is staged first, but it never becomes
 * active until the exact manifest-backed EdgeWorker Resource is Ready.
 */
export async function releaseTakosumiManagedEdgeWorker({
  outputs,
  environment,
  artifactConfig,
  env = process.env,
  fetchImpl = globalThis.fetch,
  wait = defaultWait,
  cwd = process.cwd(),
}) {
  const settings = managedReleaseSettings(outputs, environment, env, cwd);
  const token = readBearerToken(settings.tokenFile, cwd);
  const config = readManagedReleaseConfig(settings.configFile, outputs, cwd);
  const vars = mergedWorkerVars(outputs, config.vars);
  // Reject every malformed or colliding binding before the first artifact or
  // secret write. Release retries are idempotent, but invalid local input must
  // never be allowed to cause even a recoverable Cloud-side mutation.
  assertUniqueBindingNames(vars, config.resources, config.secretNames);
  for (const binding of config.resources) {
    const resource = binding.resource;
    const connection = config.connections?.[binding.name];
    if (
      resource.space !== settings.workspaceId ||
      resource.uid !==
        `tkrn:${resource.space}:${resource.kind}:${resource.name}` ||
      !connection ||
      connection.resource !== resource.uid ||
      connection.projection !== "runtime_binding"
    ) {
      throw new Error(
        "Takos managed release Resource evidence must match one canonical runtime_binding connection in the release Workspace.",
      );
    }
  }
  if (
    Object.keys(config.connections ?? {}).length !== config.resources.length
  ) {
    throw new Error(
      "Every Takos managed runtime_binding connection requires one exact canonical Ready Resource evidence entry.",
    );
  }
  const secrets = settings.secretsFile
    ? readManagedReleaseSecrets(settings.secretsFile, cwd)
    : {};
  assertExactSecretSet(config.secretNames, secrets);

  const [{ bytes: archiveBytes, sha256: archiveHex, sizeBytes }, status] =
    await Promise.all([
      readWorkerReleaseArtifactBytes(artifactConfig, fetchImpl),
      requestJson(fetchImpl, token, settings.baseUrl, {
        method: "GET",
        path: cloudReleasePath(settings, ""),
        allowNotFound: true,
      }),
    ]);
  const archiveSha256 = `sha256:${archiveHex}`;
  const expectedActiveDeploymentDigest = expectedActiveDigest(
    status ?? { deployments: [] },
    config.expectedActiveDeploymentDigest,
  );

  const archive = await stageArtifact(fetchImpl, token, settings, {
    purpose: "worker_release",
    contentType: "application/gzip",
    sha256: archiveSha256,
    bytes: archiveBytes,
    idempotencyKey: await idempotencyKey(settings.idempotencyKey, "archive"),
  });

  await Promise.all(
    Object.entries(secrets).map(async ([name, value]) => {
      const result = await requestJson(fetchImpl, token, settings.baseUrl, {
        method: "PUT",
        path: cloudReleasePath(
          settings,
          `/secrets/${encodeURIComponent(name)}`,
        ),
        headers: {
          "content-type": "application/json",
          "idempotency-key": await idempotencyKey(
            settings.idempotencyKey,
            `secret:${name}`,
          ),
        },
        body: JSON.stringify({ value }),
      });
      const ref = objectField(result, "secret response").secret;
      assertSecretReference(ref, name);
    }),
  );

  const materializedResponse = await requestJson(
    fetchImpl,
    token,
    settings.baseUrl,
    {
      method: "POST",
      path: cloudReleasePath(settings, "/materialize"),
      headers: {
        "content-type": "application/json",
        "idempotency-key": await idempotencyKey(
          settings.idempotencyKey,
          "materialize",
        ),
      },
      body: JSON.stringify({
        archiveRef: archive.ref,
        archiveSha256,
        compatibilityDate: config.compatibilityDate,
        compatibilityFlags: config.compatibilityFlags,
        vars,
        resources: config.resources,
        secretNames: config.secretNames,
        ...(config.assetsConfig ? { assetsConfig: config.assetsConfig } : {}),
        ...(config.observability
          ? { observability: config.observability }
          : {}),
        ...(config.annotations ? { annotations: config.annotations } : {}),
        ...(expectedActiveDeploymentDigest
          ? { expectedActiveDeploymentDigest }
          : {}),
      }),
      maxResponseBytes: MAX_MATERIALIZE_RESPONSE_BYTES,
    },
  );
  const materialization = validateMaterialization(
    objectField(materializedResponse, "materialize response").materialization,
    { archiveRef: archive.ref, archiveSha256 },
  );

  const manifestBytes = new TextEncoder().encode(materialization.manifestBody);
  const actualManifestDigest = `sha256:${await sha256Hex(manifestBytes)}`;
  if (actualManifestDigest !== materialization.manifestSha256) {
    throw new Error(
      "Takosumi Cloud returned release manifest bytes that do not match its digest.",
    );
  }
  const manifest = await stageArtifact(fetchImpl, token, settings, {
    purpose: "worker_release_manifest",
    contentType: materialization.manifestContentType,
    sha256: materialization.manifestSha256,
    bytes: manifestBytes,
    idempotencyKey: await idempotencyKey(settings.idempotencyKey, "manifest"),
  });

  const desired = canonicalEdgeWorkerRequest(settings, config, manifest);
  const preview = await requestJson(fetchImpl, token, settings.baseUrl, {
    method: "POST",
    path: "/v1/resources/preview",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(desired),
  });
  const review = deploymentReview(preview);
  assertExactResourceSource(
    objectField(preview, "Resource preview").resource,
    settings,
    config,
    manifest,
    "preview",
  );

  const applied = await requestJson(fetchImpl, token, settings.baseUrl, {
    method: "PUT",
    path: canonicalResourcePath(settings),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...desired, review }),
  });
  assertExactResourceSource(applied, settings, config, manifest, "apply");

  const resource = await waitForExactReadyResource({
    fetchImpl,
    token,
    settings,
    config,
    manifest,
    initial: applied,
    wait,
  });
  const confirmedResponse = await requestJson(
    fetchImpl,
    token,
    settings.baseUrl,
    {
      method: "POST",
      path: cloudReleasePath(
        settings,
        `/deployments/${encodeURIComponent(materialization.deployment.id)}/confirm`,
      ),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        manifestRef: manifest.ref,
        manifestSha256: manifest.digest,
      }),
    },
  );
  const confirmed = objectField(
    objectField(confirmedResponse, "promotion response").deployment,
    "promotion deployment",
  );
  if (
    confirmed.id !== materialization.deployment.id ||
    confirmed.digest !== materialization.deployment.digest ||
    confirmed.state !== "active" ||
    typeof confirmed.canonicalResourceEtag !== "string" ||
    !confirmed.canonicalResourceEtag
  ) {
    throw new Error(
      "Takosumi Cloud did not return exact active canonical promotion evidence.",
    );
  }

  return {
    mode: "takosumi-managed",
    environment,
    workspaceId: settings.workspaceId,
    resourceName: settings.resourceName,
    archive: { sha256: archiveSha256, sizeBytes },
    manifest: { ref: manifest.ref, sha256: manifest.digest },
    version: {
      id: materialization.version.id,
      digest: materialization.version.digest,
    },
    deployment: {
      id: confirmed.id,
      digest: confirmed.digest,
      state: confirmed.state,
      canonicalResourceEtag: confirmed.canonicalResourceEtag,
    },
    resource: {
      id: resource.id,
      generation: resource.metadata.generation,
      phase: resource.status.phase,
    },
  };
}

export function managedReleaseSettings(
  outputs,
  environment,
  env = process.env,
  cwd = process.cwd(),
) {
  const rawBaseUrl =
    stringValue(env.TAKOS_MANAGED_RELEASE_URL) ??
    stringValue(env.TAKOSUMI_CONTROL_URL);
  if (!rawBaseUrl) {
    throw new Error(
      "TAKOS_MANAGED_RELEASE_URL (or TAKOSUMI_CONTROL_URL) is required for a managed Takos release.",
    );
  }
  const baseUrl = new URL(rawBaseUrl);
  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
    throw new Error("Takosumi managed release URL must use HTTPS.");
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error(
      "Takosumi managed release URL must not contain credentials, query, or fragment.",
    );
  }
  if (baseUrl.pathname !== "/") {
    throw new Error("Takosumi managed release URL must be a bare origin.");
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/$/u, "");
  const workspaceId = requiredIdentity(
    env.TAKOS_MANAGED_RELEASE_WORKSPACE_ID,
    "TAKOS_MANAGED_RELEASE_WORKSPACE_ID",
  );
  const resourceName =
    stringValue(env.TAKOS_MANAGED_RELEASE_RESOURCE_NAME) ??
    requiredOutputString(outputs, "service_runtime_name");
  if (!NAME.test(resourceName)) {
    throw new Error("Takos managed EdgeWorker Resource name is invalid.");
  }
  const tokenFile = requiredAbsolutePath(
    env.TAKOS_MANAGED_RELEASE_ACCESS_TOKEN_FILE,
    "TAKOS_MANAGED_RELEASE_ACCESS_TOKEN_FILE",
  );
  const configFile = requiredAbsolutePath(
    env.TAKOS_MANAGED_RELEASE_CONFIG_FILE,
    "TAKOS_MANAGED_RELEASE_CONFIG_FILE",
  );
  const secretsFile = stringValue(env.TAKOS_MANAGED_RELEASE_SECRETS_FILE)
    ? requiredAbsolutePath(
        env.TAKOS_MANAGED_RELEASE_SECRETS_FILE,
        "TAKOS_MANAGED_RELEASE_SECRETS_FILE",
      )
    : undefined;
  const idempotencyKeyValue = stringValue(
    env.TAKOS_MANAGED_RELEASE_IDEMPOTENCY_KEY,
  );
  if (
    !idempotencyKeyValue ||
    idempotencyKeyValue.length < 8 ||
    idempotencyKeyValue.length > 256 ||
    /[^\x21-\x7e]/u.test(idempotencyKeyValue)
  ) {
    throw new Error(
      "TAKOS_MANAGED_RELEASE_IDEMPOTENCY_KEY must be 8-256 visible ASCII characters and unique to the reviewed release candidate.",
    );
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/$/u, ""),
    workspaceId,
    resourceName,
    tokenFile,
    configFile,
    secretsFile,
    idempotencyKey: idempotencyKeyValue,
    readyAttempts: boundedInteger(
      env.TAKOS_MANAGED_RELEASE_READY_ATTEMPTS,
      DEFAULT_READY_ATTEMPTS,
      1,
      200,
      "TAKOS_MANAGED_RELEASE_READY_ATTEMPTS",
    ),
    readyIntervalMs: boundedInteger(
      env.TAKOS_MANAGED_RELEASE_READY_INTERVAL_MS,
      DEFAULT_READY_INTERVAL_MS,
      0,
      30_000,
      "TAKOS_MANAGED_RELEASE_READY_INTERVAL_MS",
    ),
    cwd: resolve(cwd),
    environment,
  };
}

export function readManagedReleaseConfig(
  path,
  outputs = {},
  cwd = process.cwd(),
) {
  assertOutsideRepository(path, cwd, "Takos managed release config file");
  const parsed = parseJsonFile(
    readRegularFile(path, MAX_CONFIG_BYTES, false),
    "Takos managed release config",
  );
  assertOnlyKeys(parsed, [
    "kind",
    "compatibilityDate",
    "compatibilityFlags",
    "vars",
    "resources",
    "secretNames",
    "assetsConfig",
    "observability",
    "annotations",
    "expectedActiveDeploymentDigest",
    "profiles",
    "connections",
    "lifecyclePolicy",
    "labels",
    "targetPoolName",
    "spacePolicyName",
  ]);
  if (parsed.kind !== CONFIG_KIND) {
    throw new Error(
      `Takos managed release config kind must be ${CONFIG_KIND}.`,
    );
  }
  const compatibilityDate = requiredString(
    parsed.compatibilityDate,
    "compatibilityDate",
  );
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(compatibilityDate) ||
    !validCalendarDate(compatibilityDate)
  ) {
    throw new Error("Takos managed release compatibilityDate is invalid.");
  }
  const compatibilityFlags = stringArray(
    parsed.compatibilityFlags,
    "compatibilityFlags",
    64,
  );
  const vars = validateVars(parsed.vars);
  const resources = validateResources(parsed.resources);
  const secretNames = bindingNameArray(parsed.secretNames, "secretNames");
  const profiles = stringArray(parsed.profiles, "profiles", 64);
  const connections = validateConnections(parsed.connections);
  const lifecyclePolicy = optionalObject(
    parsed.lifecyclePolicy,
    "lifecyclePolicy",
  );
  const labels = optionalStringMap(parsed.labels, "labels", 64, 256);
  const annotations = optionalStringMap(
    parsed.annotations,
    "annotations",
    64,
    1024,
  );
  const expected = parsed.expectedActiveDeploymentDigest;
  if (expected !== undefined && !SHA256.test(expected)) {
    throw new Error(
      "Takos managed release expectedActiveDeploymentDigest is invalid.",
    );
  }
  validateAssetsConfig(parsed.assetsConfig);
  validateObservability(parsed.observability);
  const targetPoolName = optionalName(parsed.targetPoolName, "targetPoolName");
  const spacePolicyName = optionalName(
    parsed.spacePolicyName,
    "spacePolicyName",
  );
  // Resolve the ordinary output map during config admission so malformed
  // OpenTofu projection cannot reach an HTTP side effect later.
  mergedWorkerVars(outputs, vars);
  return {
    kind: CONFIG_KIND,
    compatibilityDate,
    compatibilityFlags,
    vars,
    resources,
    secretNames,
    profiles,
    ...(connections ? { connections } : {}),
    ...(lifecyclePolicy ? { lifecyclePolicy } : {}),
    ...(labels ? { labels } : {}),
    ...(annotations ? { annotations } : {}),
    ...(parsed.assetsConfig ? { assetsConfig: parsed.assetsConfig } : {}),
    ...(parsed.observability ? { observability: parsed.observability } : {}),
    ...(expected ? { expectedActiveDeploymentDigest: expected } : {}),
    ...(targetPoolName ? { targetPoolName } : {}),
    ...(spacePolicyName ? { spacePolicyName } : {}),
  };
}

export function readManagedReleaseSecrets(path, cwd = process.cwd()) {
  assertOutsideRepository(path, cwd, "Takos managed release secrets file");
  const parsed = parseJsonFile(
    readRegularFile(path, MAX_SECRET_FILE_BYTES, true),
    "Takos managed release secrets file",
  );
  const entries = Object.entries(parsed);
  if (entries.length > 256) {
    throw new Error("Takos managed release secrets file has too many entries.");
  }
  const result = {};
  for (const [name, value] of entries) {
    if (
      !BINDING_NAME.test(name) ||
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > 64 * 1024
    ) {
      throw new Error("Takos managed release secrets file is invalid.");
    }
    result[name] = value;
  }
  return result;
}

function readBearerToken(path, cwd) {
  assertOutsideRepository(path, cwd, "Takos managed release token file");
  const token = new TextDecoder().decode(
    readRegularFile(path, MAX_TOKEN_BYTES, true),
  );
  const normalized = token.trim();
  if (
    normalized.length < 16 ||
    normalized.length > 8192 ||
    /\s/u.test(normalized) ||
    /[^\x21-\x7e]/u.test(normalized)
  ) {
    throw new Error("Takos managed release access token file is invalid.");
  }
  return normalized;
}

function readRegularFile(path, maxBytes, privateFile) {
  if (!isAbsolute(path))
    throw new Error("Managed release paths must be absolute.");
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error("Managed release files must not be symlinks.");
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const fd = openSync(path, fsConstants.O_RDONLY | noFollow);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new Error("Managed release file is not a bounded regular file.");
    }
    if (privateFile && (stat.mode & 0o777) !== 0o600) {
      throw new Error("Managed release credential files must have mode 0600.");
    }
    const uid = process.getuid?.();
    if (privateFile && uid !== undefined && stat.uid !== uid) {
      throw new Error(
        "Managed release credential files must be owned by the current user.",
      );
    }
    return new Uint8Array(readFileSync(fd));
  } finally {
    closeSync(fd);
  }
}

function assertOutsideRepository(path, cwd, label) {
  const real = realpathSync(path);
  const repo = realpathSync(cwd);
  const fromRepo = relative(repo, real);
  if (
    fromRepo === "" ||
    (!fromRepo.startsWith("..") && !isAbsolute(fromRepo))
  ) {
    throw new Error(`${label} must live outside the Takos repository.`);
  }
}

function parseJsonFile(bytes, label) {
  try {
    return objectField(JSON.parse(new TextDecoder().decode(bytes)), label);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} is not JSON.`);
    throw error;
  }
}

function canonicalEdgeWorkerRequest(settings, config, manifest) {
  return {
    kind: "EdgeWorker",
    metadata: {
      name: settings.resourceName,
      space: settings.workspaceId,
      ...(config.labels ? { labels: config.labels } : {}),
    },
    spec: {
      name: settings.resourceName,
      source: {
        artifactRef: manifest.ref,
        artifactSha256: manifest.digest,
      },
      compatibilityDate: config.compatibilityDate,
      compatibilityFlags: config.compatibilityFlags,
      ...(config.profiles.length > 0 ? { profiles: config.profiles } : {}),
      ...(config.connections ? { connections: config.connections } : {}),
      ...(config.lifecyclePolicy
        ? { lifecyclePolicy: config.lifecyclePolicy }
        : {}),
    },
    ...(config.targetPoolName ? { targetPoolName: config.targetPoolName } : {}),
    ...(config.spacePolicyName
      ? { spacePolicyName: config.spacePolicyName }
      : {}),
  };
}

async function stageArtifact(fetchImpl, token, settings, input) {
  const response = await requestJson(fetchImpl, token, settings.baseUrl, {
    method: "POST",
    path: `${canonicalResourceBasePath(settings)}/artifacts?space=${encodeURIComponent(settings.workspaceId)}`,
    headers: {
      "content-type": input.contentType,
      "content-encoding": "identity",
      "idempotency-key": input.idempotencyKey,
      "x-takosumi-artifact-purpose": input.purpose,
      "x-takosumi-artifact-sha256": input.sha256,
    },
    body: input.bytes,
  });
  const body = objectField(response, "artifact response");
  const artifact = objectField(body.artifact, "artifact pointer");
  const run = objectField(body.run, "artifact Run");
  if (
    artifact.purpose !== input.purpose ||
    artifact.digest !== input.sha256 ||
    artifact.sizeBytes !== input.bytes.byteLength ||
    typeof artifact.ref !== "string" ||
    !artifact.ref ||
    artifact.ref.length > 1024 ||
    run.type !== "artifact" ||
    run.resourceOperation !== "artifact" ||
    run.status !== "succeeded" ||
    typeof body.replayed !== "boolean"
  ) {
    throw new Error("Takosumi returned invalid canonical artifact evidence.");
  }
  return {
    purpose: artifact.purpose,
    ref: artifact.ref,
    digest: artifact.digest,
    sizeBytes: artifact.sizeBytes,
  };
}

function validateMaterialization(value, expectedArchive) {
  const materialization = objectField(value, "materialization");
  const archive = objectField(materialization.archive, "materialized archive");
  const version = objectField(materialization.version, "materialized version");
  const deployment = objectField(
    materialization.deployment,
    "materialized deployment",
  );
  if (
    materialization.kind !==
      "takosumi.cloud-edge-worker-bundle-materialization@v1" ||
    archive.ref !== expectedArchive.archiveRef ||
    archive.sha256 !== expectedArchive.archiveSha256 ||
    materialization.manifestPurpose !== "worker_release_manifest" ||
    materialization.manifestContentType !==
      "application/vnd.takosumi.cloud-edge-worker-release+json" ||
    typeof materialization.manifestBody !== "string" ||
    !SHA256.test(materialization.manifestSha256) ||
    typeof version.id !== "string" ||
    !/^ewv_[0-9a-f]{64}$/u.test(version.id) ||
    !SHA256.test(version.digest) ||
    version.id !== `ewv_${version.digest.slice("sha256:".length)}` ||
    typeof deployment.id !== "string" ||
    !/^ewd_[0-9a-f]{64}$/u.test(deployment.id) ||
    !SHA256.test(deployment.digest) ||
    deployment.id !== `ewd_${deployment.digest.slice("sha256:".length)}` ||
    deployment.state !== "promotion_pending"
  ) {
    throw new Error("Takosumi Cloud returned invalid release materialization.");
  }
  let manifest;
  try {
    manifest = objectField(
      JSON.parse(materialization.manifestBody),
      "release manifest",
    );
  } catch {
    throw new Error("Takosumi Cloud returned an invalid release manifest.");
  }
  assertOnlyKeys(manifest, ["kind", "deployment", "versions"]);
  if (
    manifest.kind !== "takosumi.cloud-edge-worker-materialization@v1" ||
    canonicalJson(manifest.deployment) !== canonicalJson(deployment) ||
    !Array.isArray(manifest.versions) ||
    manifest.versions.length !== 1 ||
    canonicalJson(manifest.versions[0]) !== canonicalJson(version)
  ) {
    throw new Error(
      "Takosumi Cloud release manifest does not exactly bind its returned deployment and version.",
    );
  }
  return {
    kind: materialization.kind,
    archive,
    version,
    deployment,
    manifestPurpose: materialization.manifestPurpose,
    manifestContentType: materialization.manifestContentType,
    manifestBody: materialization.manifestBody,
    manifestSha256: materialization.manifestSha256,
  };
}

function deploymentReview(value) {
  const preview = objectField(value, "Resource preview");
  if (!SHA256.test(preview.planDigest)) {
    throw new Error(
      "Takosumi Resource preview returned an invalid plan digest.",
    );
  }
  const quote = preview.quote;
  if (quote === undefined) return { planDigest: preview.planDigest };
  const evidence = objectField(quote, "Resource quote");
  if (
    typeof evidence.quoteId !== "string" ||
    !evidence.quoteId ||
    !SHA256.test(evidence.quoteDigest)
  ) {
    throw new Error(
      "Takosumi Resource preview returned invalid quote evidence.",
    );
  }
  return {
    planDigest: preview.planDigest,
    quoteId: evidence.quoteId,
    quoteDigest: evidence.quoteDigest,
  };
}

async function waitForExactReadyResource({
  fetchImpl,
  token,
  settings,
  config,
  manifest,
  initial,
  wait,
}) {
  let resource = initial;
  for (let attempt = 1; attempt <= settings.readyAttempts; attempt += 1) {
    if (exactReadyResource(resource, settings, config, manifest))
      return resource;
    const status = objectField(resource, "canonical Resource").status;
    if (
      status &&
      typeof status === "object" &&
      ["Failed", "Degraded", "Deleted"].includes(status.phase)
    ) {
      throw new Error(
        `Takosumi canonical EdgeWorker entered terminal phase ${status.phase}.`,
      );
    }
    if (attempt < settings.readyAttempts) {
      await wait(settings.readyIntervalMs);
      resource = await requestJson(fetchImpl, token, settings.baseUrl, {
        method: "GET",
        path: canonicalResourcePath(settings),
      });
      assertExactResourceSource(
        resource,
        settings,
        config,
        manifest,
        "Ready poll",
      );
    }
  }
  throw new Error(
    "Takosumi canonical EdgeWorker did not become exact Ready before the bounded deadline; promotion remains unconfirmed.",
  );
}

function exactReadyResource(value, settings, config, manifest) {
  const resource = objectField(value, "canonical Resource");
  const metadata = objectField(resource.metadata, "Resource metadata");
  const status = objectField(resource.status, "Resource status");
  return (
    resource.id ===
      `tkrn:${settings.workspaceId}:EdgeWorker:${settings.resourceName}` &&
    resource.kind === "EdgeWorker" &&
    metadata.space === settings.workspaceId &&
    metadata.name === settings.resourceName &&
    Number.isSafeInteger(metadata.generation) &&
    metadata.generation > 0 &&
    status.phase === "Ready" &&
    status.observedGeneration === metadata.generation &&
    exactSpec(resource, settings, config, manifest)
  );
}

function assertExactResourceSource(value, settings, config, manifest, stage) {
  const resource = objectField(value, `Resource ${stage}`);
  const metadata = objectField(resource.metadata, `Resource ${stage} metadata`);
  if (
    resource.kind !== "EdgeWorker" ||
    metadata.space !== settings.workspaceId ||
    metadata.name !== settings.resourceName ||
    !exactSpec(resource, settings, config, manifest)
  ) {
    throw new Error(
      `Takosumi Resource ${stage} substituted the exact manifest-backed EdgeWorker.`,
    );
  }
}

function exactSpec(resource, settings, config, manifest) {
  const spec = objectField(resource.spec, "Resource spec");
  const expected = canonicalEdgeWorkerRequest(settings, config, manifest).spec;
  return canonicalJson(spec) === canonicalJson(expected);
}

function expectedActiveDigest(statusValue, configured) {
  const status = objectField(statusValue, "Cloud release status");
  if (!Array.isArray(status.deployments)) {
    throw new Error("Takosumi Cloud release status is invalid.");
  }
  const active = status.deployments.filter(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      candidate.state === "active",
  );
  if (active.length > 1) {
    throw new Error(
      "Takosumi Cloud has multiple active EdgeWorker deployments; release is fenced.",
    );
  }
  const actual = active[0]?.digest;
  if (actual !== undefined && !SHA256.test(actual)) {
    throw new Error("Takosumi Cloud active deployment digest is invalid.");
  }
  if (configured && configured !== actual) {
    throw new Error(
      "Takos managed release expected active deployment digest does not match current Cloud state.",
    );
  }
  return configured ?? actual;
}

async function requestJson(fetchImpl, token, baseUrl, request) {
  const url = new URL(request.path, `${baseUrl}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      method: request.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...request.headers,
      },
      ...(request.body === undefined ? {} : { body: request.body }),
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    throw new Error(
      `Takosumi managed release request failed before a response: ${request.method} ${url.pathname}.`,
    );
  }
  let bytes;
  try {
    bytes = await readBoundedResponse(
      response,
      request.maxResponseBytes ?? MAX_RESPONSE_BYTES,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Takosumi managed release response exceeds its limit."
    ) {
      throw error;
    }
    throw new Error(
      `Takosumi managed release response body failed: ${request.method} ${url.pathname} HTTP ${response.status}.`,
    );
  } finally {
    clearTimeout(timeout);
  }
  let body;
  try {
    body = bytes.byteLength
      ? JSON.parse(new TextDecoder().decode(bytes))
      : undefined;
  } catch {
    throw new Error(
      `Takosumi managed release returned non-JSON: ${request.method} ${url.pathname} HTTP ${response.status}.`,
    );
  }
  if (!response.ok) {
    const code = safeErrorCode(body);
    if (
      request.allowNotFound === true &&
      response.status === 404 &&
      code === "not_found"
    ) {
      return null;
    }
    throw new Error(
      `Takosumi managed release request failed: ${request.method} ${url.pathname} HTTP ${response.status}${code ? ` (${code})` : ""}.`,
    );
  }
  return body;
}

async function readBoundedResponse(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Takosumi managed release response exceeds its limit.");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response limit exceeded");
        throw new Error("Takosumi managed release response exceeds its limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function safeErrorCode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const direct = value.error;
  const nested =
    direct && typeof direct === "object" && !Array.isArray(direct)
      ? direct.code
      : undefined;
  const candidate = typeof direct === "string" ? direct : nested;
  return typeof candidate === "string" &&
    /^[A-Za-z0-9._-]{1,96}$/u.test(candidate)
    ? candidate
    : "";
}

function cloudReleasePath(settings, suffix) {
  return `/v1/cloud/edge-worker-releases/${encodeURIComponent(settings.resourceName)}${suffix}?workspaceId=${encodeURIComponent(settings.workspaceId)}`;
}

function canonicalResourcePath(settings) {
  return `${canonicalResourceBasePath(settings)}?space=${encodeURIComponent(settings.workspaceId)}`;
}

function canonicalResourceBasePath(settings) {
  return `/v1/resources/EdgeWorker/${encodeURIComponent(settings.resourceName)}`;
}

function mergedWorkerVars(outputs, configured) {
  const vars = new Map();
  const workerEnv = ordinaryOutputValue(outputs, "worker_env");
  if (workerEnv !== undefined) {
    const ordinary = objectField(workerEnv, "worker_env output");
    for (const [name, value] of Object.entries(ordinary)) {
      if (
        !BINDING_NAME.test(name) ||
        SECRET_LIKE_NAME.test(name) ||
        typeof value !== "string" ||
        value.length > 64 * 1024
      ) {
        throw new Error("Takos worker_env Output is invalid.");
      }
      vars.set(name, { type: "plain_text", name, text: value });
    }
  }
  const launchUrl = ["launch_url", "public_url", "url"]
    .map((name) => ordinaryOutputValue(outputs, name))
    .find((value) => typeof value === "string" && value.trim() !== "");
  if (typeof launchUrl === "string") {
    const url = new URL(launchUrl);
    if (url.protocol !== "https:") {
      throw new Error("Takos managed launch URL must use HTTPS.");
    }
    for (const [name, text] of [
      ["ADMIN_DOMAIN", url.hostname],
      ["TENANT_BASE_DOMAIN", url.hostname],
      ["AUTH_PUBLIC_BASE_URL", url.origin],
      ["PROXY_BASE_URL", url.origin],
      ["TAKOS_AGENT_CONTROL_RPC_BASE_URL", url.origin],
    ]) {
      vars.set(name, { type: "plain_text", name, text });
    }
  }
  for (const entry of configured ?? []) vars.set(entry.name, entry);
  return [...vars.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function validateVars(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error("Takos managed release vars is invalid.");
  }
  const result = value.map((candidate) => {
    const row = objectField(candidate, "managed release var");
    if (!BINDING_NAME.test(row.name) || SECRET_LIKE_NAME.test(row.name)) {
      throw new Error(
        "Takos managed release vars cannot contain invalid or secret-like binding names.",
      );
    }
    if (row.type === "plain_text") {
      assertOnlyKeys(row, ["type", "name", "text"]);
      if (typeof row.text !== "string" || row.text.length > 64 * 1024) {
        throw new Error("Takos managed release plain_text var is invalid.");
      }
      return { type: "plain_text", name: row.name, text: row.text };
    }
    if (row.type === "json") {
      assertOnlyKeys(row, ["type", "name", "json"]);
      const serialized = JSON.stringify(row.json);
      if (
        typeof serialized !== "string" ||
        new TextEncoder().encode(serialized).byteLength > 64 * 1024
      ) {
        throw new Error("Takos managed release JSON var is too large.");
      }
      return { type: "json", name: row.name, json: row.json };
    }
    throw new Error("Takos managed release var type is invalid.");
  });
  if (new Set(result.map((entry) => entry.name)).size !== result.length) {
    throw new Error("Takos managed release vars contains duplicate names.");
  }
  return result;
}

function validateResources(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("Takos managed release resources is invalid.");
  }
  return value.map((candidate) => {
    const row = objectField(candidate, "managed release resource binding");
    assertOnlyKeys(row, ["name", "resource"]);
    if (!BINDING_NAME.test(row.name)) {
      throw new Error(
        "Takos managed release resource binding name is invalid.",
      );
    }
    const resource = objectField(
      row.resource,
      "managed release Resource evidence",
    );
    assertOnlyKeys(resource, [
      "space",
      "kind",
      "name",
      "uid",
      "observedGeneration",
      "etag",
      "nativeResources",
    ]);
    if (
      !requiredIdentity(resource.space, "resource.space") ||
      !CAPABILITY_TOKEN.test(requiredString(resource.kind, "resource.kind")) ||
      !NAME.test(requiredString(resource.name, "resource.name")) ||
      !requiredString(resource.uid, "resource.uid") ||
      !requiredString(resource.etag, "resource.etag") ||
      !Number.isSafeInteger(resource.observedGeneration) ||
      resource.observedGeneration < 1 ||
      !Array.isArray(resource.nativeResources) ||
      resource.nativeResources.length > 128
    ) {
      throw new Error("Takos managed release Resource evidence is invalid.");
    }
    const nativeResources = resource.nativeResources.map((candidate) => {
      const native = objectField(candidate, "native Resource evidence");
      assertOnlyKeys(native, ["type", "id"]);
      return {
        type: requiredString(native.type, "native Resource type"),
        id: requiredString(native.id, "native Resource id"),
      };
    });
    return { name: row.name, resource: { ...resource, nativeResources } };
  });
}

function validateConnections(value) {
  if (value === undefined) return undefined;
  const connections = objectField(value, "connections");
  const entries = Object.entries(connections);
  if (entries.length > 128) {
    throw new Error("Takos managed release connections is invalid.");
  }
  const result = {};
  for (const [bindingName, candidate] of entries) {
    if (!BINDING_NAME.test(bindingName)) {
      throw new Error("Takos managed release connection name is invalid.");
    }
    const connection = objectField(candidate, "managed release connection");
    assertOnlyKeys(connection, ["resource", "permissions", "projection"]);
    const resource = requiredString(
      connection.resource,
      "managed release connection resource",
    );
    const permissions = stringArray(
      connection.permissions,
      "connection permissions",
      64,
    );
    if (
      resource.length > 2048 ||
      !resource.startsWith("tkrn:") ||
      /\s/u.test(resource) ||
      permissions.length === 0 ||
      permissions.some((permission) => !CAPABILITY_TOKEN.test(permission)) ||
      connection.projection !== "runtime_binding"
    ) {
      throw new Error("Takos managed release connection is invalid.");
    }
    result[bindingName] = {
      resource,
      permissions,
      projection: "runtime_binding",
    };
  }
  return result;
}

function validateAssetsConfig(value) {
  if (value === undefined) return;
  const row = objectField(value, "assetsConfig");
  assertOnlyKeys(row, ["htmlHandling", "notFoundHandling", "runWorkerFirst"]);
  for (const name of ["htmlHandling", "notFoundHandling"]) {
    if (row[name] !== undefined && typeof row[name] !== "string") {
      throw new Error("Takos managed release assetsConfig is invalid.");
    }
  }
  if (
    row.runWorkerFirst !== undefined &&
    typeof row.runWorkerFirst !== "boolean" &&
    (!Array.isArray(row.runWorkerFirst) ||
      row.runWorkerFirst.some((path) => typeof path !== "string" || !path))
  ) {
    throw new Error("Takos managed release assetsConfig is invalid.");
  }
}

function validateObservability(value) {
  if (value === undefined) return;
  const row = objectField(value, "observability");
  assertOnlyKeys(row, ["enabled", "headSamplingRate"]);
  if (
    typeof row.enabled !== "boolean" ||
    (row.headSamplingRate !== undefined &&
      (typeof row.headSamplingRate !== "number" ||
        !Number.isFinite(row.headSamplingRate) ||
        row.headSamplingRate < 0 ||
        row.headSamplingRate > 1))
  ) {
    throw new Error("Takos managed release observability is invalid.");
  }
}

function assertExactSecretSet(expected, actual) {
  const expectedNames = [...expected].sort();
  const actualNames = Object.keys(actual).sort();
  if (
    expectedNames.length !== actualNames.length ||
    expectedNames.some((name, index) => name !== actualNames[index])
  ) {
    throw new Error(
      "Takos managed release secrets file must contain exactly config.secretNames.",
    );
  }
}

function assertUniqueBindingNames(vars, resources, secretNames) {
  const names = [
    ...vars.map((entry) => entry.name),
    ...resources.map((entry) => entry.name),
    ...secretNames,
  ];
  if (new Set(names).size !== names.length) {
    throw new Error("Takos managed release binding names must be unique.");
  }
}

function assertSecretReference(value, expectedName) {
  const secret = objectField(value, "secret reference");
  if (
    secret.name !== expectedName ||
    typeof secret.versionRef !== "string" ||
    !secret.versionRef ||
    typeof secret.updatedAt !== "string" ||
    Number.isNaN(Date.parse(secret.updatedAt)) ||
    Object.hasOwn(secret, "value") ||
    Object.hasOwn(secret, "text")
  ) {
    throw new Error(
      "Takosumi Cloud returned invalid write-only secret evidence.",
    );
  }
}

async function idempotencyKey(base, role) {
  return `takos-${await sha256Text(`${base}\n${role}`)}`;
}

async function sha256Text(value) {
  return sha256Hex(new TextEncoder().encode(value));
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function outputValue(entry) {
  if (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    Object.hasOwn(entry, "value") &&
    Object.hasOwn(entry, "sensitive")
  ) {
    return entry.value;
  }
  return entry;
}

function ordinaryOutputValue(outputs, name) {
  const entry = outputs[name];
  if (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    Object.hasOwn(entry, "value") &&
    Object.hasOwn(entry, "sensitive") &&
    entry.sensitive !== false
  ) {
    throw new Error(
      `Takos managed release cannot project sensitive output ${name} as a Worker var.`,
    );
  }
  return outputValue(entry);
}

function requiredOutputString(outputs, name) {
  const value = outputValue(outputs[name]);
  return requiredString(value, `TAKOSUMI_OUTPUTS_JSON output ${name}`);
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function requiredIdentity(value, label) {
  const candidate = requiredString(value, label);
  if (!NAME.test(candidate)) {
    throw new Error(`${label} is invalid.`);
  }
  return candidate;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function requiredAbsolutePath(value, label) {
  const path = stringValue(value);
  if (!path || !isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return resolve(path);
}

function objectField(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function optionalObject(value, label) {
  return value === undefined ? undefined : objectField(value, label);
}

function optionalStringMap(value, label, maxEntries, maxValueLength) {
  if (value === undefined) return undefined;
  const row = objectField(value, label);
  if (
    Object.keys(row).length > maxEntries ||
    Object.entries(row).some(
      ([name, entry]) =>
        !name ||
        name.length > 128 ||
        typeof entry !== "string" ||
        entry.length > maxValueLength,
    )
  ) {
    throw new Error(`Takos managed release ${label} is invalid.`);
  }
  return row;
}

function optionalName(value, label) {
  if (value === undefined) return undefined;
  const candidate = requiredString(value, label);
  if (!NAME.test(candidate)) {
    throw new Error(`Takos managed release ${label} is invalid.`);
  }
  return candidate;
}

function stringArray(value, label, maxEntries) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > maxEntries ||
    value.some(
      (entry) =>
        typeof entry !== "string" || entry.length < 1 || entry.length > 256,
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`Takos managed release ${label} is invalid.`);
  }
  return [...value];
}

function bindingNameArray(value, label) {
  const names = stringArray(value, label, 256);
  if (names.some((name) => !BINDING_NAME.test(name))) {
    throw new Error(`Takos managed release ${label} is invalid.`);
  }
  return names;
}

function assertOnlyKeys(value, allowed) {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) {
    throw new Error("Takos managed release document contains unknown fields.");
  }
}

function canonicalJson(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function validCalendarDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function boundedInteger(value, fallback, min, max, label) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function defaultWait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
