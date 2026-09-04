/**
 * Module outputs -> realized Wrangler configuration.
 *
 * `deploy/cloudflare/wrangler.toml` is the WORKER-ARTIFACT HALF of the direct
 * Cloudflare adapter: the entry module, ASSETS, container images, Durable
 * Object migrations, routes, and binding wiring the Cloudflare OpenTofu
 * provider cannot express. It is checked in as an OSS-safe template carrying
 * the binding *shape* and no identity, because identity belongs to whichever
 * account the OpenTofu module was applied in.
 *
 * This projection joins the two halves: it reads the module's non-secret
 * Outputs and renders one operator-private config for exactly one environment.
 * It consumes no secret. The five runtime secrets are supplied out of band with
 * `wrangler secret put` and carried forward by the module's `inherit` bindings
 * (docs/deploy/runtime-secrets.md), so a secret value never reaches this file,
 * and any output that claims to hold one is refused rather than rendered.
 */

const ACCOUNT_ID = /^[0-9a-f]{32}$/u;
const CLOUDFLARE_IMAGE =
  /^registry\.cloudflare\.com\/([0-9a-f]{32})\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*@sha256:[0-9a-f]{64}$/u;
// The same two registries `deploy/opentofu/cloudflare/modules/platform/main.tf`
// accepts for `container_image`. A reference the module would reject must not
// be deployable through this lane either, or the two halves disagree.
const PUBLIC_IMAGE =
  /^docker\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*@sha256:[0-9a-f]{64}$/u;

/** Repository-relative paths this projection reads and writes. */
export const WRANGLER_TEMPLATE_PATH = "deploy/cloudflare/wrangler.toml";
export const REALIZED_CONFIG_PATH =
  "deploy/cloudflare/.wrangler-production.toml";

/**
 * The exact runtime secret binding names the Worker reads. Kept here so the
 * projection can prove it never writes one; the module owns the same list and
 * `bun run validate:opentofu-secrets` keeps both honest.
 */
export const RUNTIME_SECRET_BINDING_NAMES = [
  "ENCRYPTION_KEY",
  "TAKOS_AGENT_START_TOKEN",
  "TAKOS_INTERNAL_API_SECRET",
  "PLATFORM_PRIVATE_KEY",
  "PLATFORM_PUBLIC_KEY",
] as const;

/**
 * Desired Vectorize shape. `deploy/product-resources.json` declares the
 * resource (`embeddings`, shape `VectorIndex`); the dimensions and metric are
 * the Cloudflare adapter's expression of it and match
 * `deploy/opentofu/cloudflare/modules/platform/main.tf` `local.vectorize`.
 */
export const PRODUCT_VECTOR_INDEX = {
  resource: "embeddings",
  dimensions: 768,
  metric: "cosine",
} as const;

/** Container classes that must be backed by a Container application. */
export const CONTAINER_CLASS_NAMES = [
  "ExecutorContainerTier1",
  "ExecutorContainerTier2",
  "ExecutorContainerTier3",
] as const;

export type ModuleOutputs = Readonly<{
  accountId: string;
  serviceRuntimeName: string;
  publicUrl: string;
  publicHostname: string;
  workerEnv: Readonly<Record<string, string>>;
  d1: Readonly<{ id: string; name: string }>;
  kvNamespaceIds: Readonly<Record<string, string>>;
  objectBuckets: Readonly<Record<string, string>>;
  queues: Readonly<Record<string, string>>;
  vectorIndex: Readonly<{ name: string; dimensions: number; metric: string }>;
  runtimeSecretBindingNames: readonly string[];
  runtimeSecretsProvisioned: boolean;
  deploymentEnvironment: string | null;
  moduleWorkerVersionId: string | null;
}>;

export type WorkerBundle = Readonly<{
  entrypoint: string;
  assetsDirectory: string;
}>;

export type ProjectionInput = Readonly<{
  template: string;
  outputs: ModuleOutputs;
  containerImage: string;
  workerBundle?: WorkerBundle;
}>;

export type Projection = Readonly<{
  text: string;
  workerName: string;
  publicUrl: string;
  routes: readonly string[];
  workersDev: boolean;
  containerImage: string;
  /**
   * Template variables the module supplies no value for. They are removed
   * rather than shipped with a placeholder, and named so an operator sees
   * exactly what the module did not answer.
   */
  droppedVars: readonly string[];
  vars: Readonly<Record<string, string>>;
}>;

class ProjectionError extends Error {}

function fail(message: string): never {
  throw new ProjectionError(message);
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accepts either the `tofu output -json` envelope (`name -> {value, sensitive,
 * type}`) or a plain `name -> value` map an operator exports by hand. A
 * consumed output marked sensitive is refused: this surface renders a config
 * that is read by an operator and by Wrangler, and a sensitive value has no
 * business travelling that path.
 */
function readOutput(source: Record<string, unknown>, name: string): unknown {
  const entry = source[name];
  if (entry === undefined || entry === null) return undefined;
  if (isRecord(entry) && "value" in entry) {
    if (entry.sensitive === true) {
      fail(
        `module output ${name} is marked sensitive; this surface consumes non-secret outputs only`,
      );
    }
    return entry.value;
  }
  return entry;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`module output ${name} must be a non-empty string`);
  }
  return value.trim();
}

function requiredStringMap(
  value: unknown,
  name: string,
  keys: readonly string[],
): Record<string, string> {
  if (!isRecord(value)) fail(`module output ${name} must be an object`);
  const map: Record<string, string> = {};
  for (const key of keys) {
    const entry = value[key];
    if (typeof entry !== "string" || entry.trim().length === 0) {
      fail(`module output ${name} has no non-empty "${key}" key`);
    }
    map[key] = entry.trim();
  }
  return map;
}

export function parseModuleOutputs(raw: unknown): ModuleOutputs {
  if (!isRecord(raw)) fail("module outputs must be a JSON object");

  const accountId = requiredString(
    readOutput(raw, "cloudflare_account_id"),
    "cloudflare_account_id",
  );
  if (!ACCOUNT_ID.test(accountId)) {
    fail("module output cloudflare_account_id is not a Cloudflare account id");
  }

  const publicUrl = requiredString(
    readOutput(raw, "public_url") ?? readOutput(raw, "launch_url"),
    "public_url",
  ).replace(/\/+$/u, "");
  let publicHostname: string;
  try {
    const parsed = new URL(publicUrl);
    if (parsed.protocol !== "https:") throw new Error("not https");
    publicHostname = parsed.host;
  } catch {
    fail(`module output public_url must be an https URL, got ${publicUrl}`);
  }

  const workerEnvValue = readOutput(raw, "worker_env");
  if (!isRecord(workerEnvValue)) fail("module output worker_env must be an object");
  const workerEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(workerEnvValue)) {
    if (typeof value !== "string") {
      fail(`module output worker_env.${key} must be a string`);
    }
    if ((RUNTIME_SECRET_BINDING_NAMES as readonly string[]).includes(key)) {
      fail(
        `module output worker_env carries ${key}, which is a runtime secret the module must never hold`,
      );
    }
    workerEnv[key] = value;
  }

  const vectorDimensions = readOutput(raw, "cloudflare_vectorize_index_dimensions");
  if (typeof vectorDimensions !== "number" || !Number.isInteger(vectorDimensions)) {
    fail("module output cloudflare_vectorize_index_dimensions must be an integer");
  }

  const provisioned = readOutput(raw, "runtime_secrets_provisioned");
  if (typeof provisioned !== "boolean") {
    fail("module output runtime_secrets_provisioned must be a boolean");
  }

  const secretNames = readOutput(raw, "runtime_secret_binding_names");
  if (
    !Array.isArray(secretNames) ||
    secretNames.some((name) => typeof name !== "string")
  ) {
    fail("module output runtime_secret_binding_names must be a list of strings");
  }

  const moduleWorkerVersionId = readOutput(raw, "cloudflare_worker_version_id");
  const deploymentEnvironment = readOutput(raw, "deployment_environment");

  return {
    accountId,
    serviceRuntimeName: requiredString(
      readOutput(raw, "service_runtime_name"),
      "service_runtime_name",
    ),
    publicUrl,
    publicHostname,
    workerEnv,
    d1: {
      id: requiredString(
        readOutput(raw, "cloudflare_d1_database_id"),
        "cloudflare_d1_database_id",
      ),
      name: requiredString(
        readOutput(raw, "cloudflare_d1_database_name"),
        "cloudflare_d1_database_name",
      ),
    },
    kvNamespaceIds: requiredStringMap(
      readOutput(raw, "cloudflare_kv_namespace_ids"),
      "cloudflare_kv_namespace_ids",
      ["hostname_routing"],
    ),
    objectBuckets: requiredStringMap(
      readOutput(raw, "object_buckets"),
      "object_buckets",
      ["worker_bundles", "tenant_builds", "tenant_source", "git_objects", "offload"],
    ),
    queues: requiredStringMap(readOutput(raw, "queues"), "queues", [
      "runs",
      "runs_dlq",
      "index_jobs",
      "index_jobs_dlq",
      "notification_push",
      "notification_push_dlq",
    ]),
    vectorIndex: {
      name: requiredString(
        readOutput(raw, "cloudflare_vectorize_index_name"),
        "cloudflare_vectorize_index_name",
      ),
      dimensions: vectorDimensions,
      metric: requiredString(
        readOutput(raw, "cloudflare_vectorize_index_metric"),
        "cloudflare_vectorize_index_metric",
      ),
    },
    runtimeSecretBindingNames: secretNames as readonly string[],
    runtimeSecretsProvisioned: provisioned,
    deploymentEnvironment: deploymentEnvironment === undefined
      ? null
      : requiredString(deploymentEnvironment, "deployment_environment"),
    moduleWorkerVersionId:
      typeof moduleWorkerVersionId === "string" && moduleWorkerVersionId.length > 0
        ? moduleWorkerVersionId
        : null,
  };
}

/**
 * The Vectorize index the module declares must be the product-declared one.
 * A drifted shape is refused rather than reconciled: an existing index cannot
 * change its dimensions, so a mismatch means the desired state and the live
 * account disagree about what the binding is.
 */
export function assertProductVectorIndex(outputs: ModuleOutputs): void {
  if (!outputs.vectorIndex.name.endsWith(`-${PRODUCT_VECTOR_INDEX.resource}`)) {
    fail(
      `vector index ${outputs.vectorIndex.name} does not name the product resource ${PRODUCT_VECTOR_INDEX.resource}`,
    );
  }
  if (
    outputs.vectorIndex.dimensions !== PRODUCT_VECTOR_INDEX.dimensions ||
    outputs.vectorIndex.metric !== PRODUCT_VECTOR_INDEX.metric
  ) {
    fail(
      `vector index shape ${outputs.vectorIndex.dimensions}/${outputs.vectorIndex.metric} does not match the product shape ` +
        `${PRODUCT_VECTOR_INDEX.dimensions}/${PRODUCT_VECTOR_INDEX.metric}`,
    );
  }
}

export function assertPinnedContainerImage(
  image: string,
  accountId: string,
): void {
  if (CLOUDFLARE_IMAGE.test(image)) {
    const registryAccount = CLOUDFLARE_IMAGE.exec(image)?.[1];
    if (registryAccount !== accountId) {
      fail(
        `container image is published in Cloudflare account ${registryAccount}, not the target account ${accountId}`,
      );
    }
    return;
  }
  if (PUBLIC_IMAGE.test(image)) return;
  fail(
    `container image must be a digest-pinned reference (registry.cloudflare.com/<account>/<name>@sha256:… or docker.io|ghcr.io/<name>@sha256:…), got ${image}`,
  );
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * One pass, longest token first. Sequential `replaceAll` calls would let
 * `"takos-runs"` corrupt `"takos-runs-dlq"`, and a rendered config that binds
 * the wrong queue is exactly the class of defect this projection exists to
 * remove.
 */
function substituteTokens(
  text: string,
  replacements: ReadonlyMap<string, string>,
): string {
  const tokens = [...replacements.keys()].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
  if (tokens.length === 0) return text;
  const pattern = new RegExp(tokens.map(escapeForRegExp).join("|"), "gu");
  return text.replace(pattern, (match) => replacements.get(match) ?? match);
}

function templateVars(lines: readonly string[]): {
  start: number;
  end: number;
  vars: Record<string, string>;
} {
  const start = lines.findIndex((line) => line.trim() === "[vars]");
  if (start === -1) fail("the Wrangler template declares no [vars] table");
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("[")) end += 1;
  const vars: Record<string, string> = {};
  for (const line of lines.slice(start + 1, end)) {
    const match = /^([A-Z0-9_]+)\s*=\s*"(.*)"\s*$/u.exec(line.trim());
    if (match) vars[match[1]] = match[2];
  }
  return { start, end, vars };
}

export function renderWranglerConfig(input: ProjectionInput): Projection {
  const { outputs, containerImage } = input;
  assertProductVectorIndex(outputs);
  assertPinnedContainerImage(containerImage, outputs.accountId);

  // One realized config describes exactly one environment. The template's
  // `[env.staging]` block is a second, placeholder-bearing environment, so it
  // is dropped rather than rendered half-resolved.
  const stagingStart = input.template.split("\n").findIndex((line) =>
    line.startsWith("[env."),
  );
  const baseLines =
    stagingStart === -1
      ? input.template.split("\n")
      : input.template.split("\n").slice(0, stagingStart);

  const { start, end, vars: templateDefaults } = templateVars(baseLines);
  const droppedVars: string[] = [];
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(templateDefaults)) {
    if (outputs.workerEnv[name] !== undefined) continue;
    if (/replace-with-|your-domain\.example|takosumi\.example/u.test(value)) {
      droppedVars.push(name);
      continue;
    }
    vars[name] = value;
  }
  for (const [name, value] of Object.entries(outputs.workerEnv)) {
    vars[name] = value;
  }

  const renderedVars = [
    "[vars]",
    "# Rendered from the OpenTofu module's non-secret worker_env Output.",
    ...Object.keys(vars)
      .sort()
      .map((name) => `${name} = ${quote(vars[name])}`),
    "",
  ];

  const workersDev = outputs.publicHostname.endsWith(".workers.dev");
  const routes = workersDev ? [] : [outputs.publicHostname];

  const replacements = new Map<string, string>([
    ['name = "takos"', `name = ${quote(outputs.serviceRuntimeName)}`],
    ['service = "takos"', `service = ${quote(outputs.serviceRuntimeName)}`],
    ['"takos-control-db"', quote(outputs.d1.name)],
    ['"replace-with-d1-database-id"', quote(outputs.d1.id)],
    [
      '"replace-with-hostname-routing-kv-namespace-id"',
      quote(outputs.kvNamespaceIds.hostname_routing),
    ],
    ['"takos-worker-bundles"', quote(outputs.objectBuckets.worker_bundles)],
    ['"takos-tenant-builds"', quote(outputs.objectBuckets.tenant_builds)],
    ['"takos-tenant-source"', quote(outputs.objectBuckets.tenant_source)],
    ['"takos-git-objects"', quote(outputs.objectBuckets.git_objects)],
    ['"takos-offload"', quote(outputs.objectBuckets.offload)],
    ['"takos-runs"', quote(outputs.queues.runs)],
    ['"takos-runs-dlq"', quote(outputs.queues.runs_dlq)],
    ['"takos-index-jobs"', quote(outputs.queues.index_jobs)],
    ['"takos-index-jobs-dlq"', quote(outputs.queues.index_jobs_dlq)],
    ['"takos-notification-push"', quote(outputs.queues.notification_push)],
    [
      '"takos-notification-push-dlq"',
      quote(outputs.queues.notification_push_dlq),
    ],
    ['"takos-embeddings"', quote(outputs.vectorIndex.name)],
    ['"../../containers/agent/Dockerfile"', quote(containerImage)],
  ]);
  if (!workersDev) replacements.set("workers_dev = true", "workers_dev = false");
  if (input.workerBundle) {
    // A production deploy uploads the published archive's own bytes rather
    // than rebuilding from the worktree, so the entry module and the asset
    // directory move to the extracted release and Wrangler is told not to
    // bundle them again.
    replacements.set(
      'main = "../../src/worker/cloudflare-entrypoint.ts"',
      `main = ${quote(input.workerBundle.entrypoint)}\nno_bundle = true`,
    );
    replacements.set(
      'directory = "../../dist"',
      `directory = ${quote(input.workerBundle.assetsDirectory)}`,
    );
  }

  const body = [
    ...baseLines.slice(0, start),
    ...renderedVars,
    ...baseLines.slice(end),
  ]
    .filter((line) => !line.trimStart().startsWith("image_build_context ="))
    // The template carries a commented-out example route. A realized config
    // states its own routes below, and two route stanzas — one real, one
    // commented with a placeholder hostname — is exactly the ambiguity this
    // projection exists to remove.
    .filter((line) => !/^#\s*(?:\[\[routes\]\]|pattern =|custom_domain =)/u.test(line.trim()))
    .join("\n");

  const rendered = [
    "# Generated by scripts/cloudflare-production-config.ts. Do not edit or commit.",
    `# account ${outputs.accountId} / ${outputs.publicUrl}`,
    substituteTokens(body, replacements).replace(/\n+$/u, "\n"),
    ...routes.map(
      (pattern) =>
        `\n[[routes]]\npattern = ${quote(pattern)}\ncustom_domain = true\n`,
    ),
  ].join("\n");

  assertRealized(rendered, outputs, containerImage);

  return {
    text: rendered,
    workerName: outputs.serviceRuntimeName,
    publicUrl: outputs.publicUrl,
    routes,
    workersDev,
    containerImage,
    droppedVars,
    vars,
  };
}

/**
 * Fail closed on anything the projection did not actually resolve. A config
 * that still carries `replace-with-…` deploys a Worker bound to a resource
 * that does not exist, which the account accepts and the product does not.
 */
function assertRealized(
  text: string,
  outputs: ModuleOutputs,
  containerImage: string,
): void {
  // Comments configure nothing, and the template's explanatory prose names the
  // very placeholders this check hunts for. Only settings are inspected.
  const settings = text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  const residue = [
    "replace-with-",
    "your-domain.example",
    "takosumi.example",
    "Dockerfile",
    "image_build_context",
    "[env.",
  ].filter((token) => settings.includes(token));
  if (residue.length > 0) {
    fail(
      `the realized Wrangler configuration still carries unresolved template material: ${residue.join(", ")}`,
    );
  }
  const pinned = text.split(`image = ${quote(containerImage)}`).length - 1;
  if (pinned !== CONTAINER_CLASS_NAMES.length) {
    fail(
      `the realized Wrangler configuration pins ${pinned} container images; ${CONTAINER_CLASS_NAMES.length} classes need one`,
    );
  }
  if (!text.includes(`name = ${quote(outputs.serviceRuntimeName)}`)) {
    fail("the realized Wrangler configuration does not name the module's Worker");
  }
  for (const name of RUNTIME_SECRET_BINDING_NAMES) {
    const assignment = new RegExp(`^\\s*${name}\\s*=`, "mu");
    if (assignment.test(text)) {
      fail(
        `the realized Wrangler configuration assigns ${name}; runtime secrets are supplied with wrangler secret put and never rendered`,
      );
    }
  }
}
