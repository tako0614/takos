/**
 * The Takos production deploy surface for the direct Cloudflare adapter.
 *
 * Takos deploys as two halves. `deploy/opentofu/cloudflare` owns durable
 * infrastructure — D1, KV, R2, Queues, the Worker identity — in whichever
 * account the operator applies it to. `deploy/cloudflare/wrangler.toml` owns the
 * worker artifact: the entry module, ASSETS, container images, Durable Object
 * migrations, routes and binding wiring the Cloudflare OpenTofu provider cannot
 * express. This entrypoint is the second half, plus the two resource classes the
 * provider expresses in neither half:
 *
 *   - the Vectorize index the Worker binds (`wrangler vectorize`), and
 *   - the Container applications that back the three executor tiers.
 *
 * It is the supported replacement for the disposable provider-gap bridge on
 * those two, and it deliberately does not take over D1 schema migration: the
 * Worker applies its own schema at runtime, which is a different class from a
 * code upload and is not this surface's mutation.
 *
 * Obligations, triggers, and lanes come from takos-control
 * `engineering.policy.json` -> `deploy`. Nothing here authorizes a deploy: a
 * green gate, a branch name, or a task ledger entry does not.
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import {
  CONTAINER_CLASS_NAMES,
  PRODUCT_VECTOR_INDEX,
  REALIZED_CONFIG_PATH,
  RUNTIME_SECRET_BINDING_NAMES,
  WRANGLER_TEMPLATE_PATH,
  assertPinnedContainerImage,
  parseModuleOutputs,
  renderWranglerConfig,
  type ModuleOutputs,
  type Projection,
} from "./cloudflare-production-config.ts";
import {
  parseCanonicalWorkerArtifactDescriptor,
  type WorkerArtifactDescriptor,
} from "./release-artifact-deploy.ts";
import {
  defaultCloudflareApi,
  digestBytes,
  runFirstInstallAbsenceProof,
  runFirstInstallRuntimeSecrets,
  TAKOS_FIRST_INSTALL_OWNER_CONTRACT,
  type CloudflareApiRequest,
  type CloudflareApiResponse,
} from "./cloudflare-first-install.ts";
import { readOwnerPrivateFile } from "./owner-private-input.ts";

export {
  TAKOS_FIRST_INSTALL_OWNER_CONTRACT,
  type CloudflareApiRequest,
  type CloudflareApiResponse,
} from "./cloudflare-first-install.ts";

const COMMIT = /^[0-9a-f]{40}$/u;
const VERSION_ID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/u;
const MISSING_WORKER =
  /script_not_found|not_found|could not find|does not exist|no deployments|10007|10090/iu;
const MISSING_INDEX = /not.?found|does not exist|1002|4003|404/iu;
const MAX_WORKER_ARCHIVE_BYTES = 64 * 1024 * 1024;

/** Durable Object classes the worker artifact declares. */
const DURABLE_OBJECT_CLASS_NAMES = [
  "SessionDO",
  "RunNotifierDO",
  "NotificationNotifierDO",
  "RateLimiterDO",
  "RoutingDO",
  ...CONTAINER_CLASS_NAMES,
] as const;

export const TAKOS_CLOUDFLARE_PRODUCTION_SURFACE = {
  surface: "takos-cloudflare-production",
  target: "cloudflare-worker:takos",
  covers: [
    "deploy/cloudflare/wrangler.toml",
    "deploy/product-resources.json",
    "deploy/opentofu/cloudflare/outputs.tf",
    "scripts/cloudflare-production-deploy.ts",
    "scripts/cloudflare-production-config.ts",
  ],
  requiresScripts: ["check", "deploy", "build"],
  requiresTools: ["bun", "bunx", "git", "tar", "wrangler"],
  requiresEnv: ["CLOUDFLARE_API_TOKEN"],
  // The upload carries the Durable Object migration chain, so a first deploy or
  // a class change rewrites topology; the Container application it activates is
  // pinned to an image digest minted by the release surface.
  // `--runtime-secrets-install` is a separate fixed authority phase: values
  // arrive only from owner-private files and are only ever read back by name.
  triggers: ["authority", "irreversible", "published-identity"],
  obligations: {
    provenance:
      "--apply --environment=production refuses a dirty worktree, requires clean main or an exact --commit equal to HEAD, and deploys the published release artifact of that commit: the takos.worker-artifact@v3 descriptor is parsed in its canonical form, its archive is downloaded from the release URL and accepted only when the exact size and SHA-256 match the record, and the record's commit must equal the deploying commit. integration and rehearsal may build from the worktree instead. The realized Wrangler configuration is rendered from the OpenTofu module's non-secret Outputs rather than hand-copied, and its SHA-256 is printed with the commit, the release tag, the archive digest, and the pinned container image digest. Legacy apply/status reads CLOUDFLARE_API_TOKEN from the environment. First-install authority phases reject ambient credential selection: the token comes only from a canonical owner-owned 0600 file, target account/name come from the digest-bound non-secret OpenTofu output artifact, secret values come only from the exact owner-owned 0700 five-file closure, and none is written, recorded, or echoed.",
    "post-conditions":
      "After the upload the entrypoint reads the newly served Worker version id back from the account, requires it to differ from the version captured before the mutation, and reads that immutable version's binding closure to prove it binds the exact D1 database id, KV namespace id, five R2 bucket names, three queue names, Vectorize index name and all eight Durable Object classes the module named. It re-reads the Worker's secret names to prove the five runtime secrets survived the upload, requires a Container application carrying the pinned image digest for each of the three executor classes, and finally exercises the public URL as a user does: production requires /health to answer 200 and the authenticated API boundary /api/auth/me to answer 401; integration and rehearsal require the /health smoke only. Runtime-secret installation performs authoritative secret-name readback after every one of the five stdin uploads and emits no value. Absence proof reports absent, present, or indeterminate for the full retained Worker, version, route/domain/workers.dev, D1, KV, five R2, six Queue, Vectorize, and three Container application closure.",
    reversal:
      "The served Worker version id is read and printed before any mutation, together with the exact `wrangler versions deploy <id>@100%` command that restores it through Cloudflare's own version history. Worker rollback reverses nothing else: a Durable Object migration and a created Vectorize index are forward-only, so --apply refuses a pending Durable Object migration unless --allow-durable-object-migration records that the operator accepts an irreversible topology change, and this surface never deletes a Vectorize index or a Container application. Secret replacement cannot reconstruct overwritten values; forward repair is another explicit installation from the owner-retained exact files after authoritative name readback, never an automatic retry. Absence proof never deletes directly and follows the owning OpenTofu destroy.",
    "failure-handling":
      "Every mutation phase is read-only until --execute is passed, --status refuses to issue a mutating command, and --absence-proof performs fixed GETs only. Artifact-deploy failures carry the provider's stdout and stderr and name which side of mutation they fell on; runtime-secret installation emits only bounded value-free attempt acknowledgements and never raw provider output because it may reflect stdin. Exit 2 means nothing was touched, exit 3 means a write may have landed and authoritative readback cannot prove the intended new value, and exit 4 means bytes are published but a post-condition failed. There is no retry. A missing CLOUDFLARE_API_TOKEN on the legacy apply/status lane, an invalid owner-private token file on first-install lanes, absent runtime secrets, an unpinned container image, a missing Vectorize index, a pending Durable Object migration, and an unresolved configuration placeholder are refusals before the account is touched.",
    "pre-mutation-proof":
      "Before the ordinary Worker writer runs, the exact realized configuration for the target account is compiled by one strict `wrangler deploy --dry-run`, and the live account is inspected read-only: the served Worker version, its binding closure, the Durable Object classes it already carries, the Vectorize index shape, the Container applications, and — by name only, never by value — the runtime secrets present on the Worker. The separate runtime-secret writer first proves its retained output digest, fixed output-derived target, exact five-name closure, canonical paths, current-user ownership, 0700 directory, 0600 single-link regular files, link-free 0600 token file, and initial authoritative secret-name readback. Production Worker upload additionally reuses the exact-commit gate attestation the release artifact publication already earned at that commit, and runs `bun run check` once when the deploy is not bound to such a release.",
    "independent-review":
      "The Durable Object migration chain and the Container application activation are topology this surface cannot undo, so --allow-durable-object-migration requires a reviewer who did not author the change to have read the pending migration list --status prints against deploy/cloudflare/wrangler.toml's [[migrations]] tags. A routine code upload with no pending migration carries no review requirement, which is the policy's routine lane.",
    "no-overwrite":
      "The container image is a digest-pinned reference minted by the release artifact surface; this surface only resolves and binds it and can neither build nor retag it, so a changed agent byte is a new digest and a new release. The Worker version Cloudflare mints per upload is a routine code version, not an identity consumers pin. Publication is refused outright when the release descriptor's commit, archive digest, or image digest disagrees with what is being deployed.",
  },
} as const;

export type Environment = "integration" | "rehearsal" | "production";
export type Phase =
  | "status"
  | "vectorize"
  | "apply"
  | "containers"
  | "runtime-secrets-install"
  | "absence-proof";

export type CloudflareProductionOptions = Readonly<{
  phase: Phase;
  environment: Environment;
  outputs: string;
  release?: string;
  containerImage?: string;
  commit?: string;
  sourceCommit?: string;
  outputDigest?: string;
  operationId?: string;
  runtimeSecretDirectory?: string;
  cloudflareApiTokenFile?: string;
  execute: boolean;
  allowDurableObjectMigration: boolean;
  root: string;
  realizedConfig: string;
}>;

export type CommandRequest = Readonly<{
  command: string;
  args: readonly string[];
  cwd?: string;
  stdinFile?: string;
  cloudflareApiTokenFile?: string;
  cloudflareAccountId?: string;
}>;

export type CommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type FetchOptions = Readonly<{ redirect: "follow" | "manual" }>;

export type SurfaceRuntime = Readonly<{
  run: (request: CommandRequest) => Promise<CommandResult>;
  fetch: (url: string, options: FetchOptions) => Promise<Response>;
  cloudflareApi?: (
    request: CloudflareApiRequest,
  ) => Promise<CloudflareApiResponse>;
}>;

type FailureStage = "refused" | "indeterminate" | "post-conditions";

const EXIT_CODES: Readonly<Record<FailureStage, number>> = {
  refused: 2,
  indeterminate: 3,
  "post-conditions": 4,
};

export class ProductionDeployError extends Error {
  readonly stage: FailureStage;
  readonly exitCode: number;
  readonly detail: string | undefined;

  constructor(stage: FailureStage, message: string, detail?: string) {
    super(message);
    this.name = "ProductionDeployError";
    this.stage = stage;
    this.exitCode = EXIT_CODES[stage];
    this.detail = detail;
  }
}

function refuse(message: string, detail?: string): never {
  throw new ProductionDeployError("refused", message, detail);
}

export const CLOUDFLARE_PRODUCTION_USAGE = `Usage:
  bun run deploy -- takos-cloudflare-production --status --environment <integration|rehearsal|production> --outputs <absolute.json> (--release <absolute.json> | --container-image <ref>)
  bun run deploy -- takos-cloudflare-production --vectorize --environment <env> --outputs <absolute.json> [--execute]
  bun run deploy -- takos-cloudflare-production --apply --environment <env> --outputs <absolute.json> (--release <absolute.json> | --container-image <ref>) [--commit <sha>] [--allow-durable-object-migration] [--execute]
  bun run deploy -- takos-cloudflare-production --containers --environment <env> --outputs <absolute.json> (--release <absolute.json> | --container-image <ref>)
  bun run deploy -- takos-cloudflare-production --runtime-secrets-install --environment <env> --outputs <absolute.json> --output-digest <sha256:...> --source-commit <sha> --operation-id <id> --runtime-secret-directory <absolute 0700 dir> --cloudflare-api-token-file <absolute 0600 file> [--execute]
  bun run deploy -- takos-cloudflare-production --absence-proof --environment <env> --outputs <absolute retained.json> --output-digest <sha256:...> --source-commit <sha> --operation-id <id> --cloudflare-api-token-file <absolute 0600 file>

--outputs is \`tofu output -json\` from deploy/opentofu/cloudflare, or the same
non-secret values exported by hand. --release is the published
takos.worker-artifact@v3 descriptor; production requires it. Nothing mutates the
account without --execute.`;

const PHASES: Readonly<Record<string, Phase | undefined>> = {
  "--status": "status",
  "--vectorize": "vectorize",
  "--apply": "apply",
  "--containers": "containers",
  "--runtime-secrets-install": "runtime-secrets-install",
  "--absence-proof": "absence-proof",
};

const ENVIRONMENTS: readonly Environment[] = [
  "integration",
  "rehearsal",
  "production",
];

export function parseCloudflareProductionArgs(
  args: readonly string[],
  root: string = process.cwd(),
): CloudflareProductionOptions {
  let phase: Phase | undefined;
  let environment: Environment | undefined;
  let outputs: string | undefined;
  let release: string | undefined;
  let containerImage: string | undefined;
  let commit: string | undefined;
  let sourceCommit: string | undefined;
  let outputDigest: string | undefined;
  let operationId: string | undefined;
  let runtimeSecretDirectory: string | undefined;
  let cloudflareApiTokenFile: string | undefined;
  let realizedConfig: string | undefined;
  let execute = false;
  let allowDurableObjectMigration = false;
  const seenValueArguments = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const selected = PHASES[argument];
    if (selected) {
      if (phase) {
        refuse(`only one phase may be selected, got ${phase} and ${selected}`);
      }
      phase = selected;
      continue;
    }
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    if (argument === "--allow-durable-object-migration") {
      allowDurableObjectMigration = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      refuse(`${argument} requires a value`);
    }
    if (seenValueArguments.has(argument)) {
      refuse(`${argument} may be specified only once`);
    }
    seenValueArguments.add(argument);
    index += 1;
    switch (argument) {
      case "--environment": {
        if (!(ENVIRONMENTS as readonly string[]).includes(value)) {
          refuse(`--environment must be one of ${ENVIRONMENTS.join(", ")}`);
        }
        environment = value as Environment;
        break;
      }
      case "--outputs":
        outputs = value;
        break;
      case "--release":
        release = value;
        break;
      case "--container-image":
        containerImage = value;
        break;
      case "--commit":
        commit = value;
        break;
      case "--source-commit":
        sourceCommit = value;
        break;
      case "--output-digest":
        outputDigest = value;
        break;
      case "--operation-id":
        operationId = value;
        break;
      case "--runtime-secret-directory":
        runtimeSecretDirectory = value;
        break;
      case "--cloudflare-api-token-file":
        cloudflareApiTokenFile = value;
        break;
      case "--realized-config":
        realizedConfig = value;
        break;
      default:
        refuse(`unknown argument ${argument}`);
    }
  }

  if (!phase) refuse("a phase is required");
  if (!environment) refuse("--environment is required");
  if (!outputs) refuse("--outputs is required");
  for (const [name, path] of [
    ["--outputs", outputs],
    ["--release", release],
    ["--realized-config", realizedConfig],
    ["--runtime-secret-directory", runtimeSecretDirectory],
    ["--cloudflare-api-token-file", cloudflareApiTokenFile],
  ] as const) {
    if (path !== undefined && !isAbsolute(path)) {
      refuse(`${name} must be an absolute path`);
    }
  }
  if (
    (phase === "status" || phase === "apply" || phase === "containers") &&
    !release &&
    !containerImage
  ) {
    refuse(
      "the container image digest is a required input: pass --release <descriptor.json> or --container-image <ref@sha256:...>",
    );
  }
  if (phase === "apply" && environment === "production" && !release) {
    refuse(
      "--environment=production deploys the published release artifact of the exact commit; --release <descriptor.json> is required",
    );
  }
  if (commit !== undefined && !COMMIT.test(commit)) {
    refuse("--commit must be a full 40-character commit id");
  }
  if (phase === "runtime-secrets-install" || phase === "absence-proof") {
    if (!sourceCommit) refuse("--source-commit is required for first-install phases");
    if (!outputDigest) refuse("--output-digest is required for first-install phases");
    if (!operationId) refuse("--operation-id is required for first-install phases");
    if (!cloudflareApiTokenFile) {
      refuse("--cloudflare-api-token-file is required for first-install phases");
    }
    if (phase === "runtime-secrets-install" && !runtimeSecretDirectory) {
      refuse("--runtime-secret-directory is required for --runtime-secrets-install");
    }
    if (phase === "absence-proof" && execute) {
      refuse("--absence-proof is read-only and does not accept --execute");
    }
    if (release || containerImage || commit || realizedConfig) {
      refuse("first-install phases reject release, image, commit, and realized-config inputs");
    }
    if (allowDurableObjectMigration) {
      refuse("first-install phases reject Durable Object migration authority");
    }
    if (phase === "absence-proof" && runtimeSecretDirectory) {
      refuse("--absence-proof does not accept a runtime-secret directory");
    }
  }

  return {
    phase,
    environment,
    outputs,
    ...(release === undefined ? {} : { release }),
    ...(containerImage === undefined ? {} : { containerImage }),
    ...(commit === undefined ? {} : { commit }),
    ...(sourceCommit === undefined ? {} : { sourceCommit }),
    ...(outputDigest === undefined ? {} : { outputDigest }),
    ...(operationId === undefined ? {} : { operationId }),
    ...(runtimeSecretDirectory === undefined
      ? {}
      : { runtimeSecretDirectory }),
    ...(cloudflareApiTokenFile === undefined
      ? {}
      : { cloudflareApiTokenFile }),
    execute,
    allowDurableObjectMigration,
    root,
    realizedConfig: realizedConfig ?? join(root, REALIZED_CONFIG_PATH),
  };
}

/**
 * Does this command change the target account?
 *
 * The classification is an allowlist, so an unrecognized command counts as a
 * mutation. Every command a phase issues passes through it, which is what makes
 * "--status never mutates" a property of the code rather than a claim in a
 * document.
 */
export function mutatesTarget(request: CommandRequest): boolean {
  const wrangler = wranglerSubcommand(request);
  if (wrangler) {
    const readOnly = [
      ["deployments", "status"],
      ["deployments", "list"],
      ["versions", "view"],
      ["versions", "list"],
      ["secret", "list"],
      ["vectorize", "get"],
      ["vectorize", "list"],
      ["containers", "list"],
      ["containers", "info"],
    ];
    if (
      readOnly.some(
        (prefix) => prefix[0] === wrangler[0] && prefix[1] === wrangler[1],
      )
    ) {
      return false;
    }
    // A dry run compiles the realized configuration and uploads nothing.
    if (wrangler[0] === "deploy" && wrangler.includes("--dry-run")) return false;
    return true;
  }
  if (request.command === "git") {
    return !["rev-parse", "status", "log", "show", "ls-files"].includes(
      request.args[0] ?? "",
    );
  }
  // Local-only work: extracting the release archive and running the owner gate
  // touch this machine, never the account.
  if (request.command === "tar") return false;
  if (request.command === "bun" && request.args[0] === "run") return false;
  return true;
}

function wranglerSubcommand(request: CommandRequest): readonly string[] | null {
  if (request.command === "wrangler") return request.args;
  if (request.command === "bunx" && request.args[0] === "wrangler") {
    return request.args.slice(1);
  }
  return null;
}

const defaultRuntime: SurfaceRuntime = {
  async run(request) {
    const env: Record<string, string | undefined> = {
      ...process.env,
      WRANGLER_SEND_METRICS: "false",
    };
    const repositoryRoot = request.cwd ?? process.cwd();
    let stdinContents: string | null = null;
    if (request.cloudflareApiTokenFile) {
      // First-install credentials are file-reference only. Do not let an
      // ambient token silently select another account, and never put the token
      // in argv or the recorded command request.
      for (const name of [
        "CF_API_EMAIL",
        "CF_API_KEY",
        "CF_API_TOKEN",
        "CF_ACCOUNT_ID",
        "CF_API_BASE_URL",
        "CLOUDFLARE_API_EMAIL",
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_API_USER_SERVICE_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_BASE_URL",
        "CLOUDFLARE_BASE_URL",
        "CLOUDFLARE_COMPLIANCE_REGION",
        "CLOUDFLARE_EMAIL",
        "WRANGLER_API_ENVIRONMENT",
      ]) {
        delete env[name];
      }
      env.CLOUDFLARE_API_TOKEN = (await readOwnerPrivateFile(
        request.cloudflareApiTokenFile,
        { repositoryRoot, maxBytes: 8 * 1024 },
      )).trim();
      if (request.cloudflareAccountId) {
        env.CLOUDFLARE_ACCOUNT_ID = request.cloudflareAccountId;
      }
    }
    if (request.stdinFile) {
      stdinContents = await readOwnerPrivateFile(request.stdinFile, {
        repositoryRoot,
        maxBytes: 256 * 1024,
      });
    }
    const child = Bun.spawn([request.command, ...request.args], {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      env,
      stdin: stdinContents === null ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (stdinContents !== null && child.stdin) {
      child.stdin.write(stdinContents);
      child.stdin.end();
    }
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr };
  },
  fetch: (url, options) =>
    fetch(url, {
      redirect: options.redirect,
      signal: AbortSignal.timeout(120_000),
    }),
  cloudflareApi: (request) => defaultCloudflareApi(request, process.cwd()),
};

type Context = {
  readonly options: CloudflareProductionOptions;
  readonly runtime: SurfaceRuntime;
  readonly outputs: ModuleOutputs;
  readonly issued: CommandRequest[];
  template?: string;
};

async function invoke(
  context: Context,
  request: CommandRequest,
): Promise<CommandResult> {
  if (mutatesTarget(request)) {
    if (context.options.phase === "status") {
      refuse(
        `--status refuses to run ${request.command} ${request.args.join(" ")}: it would mutate the target`,
      );
    }
    if (!context.options.execute) {
      refuse(
        `${request.command} ${request.args.join(" ")} mutates the target and --execute was not passed`,
      );
    }
  }
  context.issued.push(request);
  return await context.runtime.run(request);
}

function wrangler(args: readonly string[]): CommandRequest {
  return { command: "bunx", args: ["wrangler", ...args] };
}

function digestOf(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseJson(raw: string, label: string): unknown {
  const object = raw.indexOf("{");
  const array = raw.indexOf("[");
  const from =
    object === -1 ? array : array === -1 ? object : Math.min(object, array);
  if (from === -1) refuse(`${label} printed no JSON`, raw.trim());
  try {
    return JSON.parse(raw.slice(from)) as unknown;
  } catch {
    return refuse(`${label} printed unparsable JSON`, raw.trim());
  }
}

async function templateText(context: Context): Promise<string> {
  if (context.template === undefined) {
    context.template = await readFile(
      join(context.options.root, WRANGLER_TEMPLATE_PATH),
      "utf8",
    );
  }
  return context.template;
}

/* ------------------------------------------------------------------ reads */

async function servedVersionId(context: Context): Promise<string | null> {
  const result = await invoke(
    context,
    wrangler([
      "deployments",
      "status",
      "--config",
      context.options.realizedConfig,
    ]),
  );
  const output = `${result.stdout}${result.stderr}`;
  if (result.exitCode !== 0) {
    if (MISSING_WORKER.test(output)) return null;
    refuse("wrangler deployments status failed", output.trim());
  }
  return VERSION_ID.exec(output)?.[0] ?? null;
}

async function versionDetail(
  context: Context,
  versionId: string,
): Promise<unknown> {
  const result = await invoke(
    context,
    wrangler([
      "versions",
      "view",
      versionId,
      "--config",
      context.options.realizedConfig,
      "--json",
    ]),
  );
  if (result.exitCode !== 0) {
    refuse(
      `wrangler versions view ${versionId} failed`,
      `${result.stdout}${result.stderr}`.trim(),
    );
  }
  return parseJson(result.stdout, "wrangler versions view");
}

async function secretNames(context: Context): Promise<readonly string[] | null> {
  const result = await invoke(
    context,
    wrangler([
      "secret",
      "list",
      "--config",
      context.options.realizedConfig,
      "--format",
      "json",
    ]),
  );
  if (result.exitCode !== 0) {
    if (MISSING_WORKER.test(`${result.stdout}${result.stderr}`)) return null;
    refuse(
      "wrangler secret list failed",
      `${result.stdout}${result.stderr}`.trim(),
    );
  }
  const parsed = parseJson(result.stdout, "wrangler secret list");
  const rows = Array.isArray(parsed) ? parsed : [];
  return rows
    .map((row) =>
      typeof row === "object" && row !== null && "name" in row
        ? String((row as { name: unknown }).name)
        : "",
    )
    .filter((name) => name.length > 0);
}

type VectorIndexState = Readonly<{
  present: boolean;
  dimensions: number | null;
  metric: string | null;
}>;

async function vectorIndexState(context: Context): Promise<VectorIndexState> {
  const result = await invoke(
    context,
    wrangler(["vectorize", "get", context.outputs.vectorIndex.name, "--json"]),
  );
  const output = `${result.stdout}${result.stderr}`;
  if (result.exitCode !== 0) {
    if (MISSING_INDEX.test(output)) {
      return { present: false, dimensions: null, metric: null };
    }
    refuse("wrangler vectorize get failed", output.trim());
  }
  const parsed = parseJson(result.stdout, "wrangler vectorize get");
  const record =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const config =
    typeof record.config === "object" && record.config !== null
      ? (record.config as Record<string, unknown>)
      : record;
  const dimensions = Number(config.dimensions);
  return {
    present: true,
    dimensions: Number.isFinite(dimensions) ? dimensions : null,
    metric: typeof config.metric === "string" ? config.metric : null,
  };
}

type ContainerApplication = Readonly<{ name: string; image: string }>;

function containerRows(parsed: unknown, raw: string): readonly unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object" && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    for (const key of ["result", "applications", "data", "containers"]) {
      if (Array.isArray(record[key])) return record[key] as readonly unknown[];
    }
  }
  return refuse(
    "wrangler containers list returned no application array",
    raw.trim(),
  );
}

async function containerApplications(
  context: Context,
): Promise<readonly ContainerApplication[]> {
  const result = await invoke(
    context,
    wrangler(["containers", "list", "--json"]),
  );
  if (result.exitCode !== 0) {
    refuse(
      "wrangler containers list failed",
      `${result.stdout}${result.stderr}`.trim(),
    );
  }
  const parsed = parseJson(result.stdout, "wrangler containers list");
  return containerRows(parsed, result.stdout).map((row) => {
    const record =
      typeof row === "object" && row !== null
        ? (row as Record<string, unknown>)
        : {};
    const configuration =
      typeof record.configuration === "object" && record.configuration !== null
        ? (record.configuration as Record<string, unknown>)
        : {};
    return {
      name: typeof record.name === "string" ? record.name : "",
      image:
        typeof configuration.image === "string"
          ? configuration.image
          : typeof record.image === "string"
            ? record.image
            : "",
    };
  });
}

async function probePublicUrl(
  context: Context,
  path: string,
): Promise<{ path: string; status: number | null; error?: string }> {
  try {
    const response = await context.runtime.fetch(
      `${context.outputs.publicUrl}${path}`,
      { redirect: "manual" },
    );
    return { path, status: response.status };
  } catch (error) {
    return {
      path,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ------------------------------------------------------- desired artifacts */

export function latestMigrationTag(template: string): string {
  const tags = [...template.matchAll(/^\s*tag\s*=\s*"([^"]+)"/gmu)].map(
    (match) => match[1],
  );
  if (tags.length === 0) {
    refuse("deploy/cloudflare/wrangler.toml declares no [[migrations]] tag");
  }
  return tags[tags.length - 1];
}

/**
 * Durable Object work an upload would perform. A first upload creates every
 * namespace and a new class advances the chain; both rewrite topology and
 * neither is undone by rolling the Worker version back, so the routine code
 * lane refuses them and the operator opts in explicitly.
 */
export function pendingDurableObjectWork(
  servedVersion: unknown,
  desiredTag: string,
): readonly string[] {
  if (servedVersion === null) {
    return ["worker-absent: the whole Durable Object migration chain"];
  }
  const serialized = JSON.stringify(servedVersion);
  const pending = DURABLE_OBJECT_CLASS_NAMES.filter(
    (className) => !serialized.includes(`"${className}"`),
  ).map((className) => `class ${className} is not bound by the served version`);
  const liveTag = /"migration_?[Tt]ag"\s*:\s*"([^"]+)"/u.exec(serialized)?.[1];
  if (liveTag !== undefined && liveTag !== desiredTag) {
    pending.push(`migration tag ${liveTag} -> ${desiredTag}`);
  }
  return pending;
}

type ReleaseBinding = Readonly<{
  descriptor: WorkerArtifactDescriptor | null;
  containerImage: string;
  bundle: { entrypoint: string; assetsDirectory: string } | null;
  archiveDigest: string | null;
  temporaryRoot: string | null;
}>;

async function readReleaseDescriptor(
  path: string,
): Promise<WorkerArtifactDescriptor> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch (error) {
    return refuse(
      `the release descriptor ${path} could not be read`,
      error instanceof Error ? error.message : String(error),
    );
  }
  try {
    return parseCanonicalWorkerArtifactDescriptor(bytes);
  } catch (error) {
    return refuse(
      `the release descriptor ${path} is not a canonical takos.worker-artifact@v3 record`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Bind the deploy to a published release: download the exact archive the record
 * names, prove its size and digest, and unpack the Worker module and assets the
 * upload will carry. What production runs is then the bytes that were published
 * for that commit, not a rebuild that happens to come from it.
 */
async function bindPublishedRelease(
  context: Context,
  descriptor: WorkerArtifactDescriptor,
): Promise<{
  bundle: { entrypoint: string; assetsDirectory: string };
  digest: string;
  root: string;
}> {
  const response = await context.runtime.fetch(descriptor.artifact.url, {
    redirect: "follow",
  });
  if (!response.ok) {
    refuse(
      `the published Worker archive ${descriptor.artifact.url} answered ${response.status}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== descriptor.artifact.size) {
    refuse(
      `the published Worker archive is ${bytes.byteLength} bytes; the release record says ${descriptor.artifact.size}`,
    );
  }
  if (bytes.byteLength > MAX_WORKER_ARCHIVE_BYTES) {
    refuse("the published Worker archive exceeds the release size bound");
  }
  const digest = digestOf(bytes);
  if (digest !== descriptor.artifact.sha256Prefixed) {
    refuse(
      `the published Worker archive digest ${digest} does not match the release record ${descriptor.artifact.sha256Prefixed}`,
    );
  }
  const root = await mkdtemp(join(tmpdir(), "takos-production-release-"));
  const archive = join(root, descriptor.artifact.filename);
  await writeFile(archive, bytes, { mode: 0o600 });
  const extracted = await invoke(context, {
    command: "tar",
    args: [
      "--extract",
      "--gzip",
      "--file",
      archive,
      "--directory",
      root,
      "--no-same-owner",
      "--no-same-permissions",
    ],
  });
  if (extracted.exitCode !== 0) {
    refuse(
      "the published Worker archive could not be extracted",
      `${extracted.stdout}${extracted.stderr}`.trim(),
    );
  }
  const entrypoint = join(root, "worker/index.js");
  const assetsDirectory = join(root, "assets");
  for (const path of [entrypoint, join(root, "asset-manifest.json")]) {
    try {
      await readFile(path);
    } catch {
      refuse(`the published Worker archive does not contain ${path}`);
    }
  }
  return { bundle: { entrypoint, assetsDirectory }, digest, root };
}

async function resolveRelease(context: Context): Promise<ReleaseBinding> {
  const { options } = context;
  if (!options.release) {
    if (!options.containerImage) {
      refuse("--release or --container-image is required for this phase");
    }
    assertPinnedContainerImage(options.containerImage, context.outputs.accountId);
    return {
      descriptor: null,
      containerImage: options.containerImage,
      bundle: null,
      archiveDigest: null,
      temporaryRoot: null,
    };
  }
  const descriptor = await readReleaseDescriptor(options.release);
  const image = options.containerImage ?? descriptor.containerImages.executor;
  if (!image) {
    refuse(
      `the release descriptor ${options.release} records no containerImages.executor, so no pinned agent image is available`,
    );
  }
  assertPinnedContainerImage(image, context.outputs.accountId);
  if (options.phase !== "apply" || options.environment !== "production") {
    return {
      descriptor,
      containerImage: image,
      bundle: null,
      archiveDigest: null,
      temporaryRoot: null,
    };
  }
  const bound = await bindPublishedRelease(context, descriptor);
  return {
    descriptor,
    containerImage: image,
    bundle: bound.bundle,
    archiveDigest: bound.digest,
    temporaryRoot: bound.root,
  };
}

async function renderRealizedConfig(
  context: Context,
  containerImage: string,
  bundle: { entrypoint: string; assetsDirectory: string } | null,
): Promise<Projection> {
  let projection: Projection;
  try {
    projection = renderWranglerConfig({
      template: await templateText(context),
      outputs: context.outputs,
      containerImage,
      ...(bundle ? { workerBundle: bundle } : {}),
    });
  } catch (error) {
    return refuse(
      "the realized Wrangler configuration could not be rendered from the module outputs",
      error instanceof Error ? error.message : String(error),
    );
  }
  await writeFile(context.options.realizedConfig, projection.text, {
    mode: 0o600,
  });
  return projection;
}

/* ----------------------------------------------------------------- phases */

async function loadOutputs(path: string): Promise<{
  outputs: ModuleOutputs;
  bytes: Uint8Array;
}> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch (error) {
    return refuse(
      `the module outputs file ${path} could not be read; run \`tofu output -json\` in deploy/opentofu/cloudflare first`,
      error instanceof Error ? error.message : String(error),
    );
  }
  try {
    return {
      outputs: parseModuleOutputs(
        JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      ),
      bytes,
    };
  } catch (error) {
    return refuse(
      `the module outputs file ${path} is not usable`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function statusPhase(context: Context): Promise<Record<string, unknown>> {
  const release = await resolveRelease(context);
  const projection = await renderRealizedConfig(
    context,
    release.containerImage,
    null,
  );
  const desiredTag = latestMigrationTag(await templateText(context));

  const served = await servedVersionId(context);
  const detail = served === null ? null : await versionDetail(context, served);
  const secrets = await secretNames(context);
  const vector = await vectorIndexState(context);
  const containers = await containerApplications(context);
  const pending = pendingDurableObjectWork(detail, desiredTag);
  const health = await probePublicUrl(context, "/health");

  const missingSecrets = RUNTIME_SECRET_BINDING_NAMES.filter(
    (name) => !(secrets ?? []).includes(name),
  );
  const pinnedContainers = containers.filter(
    (application) => application.image === release.containerImage,
  );

  const drift: string[] = [];
  if (!context.outputs.runtimeSecretsProvisioned) {
    drift.push(
      "module output runtime_secrets_provisioned is false: the Worker answers 503 on every path but /health",
    );
  }
  if (missingSecrets.length > 0) {
    drift.push(
      `runtime secrets absent on the Worker: ${missingSecrets.join(", ")}`,
    );
  }
  if (!vector.present) {
    drift.push(
      `Vectorize index ${context.outputs.vectorIndex.name} does not exist; run --vectorize --execute`,
    );
  } else if (
    vector.dimensions !== PRODUCT_VECTOR_INDEX.dimensions ||
    vector.metric !== PRODUCT_VECTOR_INDEX.metric
  ) {
    drift.push(
      `Vectorize index ${context.outputs.vectorIndex.name} is ${vector.dimensions}/${vector.metric}, not ${PRODUCT_VECTOR_INDEX.dimensions}/${PRODUCT_VECTOR_INDEX.metric}`,
    );
  }
  if (pinnedContainers.length < CONTAINER_CLASS_NAMES.length) {
    drift.push(
      `${pinnedContainers.length} of ${CONTAINER_CLASS_NAMES.length} Container applications carry ${release.containerImage}`,
    );
  }
  drift.push(...pending);
  if (
    context.outputs.moduleWorkerVersionId !== null &&
    served !== null &&
    context.outputs.moduleWorkerVersionId !== served
  ) {
    drift.push(
      `the OpenTofu module recorded Worker version ${context.outputs.moduleWorkerVersionId}; the account serves ${served}. A later \`tofu apply\` re-uploads the module's own version.`,
    );
  }
  if (projection.droppedVars.length > 0) {
    drift.push(
      `template variables the module supplies no value for: ${projection.droppedVars.join(", ")}`,
    );
  }
  if (health.status !== 200) {
    drift.push(
      `${context.outputs.publicUrl}/health answered ${health.status ?? health.error}`,
    );
  }

  return {
    kind: "takos.cloudflare-production-status@v1",
    environment: context.options.environment,
    account: context.outputs.accountId,
    worker: {
      name: projection.workerName,
      servedVersion: served,
      moduleVersion: context.outputs.moduleWorkerVersionId,
    },
    publicUrl: context.outputs.publicUrl,
    routes: projection.routes,
    workersDev: projection.workersDev,
    realizedConfig: {
      path: context.options.realizedConfig,
      digest: digestOf(projection.text),
    },
    containerImage: release.containerImage,
    containers: containers.map((application) => ({
      name: application.name,
      image: application.image,
      pinned: application.image === release.containerImage,
    })),
    vectorize: { name: context.outputs.vectorIndex.name, ...vector },
    durableObjects: { desiredTag, pending },
    runtimeSecrets: {
      provisioned: context.outputs.runtimeSecretsProvisioned,
      present: secrets,
      missing: missingSecrets,
    },
    publicHealth: health,
    drift,
  };
}

async function vectorizePhase(
  context: Context,
): Promise<Record<string, unknown>> {
  const desired = context.outputs.vectorIndex;
  const current = await vectorIndexState(context);
  if (current.present) {
    if (
      current.dimensions !== PRODUCT_VECTOR_INDEX.dimensions ||
      current.metric !== PRODUCT_VECTOR_INDEX.metric
    ) {
      refuse(
        `Vectorize index ${desired.name} exists with ${current.dimensions}/${current.metric}; the product needs ` +
          `${PRODUCT_VECTOR_INDEX.dimensions}/${PRODUCT_VECTOR_INDEX.metric}. An index cannot be reshaped and this ` +
          "surface never deletes one, so the index identity has to be resolved before deploying.",
      );
    }
    return {
      kind: "takos.cloudflare-production-vectorize@v1",
      environment: context.options.environment,
      index: desired.name,
      outcome: "present",
      dimensions: current.dimensions,
      metric: current.metric,
    };
  }
  if (!context.options.execute) {
    return {
      kind: "takos.cloudflare-production-vectorize@v1",
      environment: context.options.environment,
      index: desired.name,
      outcome: "would-create",
      dimensions: PRODUCT_VECTOR_INDEX.dimensions,
      metric: PRODUCT_VECTOR_INDEX.metric,
    };
  }
  const created = await invoke(
    context,
    wrangler([
      "vectorize",
      "create",
      desired.name,
      `--dimensions=${PRODUCT_VECTOR_INDEX.dimensions}`,
      `--metric=${PRODUCT_VECTOR_INDEX.metric}`,
      "--json",
    ]),
  );
  if (created.exitCode !== 0) {
    throw new ProductionDeployError(
      "indeterminate",
      `wrangler vectorize create ${desired.name} failed (exit ${created.exitCode}); read --status before any retry`,
      `${created.stdout}${created.stderr}`.trim(),
    );
  }
  const readback = await vectorIndexState(context);
  if (
    !readback.present ||
    readback.dimensions !== PRODUCT_VECTOR_INDEX.dimensions ||
    readback.metric !== PRODUCT_VECTOR_INDEX.metric
  ) {
    throw new ProductionDeployError(
      "post-conditions",
      `Vectorize index ${desired.name} did not read back with the product shape after creation`,
    );
  }
  return {
    kind: "takos.cloudflare-production-vectorize@v1",
    environment: context.options.environment,
    index: desired.name,
    outcome: "created",
    dimensions: readback.dimensions,
    metric: readback.metric,
  };
}

async function containersPhase(
  context: Context,
): Promise<Record<string, unknown>> {
  const release = await resolveRelease(context);
  const applications = await containerApplications(context);
  const pinned = applications.filter(
    (application) => application.image === release.containerImage,
  );
  const ready = pinned.length >= CONTAINER_CLASS_NAMES.length;
  return {
    kind: "takos.cloudflare-production-containers@v1",
    environment: context.options.environment,
    image: release.containerImage,
    classes: CONTAINER_CLASS_NAMES,
    ready,
    applications: applications.map((application) => ({
      name: application.name,
      image: application.image,
      pinned: application.image === release.containerImage,
    })),
    ...(ready
      ? {}
      : {
          remediation:
            "deploy/cloudflare/wrangler.toml's [[containers]] blocks are the declarative source; run --apply --execute so the upload reconciles the Container applications with the pinned image digest",
        }),
  };
}

type SourceIdentity = Readonly<{
  commit: string;
  branch: string;
  clean: boolean;
}>;

async function sourceIdentity(context: Context): Promise<SourceIdentity> {
  const read = async (args: readonly string[]) => {
    const result = await invoke(context, {
      command: "git",
      args: [...args],
      cwd: context.options.root,
    });
    if (result.exitCode !== 0) {
      refuse(`git ${args.join(" ")} failed`, result.stderr.trim());
    }
    return result.stdout.trim();
  };
  return {
    commit: await read(["rev-parse", "HEAD"]),
    branch: await read(["rev-parse", "--abbrev-ref", "HEAD"]),
    clean: (await read(["status", "--porcelain"])).length === 0,
  };
}

async function applyPhase(context: Context): Promise<Record<string, unknown>> {
  const { options } = context;
  const source = await sourceIdentity(context);
  if (options.environment === "production") {
    if (!source.clean) {
      refuse(
        "production publishes from one commit and the worktree is not clean; commit or stash first",
      );
    }
    if (source.branch !== "main" && options.commit !== source.commit) {
      refuse(
        `production requires clean main or an exact --commit equal to HEAD; HEAD is ${source.commit} on ${source.branch}`,
      );
    }
  }

  const release = await resolveRelease(context);
  try {
    if (options.environment === "production") {
      if (release.descriptor === null) {
        refuse("--environment=production requires --release");
      }
      if (release.descriptor.commit !== source.commit) {
        refuse(
          `the release descriptor publishes ${release.descriptor.commit} and HEAD is ${source.commit}; deploy the release of the exact commit`,
        );
      }
    }

    const projection = await renderRealizedConfig(
      context,
      release.containerImage,
      release.bundle,
    );
    const desiredTag = latestMigrationTag(await templateText(context));

    if (!context.outputs.runtimeSecretsProvisioned) {
      refuse(
        "module output runtime_secrets_provisioned is false. Supply the five runtime secrets with `wrangler secret put` and re-apply the module with runtime_secrets_provisioned = true (docs/deploy/runtime-secrets.md).",
      );
    }
    const secrets = await secretNames(context);
    if (secrets === null) {
      refuse(
        "the Worker does not exist yet. The OpenTofu module owns the Worker identity; apply deploy/opentofu/cloudflare before this lane.",
      );
    }
    const missing = RUNTIME_SECRET_BINDING_NAMES.filter(
      (name) => !secrets.includes(name),
    );
    if (missing.length > 0) {
      refuse(
        `the Worker is missing runtime secrets ${missing.join(", ")}; supply them with \`wrangler secret put\` before deploying`,
      );
    }

    const vector = await vectorIndexState(context);
    if (
      !vector.present ||
      vector.dimensions !== PRODUCT_VECTOR_INDEX.dimensions ||
      vector.metric !== PRODUCT_VECTOR_INDEX.metric
    ) {
      refuse(
        `the Worker binds Vectorize index ${context.outputs.vectorIndex.name}, which is absent or reshaped; run --vectorize --execute first`,
      );
    }

    const previousVersion = await servedVersionId(context);
    const previousDetail =
      previousVersion === null
        ? null
        : await versionDetail(context, previousVersion);
    const pending = pendingDurableObjectWork(previousDetail, desiredTag);
    if (pending.length > 0 && !options.allowDurableObjectMigration) {
      refuse(
        "this upload would advance the Durable Object migration chain, which is an irreversible topology change rather than the routine code lane. " +
          `Re-run with --allow-durable-object-migration once a reviewer has read the pending list: ${pending.join("; ")}`,
      );
    }

    const rollback =
      previousVersion === null
        ? "no previous Worker version exists; the forward repair is to re-apply deploy/opentofu/cloudflare, which recreates the Worker identity"
        : `bunx wrangler versions deploy ${previousVersion}@100% --config ${options.realizedConfig} --yes`;

    if (release.bundle === null) {
      // integration and rehearsal may build from the worktree; Wrangler bundles
      // the entry module the template names, so the built web assets have to be
      // on disk before the configuration can even be compiled.
      try {
        await readFile(join(options.root, "dist/index.html"));
      } catch {
        refuse(
          "dist/index.html is missing; run `bun run build` before deploying integration or rehearsal from the worktree",
        );
      }
    }
    await proveRealizedConfigCompiles(context);

    const plan = {
      kind: "takos.cloudflare-production-apply@v1",
      environment: options.environment,
      account: context.outputs.accountId,
      worker: projection.workerName,
      commit: source.commit,
      release:
        release.descriptor === null
          ? null
          : {
              tag: release.descriptor.releaseTag,
              archive: release.descriptor.artifact.url,
              archiveDigest: release.archiveDigest,
            },
      containerImage: release.containerImage,
      realizedConfig: {
        path: options.realizedConfig,
        digest: digestOf(projection.text),
      },
      durableObjects: { desiredTag, pending },
      previousVersion,
      rollback,
    };

    if (!options.execute) {
      return { ...plan, outcome: "planned", mutation: "none" };
    }

    await runOwnerGate(context, release, source);

    const upload = await invoke(
      context,
      wrangler([
        "deploy",
        "--config",
        options.realizedConfig,
        ...(release.bundle ? ["--no-bundle"] : []),
      ]),
    );
    if (upload.exitCode !== 0) {
      throw new ProductionDeployError(
        "indeterminate",
        `wrangler deploy failed (exit ${upload.exitCode}); the upload may or may not have landed. Read --status before any retry. Rollback: ${rollback}`,
        `${upload.stdout}${upload.stderr}`.trim(),
      );
    }

    const readback = await verifyPostConditions(context, {
      previousVersion,
      containerImage: release.containerImage,
    });
    return {
      ...plan,
      outcome: "deployed",
      mutation: "wrangler-deploy",
      readback,
    };
  } finally {
    if (release.temporaryRoot) {
      await rm(release.temporaryRoot, { recursive: true, force: true });
    }
  }
}

/** One strict compile of the exact configuration the upload would carry. */
async function proveRealizedConfigCompiles(context: Context): Promise<void> {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "takos-production-dry-run-"),
  );
  try {
    const dryRun = await invoke(
      context,
      wrangler([
        "deploy",
        "--config",
        context.options.realizedConfig,
        "--dry-run",
        "--containers-rollout",
        "none",
        "--outdir",
        outputDirectory,
      ]),
    );
    if (dryRun.exitCode !== 0) {
      refuse(
        "the realized configuration does not compile; nothing was uploaded",
        `${dryRun.stdout}${dryRun.stderr}`.trim(),
      );
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

/**
 * The policy's production gate is "an existing exact-commit scoped attestation
 * or one scoped run". Publishing the release artifact for this exact commit
 * already ran `bun run check` at it, so a production deploy bound to that
 * release reuses that attestation; anything else runs the gate once, here,
 * before the upload.
 */
async function runOwnerGate(
  context: Context,
  release: ReleaseBinding,
  source: SourceIdentity,
): Promise<void> {
  if (
    context.options.environment === "production" &&
    release.descriptor !== null &&
    release.descriptor.commit === source.commit
  ) {
    return;
  }
  const gate = await invoke(context, {
    command: "bun",
    args: ["run", "check"],
    cwd: context.options.root,
  });
  if (gate.exitCode !== 0) {
    refuse(
      "the owner gate `bun run check` failed; nothing was uploaded",
      `${gate.stdout}${gate.stderr}`.trim(),
    );
  }
}

async function verifyPostConditions(
  context: Context,
  input: Readonly<{ previousVersion: string | null; containerImage: string }>,
): Promise<Record<string, unknown>> {
  const served = await servedVersionId(context);
  if (served === null) {
    throw new ProductionDeployError(
      "post-conditions",
      "the account serves no Worker version after the upload",
    );
  }
  if (input.previousVersion !== null && served === input.previousVersion) {
    throw new ProductionDeployError(
      "post-conditions",
      `the account still serves ${served} after the upload; the published bytes are not the served bytes`,
    );
  }
  const serialized = JSON.stringify(await versionDetail(context, served));
  const required = [
    context.outputs.d1.id,
    context.outputs.kvNamespaceIds.hostname_routing,
    ...Object.values(context.outputs.objectBuckets),
    context.outputs.queues.runs,
    context.outputs.queues.index_jobs,
    context.outputs.queues.notification_push,
    context.outputs.vectorIndex.name,
    ...DURABLE_OBJECT_CLASS_NAMES,
  ];
  const absent = required.filter((value) => !serialized.includes(value));
  if (absent.length > 0) {
    throw new ProductionDeployError(
      "post-conditions",
      `served version ${served} does not bind ${absent.join(", ")}`,
    );
  }

  const secrets = (await secretNames(context)) ?? [];
  const lostSecrets = RUNTIME_SECRET_BINDING_NAMES.filter(
    (name) => !secrets.includes(name),
  );
  if (lostSecrets.length > 0) {
    throw new ProductionDeployError(
      "post-conditions",
      `the upload left the Worker without runtime secrets ${lostSecrets.join(", ")}`,
    );
  }

  const applications = await containerApplications(context);
  const pinned = applications.filter(
    (application) => application.image === input.containerImage,
  );
  if (pinned.length < CONTAINER_CLASS_NAMES.length) {
    throw new ProductionDeployError(
      "post-conditions",
      `${pinned.length} of ${CONTAINER_CLASS_NAMES.length} Container applications carry ${input.containerImage}`,
    );
  }

  const health = await probePublicUrl(context, "/health");
  if (health.status !== 200) {
    throw new ProductionDeployError(
      "post-conditions",
      `${context.outputs.publicUrl}/health answered ${health.status ?? health.error}`,
    );
  }
  const boundary =
    context.options.environment === "production"
      ? await probePublicUrl(context, "/api/auth/me")
      : null;
  if (boundary !== null && boundary.status !== 401) {
    throw new ProductionDeployError(
      "post-conditions",
      `${context.outputs.publicUrl}/api/auth/me answered ${boundary.status ?? boundary.error}, not the 401 auth boundary`,
    );
  }

  return {
    servedVersion: served,
    previousVersion: input.previousVersion,
    containerApplications: pinned.length,
    health: health.status,
    ...(boundary === null ? {} : { authBoundary: boundary.status }),
  };
}

async function execute(context: Context): Promise<Record<string, unknown>> {
  switch (context.options.phase) {
    case "status":
      return await statusPhase(context);
    case "vectorize":
      return await vectorizePhase(context);
    case "containers":
      return await containersPhase(context);
    case "apply":
      return await applyPhase(context);
    case "runtime-secrets-install": {
      const options = context.options;
      if (
        !options.sourceCommit ||
        !options.outputDigest ||
        !options.operationId ||
        !options.runtimeSecretDirectory ||
        !options.cloudflareApiTokenFile
      ) {
        refuse("first-install runtime-secret inputs are incomplete");
      }
      return await runFirstInstallRuntimeSecrets(
        {
          environment: options.environment,
          sourceCommit: options.sourceCommit,
          outputDigest: options.outputDigest,
          operationId: options.operationId,
          cloudflareApiTokenFile: options.cloudflareApiTokenFile,
          repositoryRoot: options.root,
          outputs: context.outputs,
          execute: options.execute,
          runtimeSecretDirectory: options.runtimeSecretDirectory,
        },
        (request) => invoke(context, request),
      ) as unknown as Record<string, unknown>;
    }
    case "absence-proof": {
      const options = context.options;
      if (
        !options.sourceCommit ||
        !options.outputDigest ||
        !options.operationId ||
        !options.cloudflareApiTokenFile
      ) {
        refuse("first-install absence inputs are incomplete");
      }
      const api = context.runtime.cloudflareApi ??
        ((request: CloudflareApiRequest) =>
          defaultCloudflareApi(request, options.root));
      return await runFirstInstallAbsenceProof(
        {
          environment: options.environment,
          sourceCommit: options.sourceCommit,
          outputDigest: options.outputDigest,
          operationId: options.operationId,
          cloudflareApiTokenFile: options.cloudflareApiTokenFile,
          repositoryRoot: options.root,
          outputs: context.outputs,
        },
        api,
      ) as unknown as Record<string, unknown>;
    }
  }
}

export async function runCloudflareProduction(
  options: CloudflareProductionOptions,
  runtime: SurfaceRuntime = defaultRuntime,
): Promise<Record<string, unknown>> {
  return (await runCloudflareProductionRecorded(options, runtime)).report;
}

/** Exposed so tests can assert exactly what a phase issued against the target. */
export async function runCloudflareProductionRecorded(
  options: CloudflareProductionOptions,
  runtime: SurfaceRuntime = defaultRuntime,
): Promise<{
  report: Record<string, unknown>;
  issued: readonly CommandRequest[];
}> {
  const loaded = await loadOutputs(options.outputs);
  if (
    options.phase === "runtime-secrets-install" ||
    options.phase === "absence-proof"
  ) {
    const actualDigest = digestBytes(loaded.bytes);
    if (actualDigest !== options.outputDigest) {
      refuse(
        `retained module outputs digest ${actualDigest} does not match --output-digest ${options.outputDigest}`,
      );
    }
  }
  const context: Context = {
    options,
    runtime,
    outputs: loaded.outputs,
    issued: [],
  };
  return { report: await execute(context), issued: context.issued };
}
