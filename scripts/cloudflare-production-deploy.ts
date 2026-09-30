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
import {
  constants as fileConstants,
  createReadStream,
  type BigIntStats,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createGunzip } from "node:zlib";

import { assertPhysicalGitTreeMatchesCommit } from "./check-physical-git-tree.ts";
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
  CLOUDFLARE_COMPLETE_LIST,
  TAKOS_FIRST_INSTALL_OWNER_CONTRACT_KIND,
  TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE,
  defaultCloudflareApi,
  digestBytes,
  listCloudflareApiRows,
  runFirstInstallAbsenceProof,
  runFirstInstallRuntimeSecrets,
  type CloudflareApiRequest,
  type CloudflareApiResponse,
  type FirstInstallReleaseApplyResult,
  type FirstInstallReleaseIdentity,
  type FirstInstallReleaseStatusResult,
} from "./cloudflare-first-install.ts";
import {
  assertOwnerPrivateFile,
  OwnerPrivateInputError,
  readOwnerPrivateFile,
} from "./owner-private-input.ts";
import { REQUIRED_RUNTIME_SECRET_NAMES } from "../src/worker/shared/config/runtime-secrets.ts";

export {
  TAKOS_FIRST_INSTALL_OWNER_CONTRACT,
  type CloudflareApiRequest,
  type CloudflareApiResponse,
} from "./cloudflare-first-install.ts";

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const EXACT_VERSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const VERSION_ID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/u;
const MISSING_WORKER =
  /script_not_found|not_found|could not find|does not exist|no deployments|10007|10090/iu;
const MISSING_INDEX = /not.?found|does not exist|1002|4003|404/iu;
const MAX_WORKER_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_WORKER_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_WORKER_ARCHIVE_ENTRIES = 20_000;
const MAX_ARCHIVE_PATH_BYTES = 4_096;
const MAX_PROVIDER_JSON_CHARACTERS = 4 * 1024 * 1024;
const TAR_BLOCK_BYTES = 512;
const RELEASE_ATTEMPT_KIND = "takos.first-install-release-attempt@v2";
const RELEASE_LEASE_KIND = "takos.first-install-release-lease@v1";
const VERSION_SECRET_BINDING_TYPE = "secret_text";

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
      "--apply --environment=production refuses a dirty worktree, requires clean main or an exact --commit equal to HEAD, and deploys the published release artifact of that commit: the takos.worker-artifact@v3 descriptor is parsed in its canonical form, its archive is downloaded from the release URL and accepted only when the exact size and SHA-256 match the record, and the record's commit must equal the deploying commit. integration and rehearsal may build from the worktree instead. The realized Wrangler configuration is rendered from the OpenTofu module's non-secret Outputs rather than hand-copied, and its SHA-256 is printed with the commit, the release tag, the archive digest, and the pinned container image digest. The first-install @v2 release writer additionally bounds and digests the exact canonical descriptor bytes, requires that digest to equal the caller-selected --expected-release-descriptor-digest before provider access, fixes orchestration to integration and the Takos product environment to staging, requires clean HEAD = source commit = canonical descriptor commit, streams the archive into fresh private custody outside the repository, rejects traversal, duplicate, linked, special, over-count, over-size, and over-expanded tar entries before extraction, seals the archive, extracted payload, manifest, assets, and realized configuration by content and physical identity, uploads only from custody, and records the retained OpenTofu bootstrap Worker version separately from the newly activated served version. Legacy apply/status reads CLOUDFLARE_API_TOKEN from the environment. First-install authority phases reject ambient credential selection: the token comes only from a canonical owner-owned 0600 file, target account/name come from the digest-bound non-secret OpenTofu output artifact, secret values come only from the exact owner-owned 0700 five-file closure, and none is written, recorded, or echoed.",
    "post-conditions":
      "After the upload the entrypoint reads the newly served Worker version id back from the account, requires it to differ from the version captured before the mutation, and reads that immutable version's binding closure to prove the exact sealed-config-derived non-secret closure, including every var, ASSETS, AI, D1, KV, R2, Queue, Vectorize, Durable Object, and service binding plus service entrypoint, with no unexpected or duplicate binding. It separately re-reads the Worker's secret names to prove the exact five runtime secrets survived the upload. First-install reads every bounded Cloudflare Container API page twice, requires both complete inventories to match and their entire canonical name set to equal exactly the three executor applications, then checks each typed detail for the pinned image, exact identity, healthy counts, and no active rollout; the upload's immediate rollout flag alone is not completion evidence. It finally exercises the public URL as a user does: production requires /health to answer 200 and the authenticated API boundary /api/auth/me to answer 401; integration and rehearsal require the /health smoke only. First-install release-status accepts only the exact served UUID returned by release-apply as an overlay distinct from the retained module Worker version and rejects every other structural drift without parsing generic drift prose. Runtime-secret installation performs authoritative secret-name readback after every one of the five stdin uploads and emits no value. Absence proof reports absent, present, or indeterminate for the full retained Worker, version, route/domain/workers.dev, D1, KV, five R2, six Queue, Vectorize, and three Container application closure.",
    reversal:
      "The served Worker version id is read and printed before any mutation, together with the exact `wrangler versions deploy <id>@100%` command that restores it through Cloudflare's own version history. Worker rollback reverses nothing else: a Durable Object migration and a created Vectorize index are forward-only, so --apply refuses a pending Durable Object migration unless --allow-durable-object-migration records that the operator accepts an irreversible topology change, and this surface never deletes a Vectorize index or a Container application. Secret replacement cannot reconstruct overwritten values; forward repair is another explicit installation from the owner-retained exact files after authoritative name readback, never an automatic retry. Absence proof never deletes directly and follows the owning OpenTofu destroy.",
    "failure-handling":
      "Every mutation phase is read-only until --execute is passed, --status and --release-status refuse to issue a mutating command, and --absence-proof performs fixed GETs only. Legacy artifact-deploy failures carry the provider's stdout and stderr and name which side of mutation they fell on; first-install runtime-secret and release operations emit only bounded value-free evidence and never raw provider output. The first-install release upload has a canonical-descriptor-digest-bound deterministic account, Worker, source, output-bytes, and operation tag/message. An owner-private target-and-operation lease serializes same-host writers from absence through exact readback; an existing, stale, foreign, or changed lease is never stolen. Cloudflare exposes no distributed compare-and-swap for this upload, so the lease is paired with two complete bounded Worker-version API scans before and after the single strict immediate-rollout deploy. Both normal and lost acknowledgements require one exact tag/message match, one exact inventory addition, the same current version, and matching immutable detail; any duplicate, changed page, foreign concurrent addition, missing match, or different current version stops indeterminate. The upload is never retried. Custody drift before upload is exit 2 and custody drift during or after upload is exit 3. Exit 2 means nothing was touched, exit 3 means a write may have landed and authoritative readback cannot prove the intended new value, and exit 4 means bytes are published but a post-condition failed. There is no retry. A missing CLOUDFLARE_API_TOKEN on the legacy apply/status lane, an invalid owner-private token file on first-install lanes, absent runtime secrets, an unpinned container image, a missing Vectorize index, a pending Durable Object migration, and an unresolved configuration placeholder are refusals before the account is touched.",
    "pre-mutation-proof":
      "Before the ordinary Worker writer runs, the exact realized configuration for the target account is compiled by one strict `wrangler deploy --dry-run`, and the live account is inspected read-only: the served Worker version, its binding closure, the Durable Object classes it already carries, the Vectorize index shape, the Container applications, and — by name only, never by value — the runtime secrets present on the Worker. The first-install release writer additionally acquires its target-and-operation lease, reads two identical complete page/per_page Worker-version inventories to prove its deterministic attempt tag absent, re-proves the physical source tree, and rechecks both the lease and full release custody seal immediately before its sole upload. The separate runtime-secret writer first proves its retained output digest, fixed output-derived target, exact five-name closure, canonical paths, current-user ownership, 0700 directory, 0600 single-link regular files, link-free 0600 token file, and initial authoritative secret-name readback. Production Worker upload additionally reuses the exact-commit gate attestation the release artifact publication already earned at that commit, and runs `bun run check` once when the deploy is not bound to such a release.",
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
  | "absence-proof"
  | "release-apply"
  | "release-status";

export type CloudflareProductionOptions = Readonly<{
  phase: Phase;
  environment: Environment;
  outputs: string;
  release?: string;
  containerImage?: string;
  commit?: string;
  sourceCommit?: string;
  outputDigest?: string;
  expectedReleaseDescriptorDigest?: string;
  operationId?: string;
  productEnvironment?: "staging";
  expectedServedVersion?: string;
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
  assertPhysicalGitTree?: (input: Readonly<{
    root: string;
    commit: string;
    subject: string;
  }>) => Promise<void>;
  cloudflareApi?: (
    request: CloudflareApiRequest,
  ) => Promise<CloudflareApiResponse>;
  /** Test seam; production coordinates in one owner-private host-wide root. */
  releaseLeaseRoot?: string;
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

function isReleaseOwnerPhase(
  phase: Phase,
): phase is "release-apply" | "release-status" {
  return phase === "release-apply" || phase === "release-status";
}

export const CLOUDFLARE_PRODUCTION_USAGE = `Usage:
  bun run deploy -- takos-cloudflare-production --status --environment <integration|rehearsal|production> --outputs <absolute.json> (--release <absolute.json> | --container-image <ref>)
  bun run deploy -- takos-cloudflare-production --vectorize --environment <env> --outputs <absolute.json> [--execute]
  bun run deploy -- takos-cloudflare-production --apply --environment <env> --outputs <absolute.json> (--release <absolute.json> | --container-image <ref>) [--commit <sha>] [--allow-durable-object-migration] [--execute]
  bun run deploy -- takos-cloudflare-production --containers --environment <env> --outputs <absolute.json> (--release <absolute.json> | --container-image <ref>)
  bun run deploy -- takos-cloudflare-production --runtime-secrets-install --environment <env> --outputs <absolute.json> --output-digest <sha256:...> --source-commit <sha> --operation-id <id> --runtime-secret-directory <absolute 0700 dir> --cloudflare-api-token-file <absolute 0600 file> [--execute]
  bun run deploy -- takos-cloudflare-production --absence-proof --environment <env> --outputs <absolute retained.json> --output-digest <sha256:...> --source-commit <sha> --operation-id <id> --cloudflare-api-token-file <absolute 0600 file>
  bun run deploy -- takos-cloudflare-production --release-apply --environment integration --product-environment staging --outputs-file <absolute retained.json> --output-digest <sha256:...> --source-commit <sha> --operation-id <id> --release-descriptor-file <absolute.json> --expected-release-descriptor-digest <sha256:...> --cloudflare-api-token-file <absolute 0600 file> --execute
  bun run deploy -- takos-cloudflare-production --release-status --environment integration --product-environment staging --outputs-file <absolute retained.json> --output-digest <sha256:...> --source-commit <sha> --operation-id <id> --release-descriptor-file <absolute.json> --expected-release-descriptor-digest <sha256:...> --cloudflare-api-token-file <absolute 0600 file> --expected-served-version <uuid>

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
  "--release-apply": "release-apply",
  "--release-status": "release-status",
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
  let ownerOutputsFile: string | undefined;
  let release: string | undefined;
  let ownerReleaseDescriptorFile: string | undefined;
  let containerImage: string | undefined;
  let commit: string | undefined;
  let sourceCommit: string | undefined;
  let outputDigest: string | undefined;
  let expectedReleaseDescriptorDigest: string | undefined;
  let operationId: string | undefined;
  let productEnvironment: string | undefined;
  let expectedServedVersion: string | undefined;
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
      case "--outputs-file":
        ownerOutputsFile = value;
        break;
      case "--release":
        release = value;
        break;
      case "--release-descriptor-file":
        ownerReleaseDescriptorFile = value;
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
      case "--expected-release-descriptor-digest":
        expectedReleaseDescriptorDigest = value;
        break;
      case "--operation-id":
        operationId = value;
        break;
      case "--product-environment":
        productEnvironment = value;
        break;
      case "--expected-served-version":
        expectedServedVersion = value;
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
  const releaseOwnerPhase = phase === "release-apply" || phase === "release-status";
  if (releaseOwnerPhase) {
    if (outputs || release) {
      refuse("release owner phases reject generic --outputs and --release inputs");
    }
    outputs = ownerOutputsFile;
    release = ownerReleaseDescriptorFile;
  } else if (ownerOutputsFile || ownerReleaseDescriptorFile) {
    refuse("--outputs-file and --release-descriptor-file are release owner phase inputs only");
  }
  if (!outputs) refuse("--outputs is required");
  for (const [name, path] of [
    ["--outputs", outputs],
    ["--release", release],
    ["--realized-config", realizedConfig],
    ["--runtime-secret-directory", runtimeSecretDirectory],
    ["--cloudflare-api-token-file", cloudflareApiTokenFile],
    ["--outputs-file", ownerOutputsFile],
    ["--release-descriptor-file", ownerReleaseDescriptorFile],
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
    if (productEnvironment || expectedServedVersion) {
      refuse("runtime-secret and absence phases reject release owner inputs");
    }
  }
  if (releaseOwnerPhase) {
    if (environment !== "integration") {
      refuse("release owner phases require --environment integration");
    }
    if (productEnvironment !== "staging") {
      refuse("release owner phases require --product-environment staging");
    }
    if (!sourceCommit || !COMMIT.test(sourceCommit)) {
      refuse("release owner phases require a full lowercase --source-commit");
    }
    if (!outputDigest || !SHA256_DIGEST.test(outputDigest)) {
      refuse("release owner phases require --output-digest sha256:<64 lowercase hex>");
    }
    if (
      !expectedReleaseDescriptorDigest ||
      !SHA256_DIGEST.test(expectedReleaseDescriptorDigest)
    ) {
      refuse(
        "release owner phases require --expected-release-descriptor-digest sha256:<64 lowercase hex>",
      );
    }
    if (!operationId || !OPERATION_ID.test(operationId)) {
      refuse("release owner phases require a bounded --operation-id");
    }
    if (!release) refuse("--release-descriptor-file is required for release owner phases");
    if (!cloudflareApiTokenFile) {
      refuse("--cloudflare-api-token-file is required for release owner phases");
    }
    if (containerImage || commit || realizedConfig || runtimeSecretDirectory) {
      refuse("release owner phases reject generic image, commit, config, and runtime-secret inputs");
    }
    if (allowDurableObjectMigration) {
      refuse("release owner phases reject Durable Object migration authority");
    }
    if (phase === "release-apply") {
      if (!execute) refuse("--release-apply requires --execute");
      if (expectedServedVersion) {
        refuse("--expected-served-version is release-status only");
      }
    } else {
      if (execute) refuse("--release-status is read-only and rejects --execute");
      if (!expectedServedVersion || !EXACT_VERSION_ID.test(expectedServedVersion)) {
        refuse("--release-status requires an exact --expected-served-version UUID");
      }
    }
  } else if (
    productEnvironment ||
    expectedServedVersion ||
    expectedReleaseDescriptorDigest
  ) {
    refuse(
      "product environment, expected served version, and expected release descriptor digest are release owner inputs only",
    );
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
    ...(expectedReleaseDescriptorDigest === undefined
      ? {}
      : { expectedReleaseDescriptorDigest }),
    ...(operationId === undefined ? {} : { operationId }),
    ...(productEnvironment === undefined
      ? {}
      : { productEnvironment: productEnvironment as "staging" }),
    ...(expectedServedVersion === undefined
      ? {}
      : { expectedServedVersion }),
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
  realizedConfig: string;
  template?: string;
};

async function invoke(
  context: Context,
  request: CommandRequest,
): Promise<CommandResult> {
  const issuedRequest =
    isReleaseOwnerPhase(context.options.phase) &&
      wranglerSubcommand(request) !== null &&
      context.options.cloudflareApiTokenFile
      ? {
          ...request,
          cwd: request.cwd ?? context.options.root,
          cloudflareApiTokenFile: context.options.cloudflareApiTokenFile,
          cloudflareAccountId: context.outputs.accountId,
        }
      : request;
  if (mutatesTarget(issuedRequest)) {
    if (
      context.options.phase === "status" ||
      context.options.phase === "release-status"
    ) {
      refuse(
        `--${context.options.phase} refuses a command that would mutate the target`,
      );
    }
    if (!context.options.execute) {
      refuse(
        isReleaseOwnerPhase(context.options.phase)
          ? "a target mutation was reached without the required --execute authority"
          : `${request.command} ${request.args.join(" ")} mutates the target and --execute was not passed`,
      );
    }
  }
  context.issued.push(issuedRequest);
  try {
    return await context.runtime.run(issuedRequest);
  } catch (error) {
    if (
      context.options.phase === "release-apply" &&
      mutatesTarget(issuedRequest)
    ) {
      throw new ProductionDeployError(
        "indeterminate",
        "the first-install release upload lost its acknowledgement; perform the one owner readback and do not retry",
      );
    }
    if (context.options.phase === "release-status") {
      throw new ProductionDeployError(
        "indeterminate",
        "the first-install release readback could not be observed authoritatively",
      );
    }
    if (isReleaseOwnerPhase(context.options.phase)) {
      throw new ProductionDeployError(
        "refused",
        "a first-install release preflight command could not be observed safely",
      );
    }
    throw error;
  }
}

function wrangler(args: readonly string[]): CommandRequest {
  return { command: "bunx", args: ["wrangler", ...args] };
}

function digestOf(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && (point <= 0x1f || point === 0x7f);
  });
}

type CustodyEntrySeal = Readonly<{
  path: string;
  kind: "directory" | "file";
  device: string;
  inode: string;
  ctimeNs: string;
  mode: string;
  links: string;
  size: string;
  digest?: string;
}>;

type CustodySeal = readonly CustodyEntrySeal[];

function custodyError(
  stage: "refused" | "indeterminate",
  message: string,
): never {
  throw new ProductionDeployError(stage, message);
}

function metadataIdentity(
  metadata: BigIntStats,
): Omit<CustodyEntrySeal, "path" | "kind" | "digest"> {
  return {
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
    mode: (metadata.mode & 0o777n).toString(8),
    links: metadata.nlink.toString(),
    size: metadata.size.toString(),
  };
}

function sameMetadata(
  before: Omit<CustodyEntrySeal, "path" | "kind" | "digest">,
  after: Omit<CustodyEntrySeal, "path" | "kind" | "digest">,
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

async function digestFileBounded(
  path: string,
  remaining: { bytes: number },
  stage: "refused" | "indeterminate",
): Promise<string> {
  const hash = createHash("sha256");
  try {
    for await (const value of createReadStream(path)) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      remaining.bytes -= chunk.byteLength;
      if (remaining.bytes < 0) {
        return custodyError(stage, "release custody exceeds its sealed byte bound");
      }
      hash.update(chunk);
    }
  } catch {
    return custodyError(stage, "release custody changed while its bytes were sealed");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function captureCustodySeal(
  root: string,
  stage: "refused" | "indeterminate",
): Promise<CustodySeal> {
  const entries: CustodyEntrySeal[] = [];
  const remaining = {
    bytes:
      MAX_WORKER_ARCHIVE_BYTES + MAX_EXPANDED_WORKER_ARCHIVE_BYTES +
      MAX_PROVIDER_JSON_CHARACTERS,
  };
  const owner = process.getuid?.();
  if (owner === undefined) {
    return custodyError(stage, "release custody requires an operating-system owner");
  }

  const visit = async (path: string): Promise<void> => {
    let before: BigIntStats;
    try {
      before = await lstat(path, { bigint: true });
    } catch {
      return custodyError(stage, "release custody changed while it was sealed");
    }
    if (before.isSymbolicLink()) {
      return custodyError(stage, "release custody contains a symbolic link");
    }
    if (!before.isDirectory() && !before.isFile()) {
      return custodyError(stage, "release custody contains a non-file entry");
    }
    if (before.uid !== BigInt(owner) || (before.isFile() && before.nlink !== 1n)) {
      return custodyError(stage, "release custody lost its private physical ownership");
    }
    const kind = before.isDirectory() ? "directory" as const : "file" as const;
    const expectedMode = kind === "directory" ? 0o700 : 0o600;
    if ((before.mode & 0o777n) !== BigInt(expectedMode)) {
      return custodyError(stage, `release custody ${kind} is not mode ${expectedMode.toString(8)}`);
    }
    const beforeIdentity = metadataIdentity(before);
    let digest: string | undefined;
    if (kind === "directory") {
      let names: string[];
      try {
        names = (await readdir(path)).sort();
      } catch {
        return custodyError(stage, "release custody directory changed while it was sealed");
      }
      for (const name of names) {
        if (name === "." || name === ".." || name.includes(sep)) {
          return custodyError(stage, "release custody contains an unsafe entry name");
        }
        await visit(join(path, name));
      }
    } else {
      digest = await digestFileBounded(path, remaining, stage);
    }
    let after: BigIntStats;
    try {
      after = await lstat(path, { bigint: true });
    } catch {
      return custodyError(stage, "release custody changed while it was sealed");
    }
    const afterIdentity = metadataIdentity(after);
    if (
      (kind === "directory" && !after.isDirectory()) ||
      (kind === "file" && !after.isFile()) ||
      !sameMetadata(beforeIdentity, afterIdentity)
    ) {
      return custodyError(stage, "release custody changed while its identity was sealed");
    }
    entries.push({
      path: relative(root, path) || ".",
      kind,
      ...afterIdentity,
      ...(digest === undefined ? {} : { digest }),
    });
  };

  await visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function assertCustodySeal(
  root: string,
  expected: CustodySeal,
  stage: "refused" | "indeterminate",
  message: string,
): Promise<void> {
  let actual: CustodySeal;
  try {
    actual = await captureCustodySeal(root, stage);
  } catch (error) {
    if (error instanceof ProductionDeployError) {
      return custodyError(stage, message);
    }
    return custodyError(stage, message);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return custodyError(stage, message);
  }
}

type ReleaseLease = {
  readonly path: string;
  readonly seal: CustodySeal;
  released: boolean;
};

async function assertPrivateLeaseRoot(root: string): Promise<string> {
  if (!isAbsolute(root)) {
    return refuse("the first-install release lease root is not absolute");
  }
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const [canonical, metadata] = await Promise.all([
      realpath(root),
      lstat(root, { bigint: true }),
    ]);
    const owner = process.getuid?.();
    if (
      owner === undefined ||
      canonical !== resolve(root) ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== BigInt(owner) ||
      (metadata.mode & 0o777n) !== 0o700n
    ) {
      return refuse("the first-install release lease root is not owner-private");
    }
    return canonical;
  } catch (error) {
    if (error instanceof ProductionDeployError) throw error;
    return refuse("the first-install release lease root could not be secured");
  }
}

async function acquireReleaseLease(
  context: Context,
  attempt: ReleaseAttemptIdentity,
): Promise<ReleaseLease> {
  const operationId = context.options.operationId;
  if (!operationId) return refuse("the first-install release lease has no operation id");
  const scopeDigest = createHash("sha256").update(JSON.stringify({
    kind: RELEASE_LEASE_KIND,
    accountId: context.outputs.accountId,
    workerName: context.outputs.serviceRuntimeName,
    operationId,
  })).digest("hex");
  const root = await assertPrivateLeaseRoot(
    context.runtime.releaseLeaseRoot ??
      join(tmpdir(), "takos-first-install-release-leases"),
  );
  const path = join(root, scopeDigest);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      return refuse(
        "the target and operation already have a local first-install release lease; inspect the remote attempt inventory and use a fresh operation id instead of retrying",
      );
    }
    return refuse("the target-scoped first-install release lease could not be acquired");
  }

  try {
    const record = `${JSON.stringify({
      kind: RELEASE_LEASE_KIND,
      scopeDigest,
      accountId: context.outputs.accountId,
      workerName: context.outputs.serviceRuntimeName,
      operationId,
      attemptTag: attempt.tag,
      processId: process.pid,
      acquiredAt: new Date().toISOString(),
    })}\n`;
    const recordPath = join(path, "lease.json");
    const handle = await open(recordPath, "wx", 0o600);
    try {
      await handle.writeFile(record);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(recordPath, 0o600);
    return {
      path,
      seal: await captureCustodySeal(path, "refused"),
      released: false,
    };
  } catch (error) {
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof ProductionDeployError) throw error;
    return refuse("the target-scoped first-install release lease could not be sealed");
  }
}

async function assertReleaseLease(
  lease: ReleaseLease,
  stage: AuthorityInventoryFailureStage,
  message: string,
): Promise<void> {
  await assertCustodySeal(lease.path, lease.seal, stage, message);
}

async function releaseReleaseLease(
  lease: ReleaseLease,
  stage: AuthorityInventoryFailureStage,
): Promise<void> {
  if (lease.released) return;
  await assertReleaseLease(
    lease,
    stage,
    "the target-scoped first-install release lease changed while held",
  );
  try {
    await rm(lease.path, { recursive: true });
    lease.released = true;
  } catch {
    return authorityInventoryFailure(
      stage,
      "the target-scoped first-install release lease could not be released safely",
    );
  }
}

function tarNumber(field: Uint8Array, label: string): number {
  if ((field[0] ?? 0) >= 0x80) {
    return refuse(`the published Worker archive contains an unsafe ${label} encoding`);
  }
  const end = field.indexOf(0);
  const bytes = end === -1 ? field : field.subarray(0, end);
  const text = Buffer.from(bytes).toString("ascii").trim();
  if (!/^[0-7]+$/u.test(text)) {
    return refuse(`the published Worker archive contains an unsafe ${label}`);
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    return refuse(`the published Worker archive contains an unsafe ${label}`);
  }
  return value;
}

function tarText(field: Uint8Array, label: string): string {
  const end = field.indexOf(0);
  const bytes = end === -1 ? field : field.subarray(0, end);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return refuse(`the published Worker archive contains an unsafe ${label}`);
  }
  if (text.length === 0 || Buffer.byteLength(text) > MAX_ARCHIVE_PATH_BYTES) {
    return refuse(`the published Worker archive contains an unsafe ${label}`);
  }
  return text;
}

function canonicalArchivePath(name: string, directory: boolean): string {
  let value = name;
  while (value.startsWith("./")) value = value.slice(2);
  if (directory && value.endsWith("/")) value = value.slice(0, -1);
  if (value === "." || value === "") return "";
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.endsWith("/") ||
    hasAsciiControlCharacter(value)
  ) {
    return refuse("the published Worker archive contains an unsafe path");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return refuse("the published Worker archive contains an unsafe path");
  }
  return segments.join("/");
}

async function inspectWorkerArchive(archive: string): Promise<void> {
  const seen = new Map<string, "directory" | "file">();
  let pending = Buffer.alloc(0);
  let bodyBytes = 0;
  let expandedBytes = 0;
  let zeroBlocks = 0;
  let ended = false;
  const input = createReadStream(archive);
  const uncompressed = input.pipe(createGunzip());
  try {
    for await (const value of uncompressed) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      expandedBytes += chunk.byteLength;
      if (expandedBytes > MAX_EXPANDED_WORKER_ARCHIVE_BYTES) {
        return refuse("the published Worker archive exceeds its expanded byte bound");
      }
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length > 0) {
        if (ended) {
          if (pending.some((byte) => byte !== 0)) {
            return refuse("the published Worker archive contains unsafe trailing data");
          }
          pending = Buffer.alloc(0);
          break;
        }
        if (bodyBytes > 0) {
          const consumed = Math.min(bodyBytes, pending.length);
          pending = pending.subarray(consumed);
          bodyBytes -= consumed;
          continue;
        }
        if (pending.length < TAR_BLOCK_BYTES) break;
        const header = pending.subarray(0, TAR_BLOCK_BYTES);
        pending = pending.subarray(TAR_BLOCK_BYTES);
        if (header.every((byte) => byte === 0)) {
          zeroBlocks += 1;
          if (zeroBlocks === 2) ended = true;
          continue;
        }
        if (zeroBlocks !== 0) {
          return refuse("the published Worker archive contains unsafe data after its end marker");
        }
        const storedChecksum = tarNumber(header.subarray(148, 156), "header checksum");
        let actualChecksum = 0;
        for (let index = 0; index < header.length; index += 1) {
          actualChecksum += index >= 148 && index < 156 ? 0x20 : header[index]!;
        }
        if (storedChecksum !== actualChecksum) {
          return refuse("the published Worker archive contains an unsafe header checksum");
        }
        const name = tarText(header.subarray(0, 100), "path");
        const prefixBytes = header.subarray(345, 500);
        const prefixEnd = prefixBytes.indexOf(0);
        const prefixRaw = prefixEnd === -1
          ? prefixBytes
          : prefixBytes.subarray(0, prefixEnd);
        let prefix = "";
        if (prefixRaw.some((byte) => byte !== 0 && byte !== 0x20)) {
          prefix = tarText(prefixRaw, "path prefix");
        }
        const typeByte = header[156] ?? 0;
        const kind = typeByte === 0 || typeByte === 0x30
          ? "file" as const
          : typeByte === 0x35
            ? "directory" as const
            : null;
        if (kind === null) {
          const linked = typeByte === 0x31 || typeByte === 0x32;
          return refuse(
            `the published Worker archive contains an unsafe ${linked ? "link" : "special"} entry`,
          );
        }
        const path = canonicalArchivePath(
          prefix ? `${prefix}/${name}` : name,
          kind === "directory",
        );
        if ((path === "" && kind !== "directory") || seen.has(path)) {
          return refuse("the published Worker archive contains a duplicate or unsafe entry");
        }
        for (const [parent, parentKind] of seen) {
          if (parentKind === "file" && parent !== "" && path.startsWith(`${parent}/`)) {
            return refuse("the published Worker archive contains an unsafe file parent");
          }
        }
        seen.set(path, kind);
        if (seen.size > MAX_WORKER_ARCHIVE_ENTRIES) {
          return refuse("the published Worker archive exceeds its entry bound");
        }
        const size = tarNumber(header.subarray(124, 136), "entry size");
        if (kind === "directory" && size !== 0) {
          return refuse("the published Worker archive contains an unsafe directory size");
        }
        if (size > MAX_EXPANDED_WORKER_ARCHIVE_BYTES) {
          return refuse("the published Worker archive exceeds its expanded byte bound");
        }
        bodyBytes = Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
      }
    }
  } catch (error) {
    if (error instanceof ProductionDeployError) throw error;
    return refuse("the published Worker archive is not a bounded gzip tar stream");
  } finally {
    input.destroy();
    uncompressed.destroy();
  }
  if (!ended || bodyBytes !== 0 || pending.length !== 0) {
    refuse("the published Worker archive ended before a complete bounded tar stream");
  }
  for (const [path, kind] of [
    ["worker/index.js", "file"],
    ["assets", "directory"],
    ["asset-manifest.json", "file"],
  ] as const) {
    if (seen.get(path) !== kind) {
      refuse(`the published Worker archive does not contain the required ${path}`);
    }
  }
  if (![...seen.entries()].some(([path, kind]) => kind === "file" && path.startsWith("assets/"))) {
    refuse("the published Worker archive contains no static asset file");
  }
}

function parseJson(raw: string, label: string): unknown {
  if (raw.length > MAX_PROVIDER_JSON_CHARACTERS) {
    refuse(`${label} exceeded the provider readback size bound`);
  }
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

function parseProviderJson(
  context: Context,
  raw: string,
  label: string,
): unknown {
  if (!isReleaseOwnerPhase(context.options.phase)) return parseJson(raw, label);
  if (raw.length > MAX_PROVIDER_JSON_CHARACTERS) {
    refuse(`${label} exceeded the provider readback size bound`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return refuse(`${label} did not return exact JSON`);
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
  const structured = isReleaseOwnerPhase(context.options.phase);
  const result = await invoke(
    context,
    wrangler([
      "deployments",
      "status",
      "--config",
      context.realizedConfig,
      ...(structured ? ["--json"] : []),
    ]),
  );
  const output = `${result.stdout}${result.stderr}`;
  if (result.exitCode !== 0) {
    if (MISSING_WORKER.test(output)) return null;
    refuse("wrangler deployments status failed", output.trim());
  }
  if (structured) {
    const parsed = parseProviderJson(
      context,
      result.stdout,
      "wrangler deployments status",
    );
    const deployment =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    if (deployment === null || !Array.isArray(deployment.versions)) {
      refuse("wrangler deployments status returned no structured version list");
    }
    if (deployment.versions.length !== 1) {
      throw new ProductionDeployError(
        "post-conditions",
        "the Worker deployment is not an exact single-version activation",
      );
    }
    const traffic = deployment.versions[0];
    const record =
      typeof traffic === "object" && traffic !== null && !Array.isArray(traffic)
        ? traffic as Record<string, unknown>
        : null;
    if (
      record === null ||
      typeof record.version_id !== "string" ||
      !EXACT_VERSION_ID.test(record.version_id) ||
      typeof record.percentage !== "number" ||
      !Number.isFinite(record.percentage)
    ) {
      refuse("wrangler deployments status returned a malformed traffic row");
    }
    if (record.percentage !== 100) {
      throw new ProductionDeployError(
        "post-conditions",
        "the Worker deployment does not activate one exact version at 100 percent",
      );
    }
    return record.version_id;
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
      context.realizedConfig,
      "--json",
    ]),
  );
  if (result.exitCode !== 0) {
    refuse(
      `wrangler versions view ${versionId} failed`,
      `${result.stdout}${result.stderr}`.trim(),
    );
  }
  return parseProviderJson(context, result.stdout, "wrangler versions view");
}

type ReleaseAttemptIdentity = Readonly<{
  tag: string;
  message: string;
}>;

type WorkerVersionSummary = Readonly<{
  id: string;
  tag: string | null;
  message: string | null;
}>;

function releaseAttemptIdentity(
  context: Context,
  sourceCommit: string,
  outputDigest: string,
  operationId: string,
  releaseDescriptorDigest: string,
): ReleaseAttemptIdentity {
  const digest = createHash("sha256").update(JSON.stringify({
    kind: RELEASE_ATTEMPT_KIND,
    accountId: context.outputs.accountId,
    workerName: context.outputs.serviceRuntimeName,
    sourceCommit,
    outputDigest,
    operationId,
    releaseDescriptorDigest,
  })).digest("hex");
  return {
    tag: `takos-first-install-${digest}`,
    message: `takos.first-install-release-apply@v2:${digest}`,
  };
}

function versionAnnotations(value: unknown): {
  tag: string | null;
  message: string | null;
} | null {
  if (!isRecord(value)) return null;
  if (value.annotations === undefined || value.annotations === null) {
    return { tag: null, message: null };
  }
  if (!isRecord(value.annotations)) return null;
  const tag = value.annotations["workers/tag"];
  const message = value.annotations["workers/message"];
  if (
    (tag !== undefined && (typeof tag !== "string" || tag.length > 255)) ||
    (message !== undefined &&
      (typeof message !== "string" || message.length > 1_024))
  ) {
    return null;
  }
  return {
    tag: typeof tag === "string" ? tag : null,
    message: typeof message === "string" ? message : null,
  };
}

type AuthorityInventoryFailureStage = "refused" | "indeterminate";

function authorityInventoryFailure(
  stage: AuthorityInventoryFailureStage,
  message: string,
): never {
  throw new ProductionDeployError(stage, message);
}

function releaseOwnerCloudflareApi(
  context: Context,
): (request: CloudflareApiRequest) => Promise<CloudflareApiResponse> {
  return context.runtime.cloudflareApi ??
    ((request: CloudflareApiRequest) =>
      defaultCloudflareApi(request, context.options.root));
}

function parseWorkerVersionInventory(
  rows: readonly Readonly<Record<string, unknown>>[],
  stage: AuthorityInventoryFailureStage,
): readonly WorkerVersionSummary[] {
  const ids = new Set<string>();
  const parsed = rows.map((entry): WorkerVersionSummary => {
    if (typeof entry.id !== "string" || !EXACT_VERSION_ID.test(entry.id)) {
      return authorityInventoryFailure(
        stage,
        "the complete Worker-version inventory returned a malformed version row",
      );
    }
    if (ids.has(entry.id)) {
      return authorityInventoryFailure(
        stage,
        "the complete Worker-version inventory returned a duplicate version id",
      );
    }
    ids.add(entry.id);
    const annotations = versionAnnotations(entry);
    if (annotations === null) {
      return authorityInventoryFailure(
        stage,
        "the complete Worker-version inventory returned malformed annotations",
      );
    }
    return { id: entry.id, ...annotations };
  });
  return parsed.sort((left, right) => left.id.localeCompare(right.id));
}

async function stableWorkerVersions(
  context: Context,
  stage: AuthorityInventoryFailureStage,
): Promise<readonly WorkerVersionSummary[]> {
  const tokenFile = context.options.cloudflareApiTokenFile;
  if (!tokenFile) {
    return authorityInventoryFailure(
      stage,
      "the complete Worker-version inventory requires the owner-private credential",
    );
  }
  const inventories: Array<readonly WorkerVersionSummary[]> = [];
  for (
    let scan = 0;
    scan < CLOUDFLARE_COMPLETE_LIST.stableScans;
    scan += 1
  ) {
    const listing = await listCloudflareApiRows(
      releaseOwnerCloudflareApi(context),
      {
        tokenFile,
        path:
          `/accounts/${encodeURIComponent(context.outputs.accountId)}/workers/scripts/${encodeURIComponent(context.outputs.serviceRuntimeName)}/versions`,
        pagination: "numbered",
        resultShape: "items",
        exactEnvelope: true,
      },
    );
    if (listing.status !== "complete") {
      return authorityInventoryFailure(
        stage,
        "the complete bounded Worker-version inventory could not be read authoritatively",
      );
    }
    inventories.push(parseWorkerVersionInventory(listing.rows, stage));
  }
  if (JSON.stringify(inventories[0]) !== JSON.stringify(inventories[1])) {
    return authorityInventoryFailure(
      stage,
      "the complete Worker-version inventory changed between stable scans",
    );
  }
  return inventories[0]!;
}

async function workerVersions(
  context: Context,
  stage: AuthorityInventoryFailureStage = "refused",
): Promise<readonly WorkerVersionSummary[]> {
  return await stableWorkerVersions(context, stage);
}

function acknowledgedVersionId(result: CommandResult): string {
  const output = `${result.stdout}${result.stderr}`;
  if (output.length > MAX_PROVIDER_JSON_CHARACTERS) {
    throw new ProductionDeployError(
      "indeterminate",
      "the first-install upload acknowledgement exceeded its bounded output",
    );
  }
  const ids = [...output.matchAll(new RegExp(VERSION_ID.source, "gu"))].map(
    (match) => match[0],
  );
  if (ids.length !== 1 || !EXACT_VERSION_ID.test(ids[0]!)) {
    throw new ProductionDeployError(
      "indeterminate",
      "the first-install upload acknowledgement did not emit exactly one Worker version id",
    );
  }
  return ids[0]!;
}

function assertAttemptVersionDetail(
  detail: unknown,
  versionId: string,
  attempt: ReleaseAttemptIdentity,
): void {
  if (!isRecord(detail) || detail.id !== versionId) {
    refuse("the acknowledged Worker version detail does not match its version id");
  }
  const annotations = versionAnnotations(detail);
  if (
    annotations === null ||
    annotations.tag !== attempt.tag ||
    annotations.message !== attempt.message
  ) {
    refuse("the acknowledged Worker version does not carry its exact release attempt identity");
  }
}

async function secretNames(context: Context): Promise<readonly string[] | null> {
  const result = await invoke(
    context,
    wrangler([
      "secret",
      "list",
      "--config",
      context.realizedConfig,
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
  const parsed = parseProviderJson(context, result.stdout, "wrangler secret list");
  if (!Array.isArray(parsed) || parsed.length > 1_024) {
    refuse("wrangler secret list returned no bounded name list");
  }
  return parsed.map((row) => {
    const name =
      typeof row === "object" &&
        row !== null &&
        !Array.isArray(row) &&
        "name" in row
        ? (row as { name: unknown }).name
        : null;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > 255 ||
      [...name].some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined &&
          (codePoint <= 0x1f || codePoint === 0x7f);
      })
    ) {
      refuse("wrangler secret list returned a malformed name row");
    }
    return name;
  });
}

function exactRuntimeSecretDrift(names: readonly string[] | null): readonly string[] {
  if (names === null) return ["runtime-secret-readback"];
  const expected = [...REQUIRED_RUNTIME_SECRET_NAMES].sort();
  const actual = [...names].sort();
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? []
    : ["runtime-secret-closure"];
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
  const parsed = parseProviderJson(context, result.stdout, "wrangler vectorize get");
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

type ContainerHealth = Readonly<{
  active: number;
  failed: number;
  starting: number;
  scheduling: number;
}>;

type ContainerApplication = Readonly<{
  id: string;
  name: string;
  image: string;
  version: number;
  instances: number;
  state: "ready" | "active" | "provisioning" | "degraded";
  health: ContainerHealth | null;
  activeRolloutId: string | null;
}>;

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

function parseContainerHealth(
  value: unknown,
  stage: AuthorityInventoryFailureStage,
): ContainerHealth {
  const health = isRecord(value) && isRecord(value.instances)
    ? value.instances
    : null;
  const keys = ["active", "failed", "starting", "scheduling"] as const;
  if (
    health === null ||
    keys.some((name) =>
      typeof health[name] !== "number" ||
      !Number.isSafeInteger(health[name]) ||
      Number(health[name]) < 0
    )
  ) {
    return authorityInventoryFailure(
      stage,
      "the complete Container inventory returned malformed health counts",
    );
  }
  return {
    active: Number(health.active),
    failed: Number(health.failed),
    starting: Number(health.starting),
    scheduling: Number(health.scheduling),
  };
}

function parseContainerInventory(
  rows: readonly Readonly<Record<string, unknown>>[],
  stage: AuthorityInventoryFailureStage,
): readonly ContainerApplication[] {
  const ids = new Set<string>();
  const parsed = rows.map((entry): ContainerApplication => {
    const { id, name, image, version, instances } = entry;
    if (
      typeof id !== "string" ||
      !EXACT_VERSION_ID.test(id) ||
      ids.has(id) ||
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > 255 ||
      hasAsciiControlCharacter(name) ||
      typeof image !== "string" ||
      image.length === 0 ||
      image.length > 2_048 ||
      hasAsciiControlCharacter(image) ||
      typeof version !== "number" ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      typeof instances !== "number" ||
      !Number.isSafeInteger(instances) ||
      instances < 0
    ) {
      return authorityInventoryFailure(
        stage,
        "the complete Container inventory returned a malformed application row",
      );
    }
    ids.add(id);
    const health = parseContainerHealth(entry.health, stage);
    const state: ContainerApplication["state"] = health.failed > 0
      ? "degraded"
      : health.starting > 0 || health.scheduling > 0
        ? "provisioning"
        : health.active > 0
          ? "active"
          : "ready";
    return {
      id,
      name,
      image,
      version,
      instances,
      state,
      health,
      activeRolloutId: null,
    };
  });
  return parsed.sort((left, right) => left.id.localeCompare(right.id));
}

async function stableContainerInventory(
  context: Context,
): Promise<readonly ContainerApplication[]> {
  const tokenFile = context.options.cloudflareApiTokenFile;
  if (!tokenFile) {
    return authorityInventoryFailure(
      "indeterminate",
      "the complete Container inventory requires the owner-private credential",
    );
  }
  const inventories: Array<readonly ContainerApplication[]> = [];
  for (
    let scan = 0;
    scan < CLOUDFLARE_COMPLETE_LIST.stableScans;
    scan += 1
  ) {
    const listing = await listCloudflareApiRows(
      releaseOwnerCloudflareApi(context),
      {
        tokenFile,
        path:
          `/accounts/${encodeURIComponent(context.outputs.accountId)}/containers/dash/applications`,
        pagination: "cursor",
        resultShape: "array",
        exactEnvelope: true,
      },
    );
    if (listing.status !== "complete") {
      return authorityInventoryFailure(
        "indeterminate",
        "the complete bounded Container inventory could not be read authoritatively",
      );
    }
    inventories.push(parseContainerInventory(listing.rows, "indeterminate"));
  }
  if (JSON.stringify(inventories[0]) !== JSON.stringify(inventories[1])) {
    return authorityInventoryFailure(
      "indeterminate",
      "the complete Container inventory changed between stable scans",
    );
  }
  return inventories[0]!;
}

async function containerApplications(
  context: Context,
): Promise<readonly ContainerApplication[]> {
  let listed: readonly ContainerApplication[];
  if (isReleaseOwnerPhase(context.options.phase)) {
    listed = await stableContainerInventory(context);
  } else {
    const result = await invoke(
      context,
      wrangler([
        "containers",
        "list",
        "--config",
        context.realizedConfig,
        "--json",
      ]),
    );
    if (result.exitCode !== 0) {
      refuse(
        "wrangler containers list failed",
        `${result.stdout}${result.stderr}`.trim(),
      );
    }
    const parsed = parseProviderJson(context, result.stdout, "wrangler containers list");
    const rows = containerRows(parsed, result.stdout);
    if (rows.length > 1_024) {
      refuse("wrangler containers list exceeded its row bound");
    }
    const ids = new Set<string>();
    listed = rows.map((row): ContainerApplication => {
      if (!isRecord(row)) {
        return refuse("wrangler containers list returned a malformed application row");
      }
      const { id, name, image, version, instances, state } = row;
      if (
        typeof id !== "string" ||
        !EXACT_VERSION_ID.test(id) ||
        ids.has(id) ||
        typeof name !== "string" ||
        name.length === 0 ||
        name.length > 255 ||
        hasAsciiControlCharacter(name) ||
        typeof image !== "string" ||
        image.length === 0 ||
        image.length > 2_048 ||
        typeof version !== "number" ||
        !Number.isSafeInteger(version) ||
        version < 1 ||
        typeof instances !== "number" ||
        !Number.isSafeInteger(instances) ||
        instances < 0 ||
        !["ready", "active", "provisioning", "degraded"].includes(String(state))
      ) {
        return refuse("wrangler containers list returned a malformed application row");
      }
      ids.add(id);
      return {
        id,
        name,
        image,
        version: Number(version),
        instances: Number(instances),
        state: state as ContainerApplication["state"],
        health: null,
        activeRolloutId: null,
      };
    });
  }
  if (!isReleaseOwnerPhase(context.options.phase)) return listed;

  const expectedNames = new Set(
    CONTAINER_CLASS_NAMES.map((className) =>
      `${context.outputs.serviceRuntimeName}-${className}`.toLowerCase()
    ),
  );
  return await Promise.all(listed.map(async (application) => {
    if (!expectedNames.has(application.name)) return application;
    const detailResult = await invoke(
      context,
      wrangler([
        "containers",
        "info",
        application.id,
        "--config",
        context.realizedConfig,
      ]),
    );
    if (detailResult.exitCode !== 0) {
      refuse(`wrangler containers info ${application.id} failed`);
    }
    const detail = parseProviderJson(
      context,
      detailResult.stdout,
      `wrangler containers info ${application.id}`,
    );
    if (!isRecord(detail)) {
      return refuse("wrangler containers info returned a malformed application");
    }
    const configuration = isRecord(detail.configuration)
      ? detail.configuration
      : {};
    const image = typeof configuration.image === "string"
      ? configuration.image
      : detail.image;
    const healthRecord = isRecord(detail.health) && isRecord(detail.health.instances)
      ? detail.health.instances
      : null;
    const healthKeys = ["active", "failed", "starting", "scheduling"] as const;
    if (
      detail.id !== application.id ||
      detail.name !== application.name ||
      detail.version !== application.version ||
      image !== application.image ||
      healthRecord === null ||
      healthKeys.some((name) =>
        typeof healthRecord[name] !== "number" ||
        !Number.isSafeInteger(healthRecord[name]) ||
        Number(healthRecord[name]) < 0
      ) ||
      (detail.active_rollout_id !== undefined &&
        detail.active_rollout_id !== null &&
        (typeof detail.active_rollout_id !== "string" ||
          detail.active_rollout_id.length === 0 ||
          detail.active_rollout_id.length > 255))
    ) {
      return refuse("wrangler containers info did not match its typed list application");
    }
    return {
      ...application,
      health: {
        active: Number(healthRecord.active),
        failed: Number(healthRecord.failed),
        starting: Number(healthRecord.starting),
        scheduling: Number(healthRecord.scheduling),
      },
      activeRolloutId:
        typeof detail.active_rollout_id === "string"
          ? detail.active_rollout_id
          : null,
    };
  }));
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

type ExpectedVersionBinding = Readonly<{
  name: string;
  types: readonly string[];
  identity: Readonly<Record<string, string>>;
}>;

type RealizedConfigSection = Readonly<{
  name: string;
  values: Readonly<Record<string, string>>;
}>;

function realizedConfigSections(text: string): readonly RealizedConfigSection[] {
  const sections: Array<{ name: string; values: Record<string, string> }> = [];
  let current: { name: string; values: Record<string, string> } | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const array = /^\[\[([a-z0-9_.]+)\]\]$/iu.exec(line);
    const table = /^\[([a-z0-9_.]+)\]$/iu.exec(line);
    if (array || table) {
      current = { name: (array ?? table)![1]!, values: {} };
      sections.push(current);
      continue;
    }
    if (current === null) continue;
    const assignment = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/u.exec(line);
    if (!assignment) continue;
    const [, name, value] = assignment;
    if (Object.prototype.hasOwnProperty.call(current.values, name!)) {
      refuse(`the sealed realized config duplicates ${current.name}.${name}`);
    }
    current.values[name!] = value!;
  }
  return sections;
}

function realizedString(
  section: RealizedConfigSection,
  name: string,
  allowEmpty = false,
): string {
  const raw = section.values[name];
  if (raw === undefined) {
    return refuse(`the sealed realized config omits ${section.name}.${name}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return refuse(`the sealed realized config has a non-string ${section.name}.${name}`);
  }
  if (
    typeof parsed !== "string" ||
    (!allowEmpty && parsed.length === 0) ||
    parsed.length > 4_096 ||
    hasAsciiControlCharacter(parsed)
  ) {
    return refuse(`the sealed realized config has an unsafe ${section.name}.${name}`);
  }
  return parsed;
}

function expectedVersionBindingsFromRealizedConfig(
  text: string,
): readonly ExpectedVersionBinding[] {
  const sections = realizedConfigSections(text);
  const expected: ExpectedVersionBinding[] = [];
  const add = (binding: ExpectedVersionBinding): void => {
    if (expected.some((entry) => entry.name === binding.name)) {
      refuse(`the sealed realized config duplicates non-secret binding ${binding.name}`);
    }
    expected.push(binding);
  };

  const singleton = (name: string): RealizedConfigSection => {
    const matches = sections.filter((section) => section.name === name);
    if (matches.length !== 1) {
      return refuse(`the sealed realized config requires exactly one [${name}] section`);
    }
    return matches[0]!;
  };

  const vars = singleton("vars");
  for (const name of Object.keys(vars.values).sort()) {
    add({
      name,
      types: ["plain_text"],
      identity: { text: realizedString(vars, name, true) },
    });
  }

  const assets = singleton("assets");
  add({
    name: realizedString(assets, "binding"),
    types: ["assets"],
    identity: {},
  });
  const ai = singleton("ai");
  add({
    name: realizedString(ai, "binding"),
    types: ["ai"],
    identity: {},
  });

  for (const section of sections) {
    switch (section.name) {
      case "d1_databases":
        add({
          name: realizedString(section, "binding"),
          types: ["d1"],
          identity: { id: realizedString(section, "database_id") },
        });
        break;
      case "kv_namespaces":
        add({
          name: realizedString(section, "binding"),
          types: ["kv_namespace"],
          identity: { namespace_id: realizedString(section, "id") },
        });
        break;
      case "r2_buckets":
        add({
          name: realizedString(section, "binding"),
          types: ["r2_bucket"],
          identity: { bucket_name: realizedString(section, "bucket_name") },
        });
        break;
      case "queues.producers":
        add({
          name: realizedString(section, "binding"),
          types: ["queue"],
          identity: { queue_name: realizedString(section, "queue") },
        });
        break;
      case "vectorize":
        add({
          name: realizedString(section, "binding"),
          types: ["vectorize", "vectorize_index"],
          identity: { index_name: realizedString(section, "index_name") },
        });
        break;
      case "durable_objects.bindings":
        add({
          name: realizedString(section, "name"),
          types: ["durable_object_namespace"],
          identity: { class_name: realizedString(section, "class_name") },
        });
        break;
      case "services":
        add({
          name: realizedString(section, "binding"),
          types: ["service"],
          identity: {
            service: realizedString(section, "service"),
            entrypoint: realizedString(section, "entrypoint"),
          },
        });
        break;
    }
  }
  return expected.sort((left, right) => left.name.localeCompare(right.name));
}

function versionBindingDrift(
  detail: unknown,
  servedVersion: string,
  expected: readonly ExpectedVersionBinding[],
): readonly string[] {
  const version =
    typeof detail === "object" && detail !== null && !Array.isArray(detail)
      ? detail as Record<string, unknown>
      : null;
  const resources =
    version !== null &&
      typeof version.resources === "object" &&
      version.resources !== null &&
      !Array.isArray(version.resources)
      ? version.resources as Record<string, unknown>
      : null;
  if (
    version?.id !== servedVersion ||
    resources === null ||
    !Array.isArray(resources.bindings)
  ) {
    return ["served-version-detail"];
  }

  if (resources.bindings.some((binding) => !isRecord(binding))) {
    return ["malformed-binding-row"];
  }
  const bindings = resources.bindings as readonly Record<string, unknown>[];
  const nonSecret = bindings.filter(
    (binding) => binding.type !== VERSION_SECRET_BINDING_TYPE,
  );
  const drift = expected.flatMap((wanted) => {
    const candidates = bindings.filter((binding) => binding.name === wanted.name);
    if (candidates.length !== 1) return [wanted.name];
    const binding = candidates[0]!;
    if (
      typeof binding.type !== "string" ||
      !wanted.types.includes(binding.type) ||
      Object.entries(wanted.identity).some(
        ([field, value]) => binding[field] !== value,
      )
    ) {
      return [wanted.name];
    }
    return [];
  });
  for (const binding of nonSecret) {
    if (
      typeof binding.name !== "string" ||
      binding.name.length === 0 ||
      binding.name.length > 255 ||
      typeof binding.type !== "string" ||
      !expected.some((wanted) => wanted.name === binding.name)
    ) {
      drift.push(
        typeof binding.name === "string"
          ? `unexpected:${binding.name}`
          : "malformed-binding-row",
      );
    }
  }
  return [...new Set(drift)];
}

type ReleaseBinding = Readonly<{
  descriptor: WorkerArtifactDescriptor | null;
  descriptorDigest: string | null;
  containerImage: string;
  bundle: { entrypoint: string; assetsDirectory: string } | null;
  archiveDigest: string | null;
  temporaryRoot: string | null;
  custody: Readonly<{
    root: string;
    config: string;
    archive?: string;
    manifest?: string;
  }> | null;
}>;

async function readReleaseDescriptor(
  path: string,
): Promise<Readonly<{ descriptor: WorkerArtifactDescriptor; digest: string }>> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      path,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW,
    );
  } catch {
    return refuse("the release descriptor could not be opened as a regular file");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size >
        BigInt(TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.descriptor.maxBytes)
    ) {
      return refuse("the release descriptor exceeds its bounded regular-file contract");
    }
    const storage = Buffer.alloc(
      TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.descriptor.maxBytes + 1,
    );
    let length = 0;
    while (length < storage.byteLength) {
      const read = await handle.read(
        storage,
        length,
        storage.byteLength - length,
        length,
      );
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (
      length === 0 ||
      length > TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.descriptor.maxBytes
    ) {
      return refuse("the release descriptor exceeds its byte bound");
    }
    const after = await handle.stat({ bigint: true });
    if (
      !sameMetadata(metadataIdentity(before), metadataIdentity(after)) ||
      BigInt(length) !== after.size
    ) {
      return refuse("the release descriptor changed while its exact bytes were read");
    }
    const bytes = new Uint8Array(storage.subarray(0, length));
    return {
      descriptor: parseCanonicalWorkerArtifactDescriptor(bytes),
      digest: digestBytes(bytes),
    };
  } catch (error) {
    if (error instanceof ProductionDeployError) throw error;
    return refuse(
      "the release descriptor is not a canonical takos.worker-artifact@v3 record",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function assertReleaseOwnerDescriptorIdentity(
  descriptor: WorkerArtifactDescriptor,
  sourceCommit: string,
): void {
  const releaseBase =
    `https://github.com/tako0614/takos/releases/download/${descriptor.releaseTag}`;
  if (
    descriptor.commit !== sourceCommit ||
    descriptor.ref !== descriptor.releaseTag ||
    descriptor.artifact.url !==
      `${releaseBase}/takos-worker-release.tar.gz` ||
    descriptor.manifestUrl !== `${releaseBase}/takos-artifact.json` ||
    descriptor.artifact.sha256Prefixed !==
      `sha256:${descriptor.artifact.sha256}` ||
    !descriptor.containerImages.executor ||
    !descriptor.containerImages.publicAgent
  ) {
    refuse("the canonical release descriptor does not match the fixed first-install release identity");
  }
}

async function createReleaseCustodyRoot(context: Context): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takos-production-release-"));
  await chmod(root, 0o700);
  let canonical: string;
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    canonical = await realpath(root);
    metadata = await lstat(root);
  } catch {
    await rm(root, { recursive: true, force: true });
    return refuse("fresh release custody could not be validated");
  }
  const fromRepository = relative(resolve(context.options.root), canonical);
  if (
    canonical !== resolve(root) ||
    fromRepository === "" ||
    (!fromRepository.startsWith("..") && !isAbsolute(fromRepository)) ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700
  ) {
    await rm(root, { recursive: true, force: true });
    return refuse("fresh release custody is not a private physical directory outside the repository");
  }
  return canonical;
}

async function writeArchiveResponse(
  response: Response,
  archive: string,
  expectedSize: number,
): Promise<string> {
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > MAX_WORKER_ARCHIVE_BYTES
  ) {
    refuse("the published Worker archive exceeds the release size bound");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length !== expectedSize) {
      await response.body?.cancel().catch(() => undefined);
      refuse("the published Worker archive content length does not match the release record");
    }
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(archive, "wx", 0o600);
  } catch {
    return refuse("fresh release custody could not create the archive exclusively");
  }
  const hash = createHash("sha256");
  let size = 0;
  try {
    const reader = response.body?.getReader();
    if (!reader) refuse("the published Worker archive response has no body");
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_WORKER_ARCHIVE_BYTES || size > expectedSize) {
          await reader.cancel().catch(() => undefined);
          refuse("the published Worker archive exceeds its bounded release size");
        }
        hash.update(next.value);
        let offset = 0;
        while (offset < next.value.byteLength) {
          const written = await handle.write(
            next.value,
            offset,
            next.value.byteLength - offset,
            size - next.value.byteLength + offset,
          );
          if (written.bytesWritten <= 0) {
            refuse("the published Worker archive could not be written completely");
          }
          offset += written.bytesWritten;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (size !== expectedSize) {
      refuse(
        `the published Worker archive is ${size} bytes; the release record says ${expectedSize}`,
      );
    }
    await handle.sync();
  } catch (error) {
    if (error instanceof ProductionDeployError) throw error;
    return refuse("the published Worker archive stream could not be retained safely");
  } finally {
    await handle.close().catch(() => undefined);
  }
  return `sha256:${hash.digest("hex")}`;
}

async function hardenExtractedCustody(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    refuse("the published Worker archive extracted a link entry");
  }
  if (metadata.isDirectory()) {
    await chmod(path, 0o700);
    for (const name of (await readdir(path)).sort()) {
      await hardenExtractedCustody(join(path, name));
    }
    return;
  }
  if (!metadata.isFile() || metadata.nlink !== 1) {
    refuse("the published Worker archive extracted a linked or special entry");
  }
  await chmod(path, 0o600);
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
  archive: string;
  manifest: string;
}> {
  const root = await createReleaseCustodyRoot(context);
  const archive = join(root, descriptor.artifact.filename);
  const extractedRoot = join(root, "payload");
  try {
  const response = await context.runtime.fetch(descriptor.artifact.url, {
    redirect: "follow",
  });
  if (!response.ok) {
    refuse(
      `the published Worker archive ${descriptor.artifact.url} answered ${response.status}`,
    );
  }
  const digest = await writeArchiveResponse(
    response,
    archive,
    descriptor.artifact.size,
  );
  if (digest !== descriptor.artifact.sha256Prefixed) {
    refuse(
      `the published Worker archive digest ${digest} does not match the release record ${descriptor.artifact.sha256Prefixed}`,
    );
  }
  const archiveSeal = await captureCustodySeal(archive, "refused");
  await inspectWorkerArchive(archive);
  await assertCustodySeal(
    archive,
    archiveSeal,
    "refused",
    "the published Worker archive changed during validation",
  );
  await mkdir(extractedRoot, { mode: 0o700 });
  const extracted = await invoke(context, {
    command: "tar",
    args: [
      "--extract",
      "--gzip",
      "--file",
      archive,
      "--directory",
      extractedRoot,
      "--no-same-owner",
      "--no-same-permissions",
      "--delay-directory-restore",
    ],
  });
  if (extracted.exitCode !== 0) {
    refuse(
      "the published Worker archive could not be extracted",
      `${extracted.stdout}${extracted.stderr}`.trim(),
    );
  }
  await assertCustodySeal(
    archive,
    archiveSeal,
    "refused",
    "the published Worker archive changed during extraction",
  );
  await hardenExtractedCustody(extractedRoot);
  const entrypoint = join(extractedRoot, "worker/index.js");
  const assetsDirectory = join(extractedRoot, "assets");
  const manifest = join(extractedRoot, descriptor.assetManifest);
  const [entrypointMetadata, assetsMetadata, manifestMetadata] = await Promise.all([
    lstat(entrypoint),
    lstat(assetsDirectory),
    lstat(manifest),
  ]).catch(() => refuse("the published Worker archive omits its required release payload"));
  if (
    !entrypointMetadata.isFile() ||
    !assetsMetadata.isDirectory() ||
    !manifestMetadata.isFile()
  ) {
    refuse("the published Worker archive carries an unsafe required payload type");
  }
  return {
    bundle: { entrypoint, assetsDirectory },
    digest,
    root,
    archive,
    manifest,
  };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
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
      descriptorDigest: null,
      containerImage: options.containerImage,
      bundle: null,
      archiveDigest: null,
      temporaryRoot: null,
      custody: null,
    };
  }
  const descriptorRead = await readReleaseDescriptor(options.release);
  if (
    isReleaseOwnerPhase(options.phase) &&
    descriptorRead.digest !== options.expectedReleaseDescriptorDigest
  ) {
    refuse(
      "the canonical release descriptor digest does not match the caller-selected digest",
    );
  }
  const { descriptor } = descriptorRead;
  if (isReleaseOwnerPhase(options.phase)) {
    if (!options.sourceCommit) {
      refuse("first-install release source identity is incomplete");
    }
    assertReleaseOwnerDescriptorIdentity(descriptor, options.sourceCommit);
  }
  const image = options.containerImage ?? descriptor.containerImages.executor;
  if (!image) {
    refuse(
      `the release descriptor ${options.release} records no containerImages.executor, so no pinned agent image is available`,
    );
  }
  assertPinnedContainerImage(image, context.outputs.accountId);
  if (
    options.phase !== "release-apply" &&
    (options.phase !== "apply" || options.environment !== "production")
  ) {
    const custodyRoot = isReleaseOwnerPhase(options.phase)
      ? await createReleaseCustodyRoot(context)
      : null;
    if (custodyRoot !== null) {
      context.realizedConfig = join(custodyRoot, "wrangler.toml");
    }
    return {
      descriptor,
      descriptorDigest: descriptorRead.digest,
      containerImage: image,
      bundle: null,
      archiveDigest: null,
      temporaryRoot: custodyRoot,
      custody: custodyRoot === null
        ? null
        : { root: custodyRoot, config: context.realizedConfig },
    };
  }
  const bound = await bindPublishedRelease(context, descriptor);
  context.realizedConfig = join(bound.root, "wrangler.toml");
  return {
    descriptor,
    descriptorDigest: descriptorRead.digest,
    containerImage: image,
    bundle: bound.bundle,
    archiveDigest: bound.digest,
    temporaryRoot: bound.root,
    custody: {
      root: bound.root,
      config: context.realizedConfig,
      archive: bound.archive,
      manifest: bound.manifest,
    },
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
  await writeFile(context.realizedConfig, projection.text, {
    mode: 0o600,
    ...(isReleaseOwnerPhase(context.options.phase) ? { flag: "wx" } : {}),
  });
  return projection;
}

type SealedReleasePayload = Readonly<{
  custody: CustodySeal;
  expectedBindings: readonly ExpectedVersionBinding[];
}>;

async function sealReleasePayload(
  context: Context,
  release: ReleaseBinding,
): Promise<SealedReleasePayload> {
  if (release.custody === null) {
    return refuse("first-install release payload has no private custody");
  }
  const inside = (path: string): boolean => {
    const fromRoot = relative(release.custody!.root, path);
    return fromRoot !== "" && !fromRoot.startsWith("..") && !isAbsolute(fromRoot);
  };
  if (
    context.realizedConfig !== release.custody.config ||
    !inside(context.realizedConfig) ||
    (release.bundle !== null &&
      (!inside(release.bundle.entrypoint) || !inside(release.bundle.assetsDirectory)))
  ) {
    return refuse("first-install upload paths are not wholly inside private release custody");
  }
  const custody = await captureCustodySeal(release.custody.root, "refused");
  let config: string;
  try {
    const bytes = await readFile(context.realizedConfig);
    if (bytes.byteLength > MAX_PROVIDER_JSON_CHARACTERS) {
      return refuse("the sealed realized config exceeds its byte bound");
    }
    config = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof ProductionDeployError) throw error;
    return refuse("the sealed realized config could not be read safely");
  }
  await assertCustodySeal(
    release.custody.root,
    custody,
    "refused",
    "release custody changed while the realized config was read",
  );
  return {
    custody,
    expectedBindings: expectedVersionBindingsFromRealizedConfig(config),
  };
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

type StatusObservation = Readonly<{
  release: ReleaseBinding;
  projection: Projection;
  desiredTag: string;
  served: string | null;
  detail: unknown;
  secrets: readonly string[] | null;
  vector: VectorIndexState;
  containers: readonly ContainerApplication[];
  pending: readonly string[];
  health: Awaited<ReturnType<typeof probePublicUrl>>;
  missingSecrets: readonly string[];
  pinnedContainers: readonly ContainerApplication[];
  expectedBindings: readonly ExpectedVersionBinding[];
}>;

async function observeStatus(
  context: Context,
  preparedRelease?: ReleaseBinding,
): Promise<StatusObservation> {
  const release = preparedRelease ?? await resolveRelease(context);
  const projection = await renderRealizedConfig(
    context,
    release.containerImage,
    null,
  );
  const sealed = release.custody === null
    ? null
    : await sealReleasePayload(context, release);
  const expectedBindings = sealed?.expectedBindings ??
    expectedVersionBindingsFromRealizedConfig(projection.text);
  const desiredTag = latestMigrationTag(await templateText(context));

  const served = await servedVersionId(context);
  const detail = served === null ? null : await versionDetail(context, served);
  const secrets = await secretNames(context);
  const vector = await vectorIndexState(context);
  const containers = await containerApplications(context);
  const pending = pendingDurableObjectWork(detail, desiredTag);
  const health = await probePublicUrl(context, "/health");
  if (sealed !== null && release.custody !== null) {
    await assertCustodySeal(
      release.custody.root,
      sealed.custody,
      "indeterminate",
      "release custody changed during authoritative status readback",
    );
  }

  const missingSecrets = RUNTIME_SECRET_BINDING_NAMES.filter(
    (name) => !(secrets ?? []).includes(name),
  );
  const pinnedContainers = containers.filter(
    (application) => application.image === release.containerImage,
  );

  return {
    release,
    projection,
    desiredTag,
    served,
    detail,
    secrets,
    vector,
    containers,
    pending,
    health,
    missingSecrets,
    pinnedContainers,
    expectedBindings,
  };
}

async function statusPhase(context: Context): Promise<Record<string, unknown>> {
  const {
    release,
    projection,
    desiredTag,
    served,
    secrets,
    vector,
    containers,
    pending,
    health,
    missingSecrets,
    pinnedContainers,
  } = await observeStatus(context);

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
      path: context.realizedConfig,
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
    clean:
      (await read(["status", "--porcelain=v1", "--untracked-files=all"]))
        .length === 0,
  };
}

async function assertReleaseSourcePhysical(
  context: Context,
  expectedCommit: string,
): Promise<void> {
  const current = await sourceIdentity(context);
  if (!current.clean || current.commit !== expectedCommit) {
    refuse("the release owner checkout changed before authoritative readback or mutation");
  }
  try {
    await (
      context.runtime.assertPhysicalGitTree ?? assertPhysicalGitTreeMatchesCommit
    )({
      root: context.options.root,
      commit: expectedCommit,
      subject: "first-install release checkout",
    });
  } catch {
    refuse("the physical release owner checkout does not match --source-commit");
  }
}

async function assertReleaseOwnerPreflight(context: Context): Promise<void> {
  const { options, outputs } = context;
  if (
    options.environment !== "integration" ||
    options.productEnvironment !== "staging" ||
    outputs.deploymentEnvironment !== "staging"
  ) {
    refuse(
      "first-install release ownership is fixed to orchestration lane integration and Takos product environment staging",
    );
  }
  if (
    outputs.moduleWorkerVersionId === null ||
    !EXACT_VERSION_ID.test(outputs.moduleWorkerVersionId)
  ) {
    refuse("retained outputs do not identify an exact OpenTofu bootstrap Worker version");
  }
  if (
    JSON.stringify([...outputs.runtimeSecretBindingNames].sort()) !==
      JSON.stringify([...REQUIRED_RUNTIME_SECRET_NAMES].sort())
  ) {
    refuse("retained outputs do not declare the exact five Takos runtime-secret names");
  }
  for (const [label, value, maximum] of [
    ["Worker name", outputs.serviceRuntimeName, 255],
    ["public URL", outputs.publicUrl, 2_048],
  ] as const) {
    if (
      value.length === 0 ||
      value.length > maximum ||
      [...value].some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined &&
          (codePoint <= 0x1f || codePoint === 0x7f);
      })
    ) {
      refuse(`${label} is not a bounded first-install result identity`);
    }
  }
  if (!options.cloudflareApiTokenFile) {
    refuse("first-install release ownership requires a Cloudflare token file");
  }
  if (
    !options.expectedReleaseDescriptorDigest ||
    !SHA256_DIGEST.test(options.expectedReleaseDescriptorDigest)
  ) {
    refuse(
      "first-install release ownership requires the caller-selected canonical descriptor digest",
    );
  }
  try {
    const tokenFile = await assertOwnerPrivateFile(
      options.cloudflareApiTokenFile,
      { repositoryRoot: options.root, maxBytes: 8 * 1024 },
    );
    if ((await readOwnerPrivateFile(tokenFile, {
      repositoryRoot: options.root,
      maxBytes: 8 * 1024,
    })).trim().length === 0) {
      refuse("owner-private Cloudflare credential file is empty");
    }
  } catch (error) {
    if (error instanceof ProductionDeployError) throw error;
    if (error instanceof OwnerPrivateInputError) refuse(error.message);
    refuse("owner-private Cloudflare credential could not be validated");
  }
}

function exactOwnerReleaseIdentity(
  binding: ReleaseBinding,
  sourceCommit: string,
  requireArchiveReadback: boolean,
): FirstInstallReleaseIdentity {
  const descriptor = binding.descriptor;
  if (descriptor !== null) {
    assertReleaseOwnerDescriptorIdentity(descriptor, sourceCommit);
  }
  if (
    descriptor === null ||
    binding.descriptorDigest === null ||
    !SHA256_DIGEST.test(binding.descriptorDigest) ||
    !descriptor.containerImages.executor ||
    !descriptor.containerImages.publicAgent ||
    binding.containerImage !== descriptor.containerImages.executor ||
    (requireArchiveReadback &&
      binding.archiveDigest !== descriptor.artifact.sha256Prefixed)
  ) {
    refuse("the canonical release descriptor does not match the fixed first-install release identity");
  }
  for (const [label, value, maximum] of [
    ["release tag", descriptor.releaseTag, 128],
    ["executor image", descriptor.containerImages.executor, 2_048],
    ["public-agent image", descriptor.containerImages.publicAgent, 2_048],
  ] as const) {
    if (value.length > maximum) {
      refuse(`${label} exceeds the first-install result size bound`);
    }
  }
  return {
    tag: descriptor.releaseTag,
    descriptor: {
      kind: descriptor.kind,
      digest: binding.descriptorDigest,
    },
    archiveDigest: descriptor.artifact.sha256Prefixed,
    executorImage: descriptor.containerImages.executor,
    publicAgentImage: descriptor.containerImages.publicAgent,
  };
}

function completeContainerEvidence() {
  return {
    ...TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.containerApplications,
    inventory: {
      status: "complete" as const,
      scans: CLOUDFLARE_COMPLETE_LIST.stableScans,
    },
    exactApplicationNames: CONTAINER_CLASS_NAMES.length,
    healthyApplicationDetails: CONTAINER_CLASS_NAMES.length,
    activeRollouts: 0 as const,
  };
}

function completeReleaseApplyEvidence() {
  return {
    workerVersions: {
      ...TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.workerVersions,
      before: {
        status: "complete" as const,
        scans: CLOUDFLARE_COMPLETE_LIST.stableScans,
      },
      after: {
        status: "complete" as const,
        scans: CLOUDFLARE_COMPLETE_LIST.stableScans,
      },
      exactAttemptMatches: 1 as const,
      exactInventoryAdditions: 1 as const,
    },
    containerApplications: completeContainerEvidence(),
  };
}

function releaseContainerApplicationDrift(
  context: Context,
  applications: readonly ContainerApplication[],
  image: string,
): readonly string[] {
  const expectedNames = CONTAINER_CLASS_NAMES.map((className) =>
    `${context.outputs.serviceRuntimeName}-${className}`.toLowerCase()
  ).sort();
  const observedNames = applications.map((application) => application.name).sort();
  if (JSON.stringify(observedNames) !== JSON.stringify(expectedNames)) {
    return ["application-name-closure"];
  }
  return CONTAINER_CLASS_NAMES.flatMap((className) => {
    const expectedName =
      `${context.outputs.serviceRuntimeName}-${className}`.toLowerCase();
    const matches = applications.filter(
      (application) => application.name === expectedName,
    );
    const application = matches[0];
    return matches.length === 1 &&
        application?.image === image &&
        (application.state === "ready" || application.state === "active") &&
        application.health !== null &&
        application.health.failed === 0 &&
        application.health.starting === 0 &&
        application.health.scheduling === 0 &&
        application.activeRolloutId === null
      ? []
      : [expectedName];
  });
}

function rethrowBoundedReleaseOwnerError(
  context: Context,
  error: unknown,
): never {
  const mutationIssued = context.issued.some((request) => mutatesTarget(request));
  if (error instanceof ProductionDeployError) {
    const providerReadIssued = context.issued.some(
      (request) => wranglerSubcommand(request) !== null,
    );
    if (
      context.options.phase === "release-status" &&
      error.stage === "refused" &&
      providerReadIssued
    ) {
      throw new ProductionDeployError(
        "indeterminate",
        "the first-install release readback could not be observed authoritatively",
      );
    }
    if (
      context.options.phase === "release-apply" &&
      mutationIssued &&
      error.stage === "refused"
    ) {
      throw new ProductionDeployError(
        "post-conditions",
        "the acknowledged first-install release upload could not satisfy authoritative readback",
      );
    }
    throw new ProductionDeployError(error.stage, error.message);
  }
  throw new ProductionDeployError(
    mutationIssued ? "indeterminate" : "refused",
    mutationIssued
      ? "the first-install release upload may have landed and could not be proven; stop without retrying or guessing a served version"
      : "the first-install release preflight failed without exposing raw diagnostics",
  );
}

async function releaseApplyPhase(
  context: Context,
): Promise<FirstInstallReleaseApplyResult> {
  try {
    await assertReleaseOwnerPreflight(context);
    const { options, outputs } = context;
    if (!options.sourceCommit || !options.outputDigest || !options.operationId) {
      refuse("first-install release-apply identities are incomplete");
    }
    const source = await sourceIdentity(context);
    if (!source.clean || source.commit !== options.sourceCommit) {
      refuse("release-apply requires a clean checkout whose HEAD equals --source-commit");
    }
    const release = await resolveRelease(context);
    try {
      const releaseIdentity = exactOwnerReleaseIdentity(
        release,
        options.sourceCommit,
        true,
      );
      const applied = await applyPhase(context, { source, release });
      const readback =
        typeof applied.readback === "object" && applied.readback !== null
          ? applied.readback as Record<string, unknown>
          : null;
      const servedVersion = readback?.servedVersion;
      if (
        applied.outcome !== "deployed" ||
        applied.mutation !== "wrangler-deploy" ||
        typeof servedVersion !== "string" ||
        !EXACT_VERSION_ID.test(servedVersion) ||
        readback?.health !== 200
      ) {
        throw new ProductionDeployError(
          "post-conditions",
          "release-apply did not return an exact newly activated Worker readback",
        );
      }
      const attempt = releaseAttemptIdentity(
        context,
        options.sourceCommit,
        options.outputDigest,
        options.operationId,
        release.descriptorDigest!,
      );
      return {
        ownerContract: TAKOS_FIRST_INSTALL_OWNER_CONTRACT_KIND,
        kind: "takos.first-install-release-apply@v2",
        status: "applied",
        operationId: options.operationId,
        orchestrationLane: "integration",
        productEnvironment: "staging",
        sourceCommit: options.sourceCommit,
        outputDigest: options.outputDigest,
        release: releaseIdentity,
        target: {
          accountId: outputs.accountId,
          workerName: outputs.serviceRuntimeName,
          publicUrl: outputs.publicUrl,
        },
        bootstrap: { moduleVersion: outputs.moduleWorkerVersionId! },
        activated: { servedVersion },
        attempt: {
          ...attempt,
          versionId: servedVersion,
        },
        completeness: completeReleaseApplyEvidence(),
        health: { path: "/health", status: 200 },
        appliedAt: new Date().toISOString(),
      };
    } finally {
      if (release.temporaryRoot) {
        await rm(release.temporaryRoot, { recursive: true, force: true });
      }
    }
  } catch (error) {
    return rethrowBoundedReleaseOwnerError(context, error);
  }
}

async function releaseStatusPhase(
  context: Context,
): Promise<FirstInstallReleaseStatusResult> {
  let release: ReleaseBinding | null = null;
  try {
    await assertReleaseOwnerPreflight(context);
    const { options, outputs } = context;
    if (
      !options.sourceCommit ||
      !options.outputDigest ||
      !options.operationId ||
      !options.expectedServedVersion
    ) {
      refuse("first-install release-status identities are incomplete");
    }
    const source = await sourceIdentity(context);
    if (!source.clean || source.commit !== options.sourceCommit) {
      refuse("release-status requires a clean checkout whose HEAD equals --source-commit");
    }
    if (options.expectedServedVersion === outputs.moduleWorkerVersionId) {
      refuse("release-status requires a served release overlay distinct from the OpenTofu bootstrap version");
    }
    await assertReleaseSourcePhysical(context, options.sourceCommit);

    release = await resolveRelease(context);
    const releaseIdentity = exactOwnerReleaseIdentity(
      release,
      options.sourceCommit,
      false,
    );
    const observed = await observeStatus(context, release);
    const structuralDrift = [
      ...(observed.served === options.expectedServedVersion ? [] : ["served-version"]),
      ...versionBindingDrift(
        observed.detail,
        options.expectedServedVersion,
        observed.expectedBindings,
      ),
      ...(outputs.runtimeSecretsProvisioned ? [] : ["runtime-secret-output"]),
      ...exactRuntimeSecretDrift(observed.secrets),
      ...(
        observed.vector.present &&
          observed.vector.dimensions === PRODUCT_VECTOR_INDEX.dimensions &&
          observed.vector.metric === PRODUCT_VECTOR_INDEX.metric
          ? []
          : ["vectorize"]
      ),
      ...releaseContainerApplicationDrift(
        context,
        observed.containers,
        release.containerImage,
      ).map((name) => `container:${name}`),
      ...observed.pending.map(() => "durable-object"),
      ...observed.projection.droppedVars.map((name) => `worker-var:${name}`),
      ...(observed.health.status === 200 ? [] : ["health"]),
    ];
    if (structuralDrift.length > 0) {
      throw new ProductionDeployError(
        "post-conditions",
        "release-status found drift outside the exact bootstrap-to-release overlay",
      );
    }

    return {
      ownerContract: TAKOS_FIRST_INSTALL_OWNER_CONTRACT_KIND,
      kind: "takos.first-install-release-status@v2",
      status: "active",
      operationId: options.operationId,
      orchestrationLane: "integration",
      productEnvironment: "staging",
      sourceCommit: options.sourceCommit,
      outputDigest: options.outputDigest,
      release: releaseIdentity,
      target: {
        accountId: outputs.accountId,
        workerName: outputs.serviceRuntimeName,
        publicUrl: outputs.publicUrl,
      },
      bootstrap: { moduleVersion: outputs.moduleWorkerVersionId! },
      activated: { servedVersion: options.expectedServedVersion },
      runtimeSecrets: {
        provisioned: true,
        present: [...REQUIRED_RUNTIME_SECRET_NAMES],
        missing: [],
      },
      completeness: {
        containerApplications: completeContainerEvidence(),
      },
      health: { path: "/health", status: 200 },
      unrelatedDrift: [],
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return rethrowBoundedReleaseOwnerError(context, error);
  } finally {
    if (release?.temporaryRoot) {
      await rm(release.temporaryRoot, { recursive: true, force: true });
    }
  }
}

async function assertReleaseAttemptAbsent(
  context: Context,
  attempt: ReleaseAttemptIdentity,
): Promise<readonly WorkerVersionSummary[]> {
  const versions = await workerVersions(context);
  if (versions.some((version) => version.tag === attempt.tag)) {
    refuse(
      "the deterministic first-install release attempt tag already exists; use a fresh operation id and do not overwrite or retry it",
    );
  }
  return versions;
}

async function resolveReleaseAttemptVersion(
  context: Context,
  attempt: ReleaseAttemptIdentity,
  before: readonly WorkerVersionSummary[],
  upload: CommandResult | null,
  lostAcknowledgement: boolean,
): Promise<{ id: string; detail: unknown }> {
  const acknowledged = lostAcknowledgement
    ? null
    : upload !== null && upload.exitCode === 0
      ? acknowledgedVersionId(upload)
      : null;
  if (!lostAcknowledgement && acknowledged === null) {
    throw new ProductionDeployError(
      "indeterminate",
      "the first-install release upload has no authoritative acknowledgement",
    );
  }

  const after = await workerVersions(context, "indeterminate");
  const sameTag = after.filter((version) => version.tag === attempt.tag);
  const matches = sameTag.filter(
    (version) => version.message === attempt.message,
  );
  if (sameTag.length !== 1 || matches.length !== 1) {
    throw new ProductionDeployError(
      "indeterminate",
      "the release attempt did not resolve to exactly one complete-inventory tag and message match",
    );
  }
  const expected = matches[0]!.id;
  if (acknowledged !== null && acknowledged !== expected) {
    throw new ProductionDeployError(
      "indeterminate",
      "the upload acknowledgement does not match its unique complete-inventory release attempt",
    );
  }

  const beforeById = new Map(before.map((version) => [version.id, version]));
  const afterById = new Map(after.map((version) => [version.id, version]));
  const removedOrChanged = before.some((version) => {
    const observed = afterById.get(version.id);
    return observed === undefined || JSON.stringify(observed) !== JSON.stringify(version);
  });
  const added = after.filter((version) => !beforeById.has(version.id));
  if (
    removedOrChanged ||
    added.length !== 1 ||
    added[0]?.id !== expected
  ) {
    throw new ProductionDeployError(
      "indeterminate",
      "the complete Worker-version inventory does not attribute exactly one immutable addition to this release attempt",
    );
  }

  let current: string | null;
  try {
    current = await servedVersionId(context);
  } catch {
    throw new ProductionDeployError(
      "indeterminate",
      lostAcknowledgement
        ? "the release attempt current deployment could not be resolved to one exact served version"
        : "the acknowledged release upload could not read its current deployment",
    );
  }
  if (current !== expected) {
    throw new ProductionDeployError(
      "indeterminate",
      "a concurrent deployment or missing activation prevents attribution of the release attempt",
    );
  }
  const detail = await versionDetail(context, expected);
  assertAttemptVersionDetail(detail, expected, attempt);
  return { id: expected, detail };
}

async function applyPhase(
  context: Context,
  prepared?: Readonly<{
    source: SourceIdentity;
    release: ReleaseBinding;
  }>,
): Promise<Record<string, unknown>> {
  const { options } = context;
  const source = prepared?.source ?? await sourceIdentity(context);
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

  const release = prepared?.release ?? await resolveRelease(context);
  let releaseLease: ReleaseLease | null = null;
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
    const sealedRelease = options.phase === "release-apply"
      ? await sealReleasePayload(context, release)
      : null;
    const releaseAttempt = options.phase === "release-apply"
      ? releaseAttemptIdentity(
          context,
          options.sourceCommit!,
          options.outputDigest!,
          options.operationId!,
          release.descriptorDigest!,
        )
      : null;
    let releaseAttemptBefore: readonly WorkerVersionSummary[] | null = null;
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
    if (
      options.phase === "release-apply" &&
      previousVersion !== context.outputs.moduleWorkerVersionId
    ) {
      refuse(
        "the served Worker is not the retained OpenTofu bootstrap version; release-apply refuses an existing overlay",
      );
    }
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
        : `bunx wrangler versions deploy ${previousVersion}@100% --config ${context.realizedConfig} --yes`;

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
        path: context.realizedConfig,
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

    if (
      options.phase === "release-apply" &&
      sealedRelease !== null &&
      releaseAttempt !== null &&
      release.custody !== null
    ) {
      releaseLease = await acquireReleaseLease(context, releaseAttempt);
      releaseAttemptBefore = await assertReleaseAttemptAbsent(
        context,
        releaseAttempt,
      );
      await assertReleaseSourcePhysical(context, source.commit);
      await assertCustodySeal(
        release.custody.root,
        sealedRelease.custody,
        "refused",
        "release custody changed before upload",
      );
      await assertReleaseLease(
        releaseLease,
        "refused",
        "the target-scoped first-install release lease changed before upload",
      );
    }

    let upload: CommandResult | null = null;
    let lostAcknowledgement = false;
    try {
      upload = await invoke(
        context,
        wrangler([
          "deploy",
          "--config",
          context.realizedConfig,
          ...(release.bundle ? ["--no-bundle"] : []),
          ...(releaseAttempt === null
            ? []
            : [
                "--strict",
                "--containers-rollout",
                "immediate",
                "--tag",
                releaseAttempt.tag,
                "--message",
                releaseAttempt.message,
              ]),
        ]),
      );
    } catch (error) {
      if (
        options.phase === "release-apply" &&
        error instanceof ProductionDeployError &&
        error.stage === "indeterminate"
      ) {
        lostAcknowledgement = true;
      } else {
        throw error;
      }
    } finally {
      if (sealedRelease !== null && release.custody !== null) {
        await assertCustodySeal(
          release.custody.root,
          sealedRelease.custody,
          "indeterminate",
          "release custody changed during upload",
        );
      }
    }
    if (upload !== null && upload.exitCode !== 0) {
      if (options.phase === "release-apply") {
        lostAcknowledgement = true;
      } else {
        throw new ProductionDeployError(
          "indeterminate",
          `wrangler deploy failed (exit ${upload.exitCode}); the upload may or may not have landed. Read --status before any retry. Rollback: ${rollback}`,
          `${upload.stdout}${upload.stderr}`.trim(),
        );
      }
    }

    if (releaseLease !== null) {
      await assertReleaseLease(
        releaseLease,
        "indeterminate",
        "the target-scoped first-install release lease changed during upload",
      );
    }

    let readback: Record<string, unknown>;
    try {
      const attemptVersion = releaseAttempt === null
        ? null
        : await resolveReleaseAttemptVersion(
            context,
            releaseAttempt,
            releaseAttemptBefore ?? authorityInventoryFailure(
              "indeterminate",
              "the release attempt has no sealed pre-upload Worker-version inventory",
            ),
            upload,
            lostAcknowledgement,
          );
      if (attemptVersion !== null && releaseLease !== null) {
        await releaseReleaseLease(releaseLease, "indeterminate");
      }
      readback = await verifyPostConditions(context, {
        previousVersion,
        containerImage: release.containerImage,
        ...(attemptVersion === null
          ? {}
          : {
              expectedVersion: attemptVersion.id,
              versionDetail: attemptVersion.detail,
              attempt: releaseAttempt!,
              expectedBindings: sealedRelease!.expectedBindings,
            }),
      });
    } catch (error) {
      if (lostAcknowledgement) {
        throw new ProductionDeployError(
          "indeterminate",
          "the first-install release upload lost its acknowledgement and one authoritative readback could not prove the intended new overlay; do not retry blindly",
        );
      }
      throw error;
    }
    return {
      ...plan,
      outcome: "deployed",
      mutation: "wrangler-deploy",
      readback,
    };
  } finally {
    if (
      releaseLease !== null &&
      !releaseLease.released &&
      !context.issued.some((request) => mutatesTarget(request))
    ) {
      await releaseReleaseLease(releaseLease, "refused");
    }
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
        context.realizedConfig,
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
    context.options.phase === "release-apply" &&
    release.descriptor !== null &&
    release.descriptor.commit === source.commit
  ) {
    return;
  }
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
  input: Readonly<{
    previousVersion: string | null;
    containerImage: string;
    expectedVersion?: string;
    versionDetail?: unknown;
    attempt?: ReleaseAttemptIdentity;
    expectedBindings?: readonly ExpectedVersionBinding[];
  }>,
): Promise<Record<string, unknown>> {
  const served = input.expectedVersion ?? await servedVersionId(context);
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
  const detail = input.versionDetail ?? await versionDetail(context, served);
  if (input.attempt) assertAttemptVersionDetail(detail, served, input.attempt);
  const expectedBindings = input.expectedBindings ??
    expectedVersionBindingsFromRealizedConfig(
      await readFile(context.realizedConfig, "utf8"),
    );
  const bindingDrift = versionBindingDrift(detail, served, expectedBindings);
  if (bindingDrift.length > 0) {
    throw new ProductionDeployError(
      "post-conditions",
      `served version ${served} does not carry the exact binding closure: ${bindingDrift.join(", ")}`,
    );
  }

  const secrets = (await secretNames(context)) ?? [];
  const lostSecrets = context.options.phase === "release-apply"
    ? exactRuntimeSecretDrift(secrets)
    : RUNTIME_SECRET_BINDING_NAMES.filter((name) => !secrets.includes(name));
  if (lostSecrets.length > 0) {
    throw new ProductionDeployError(
      "post-conditions",
      `the upload left the Worker without the exact runtime-secret closure: ${lostSecrets.join(", ")}`,
    );
  }

  const applications = await containerApplications(context);
  const pinned = applications.filter(
    (application) => application.image === input.containerImage,
  );
  const ownerContainerDrift =
    context.options.phase === "release-apply"
      ? releaseContainerApplicationDrift(
          context,
          applications,
          input.containerImage,
        )
      : [];
  if (
    pinned.length < CONTAINER_CLASS_NAMES.length ||
    ownerContainerDrift.length > 0
  ) {
    throw new ProductionDeployError(
      "post-conditions",
      context.options.phase === "release-apply"
        ? "the exact three Takos Container applications do not carry the release image"
        : `${pinned.length} of ${CONTAINER_CLASS_NAMES.length} Container applications carry ${input.containerImage}`,
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
    case "release-apply":
      return await releaseApplyPhase(context) as unknown as Record<string, unknown>;
    case "release-status":
      return await releaseStatusPhase(context) as unknown as Record<string, unknown>;
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
    options.phase === "absence-proof" ||
    options.phase === "release-apply" ||
    options.phase === "release-status"
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
    realizedConfig: options.realizedConfig,
  };
  return { report: await execute(context), issued: context.issued };
}
