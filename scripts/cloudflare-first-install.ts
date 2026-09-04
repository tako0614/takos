import { createHash } from "node:crypto";

import { REQUIRED_RUNTIME_SECRET_NAMES } from "../src/worker/shared/config/runtime-secrets.ts";
import {
  CONTAINER_CLASS_NAMES,
  WRANGLER_TEMPLATE_PATH,
  type ModuleOutputs,
} from "./cloudflare-production-config.ts";
import {
  assertExactOwnerPrivateDirectory,
  assertOwnerPrivateFile,
  OwnerPrivateInputError,
  readOwnerPrivateFile,
} from "./owner-private-input.ts";

const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONTAINER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export const TAKOS_FIRST_INSTALL_OWNER_CONTRACT_KIND =
  "takos.first-install-owner-contract@v2" as const;

export const TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE = {
  descriptor: {
    kind: "takos.worker-artifact@v3",
    digest: "sha256",
    maxBytes: 256 * 1024,
    releaseTagPattern: "^v\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$",
    executorImagePattern:
      "^registry\\.cloudflare\\.com/[0-9a-f]{32}/takos-agent@sha256:[0-9a-f]{64}$",
    publicAgentImagePattern:
      "^ghcr\\.io/tako0614/takos-agent@sha256:[0-9a-f]{64}$",
  },
  archive: {
    digest: "sha256",
    maxCompressedBytes: 64 * 1024 * 1024,
    maxExpandedBytes: 256 * 1024 * 1024,
    maxEntries: 20_000,
    maxPathBytes: 4_096,
  },
  workerVersions: {
    method: "cloudflare-api-v4",
    pagination: "page/per_page",
    pageSize: 100,
    maxPages: 100,
    maxRows: 10_000,
    stableScans: 2,
  },
  containerApplications: {
    method: "cloudflare-api-v4",
    pagination: "per_page/page_token",
    pageSize: 100,
    maxPages: 100,
    maxRows: 10_000,
    stableScans: 2,
    detailMethod: "wrangler-containers-info",
  },
} as const;

export const TAKOS_FIRST_INSTALL_OWNER_CONTRACT = {
  kind: TAKOS_FIRST_INSTALL_OWNER_CONTRACT_KIND,
  deployContractKind: "takos.deploy-contract@v2",
  deploySurface: "takos-cloudflare-production",
  deployTarget: "cloudflare-worker:takos",
  productEnvironment: "staging",
  releaseEvidence: TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE,
  operations: [
    "runtime-secrets-install",
    "release-apply",
    "release-status",
    "functional-proof",
    "absence-proof",
  ],
  resultKinds: {
    runtimeSecretsInstall: "takos.first-install-runtime-secrets@v1",
    releaseApply: "takos.first-install-release-apply@v2",
    releaseStatus: "takos.first-install-release-status@v2",
    functionalProof: "takos.first-install-functional-proof@v1",
    absenceProof: "takos.first-install-absence@v1",
  },
  usage: {
    runtimeSecretsInstall:
      "bun run deploy -- takos-cloudflare-production --runtime-secrets-install --environment integration --outputs <absolute retained outputs.json> --output-digest sha256:<64hex> --source-commit <40hex> --operation-id <fixed id> --runtime-secret-directory <absolute 0700 directory> --cloudflare-api-token-file <absolute 0600 file> --execute",
    releaseApply:
      "bun run deploy -- takos-cloudflare-production --release-apply --environment integration --product-environment staging --outputs-file <absolute retained outputs.json> --output-digest sha256:<64hex> --source-commit <40hex> --operation-id <fixed id> --release-descriptor-file <absolute canonical descriptor.json> --cloudflare-api-token-file <absolute 0600 file> --execute",
    releaseStatus:
      "bun run deploy -- takos-cloudflare-production --release-status --environment integration --product-environment staging --outputs-file <absolute retained outputs.json> --output-digest sha256:<64hex> --source-commit <40hex> --operation-id <fixed id> --release-descriptor-file <absolute canonical descriptor.json> --cloudflare-api-token-file <absolute 0600 file> --expected-served-version <uuid>",
    functionalProof:
      "bun run first-install:functional-proof -- --environment integration --public-url <https origin> --source-commit <40hex> --served-version <uuid> --owner-session-file <absolute 0600 file>",
    absenceProof:
      "bun run deploy -- takos-cloudflare-production --absence-proof --environment integration --outputs <absolute retained outputs.json> --output-digest sha256:<64hex> --source-commit <40hex> --operation-id <fixed id> --cloudflare-api-token-file <absolute 0600 file>",
  },
} as const;

export type FirstInstallReleaseIdentity = Readonly<{
  tag: string;
  descriptor: Readonly<{
    kind: "takos.worker-artifact@v3";
    digest: string;
  }>;
  archiveDigest: string;
  executorImage: string;
  publicAgentImage: string;
}>;

export type FirstInstallReleaseTarget = Readonly<{
  accountId: string;
  workerName: string;
  publicUrl: string;
}>;

export type FirstInstallReleaseApplyResult = Readonly<{
  ownerContract: typeof TAKOS_FIRST_INSTALL_OWNER_CONTRACT_KIND;
  kind: "takos.first-install-release-apply@v2";
  status: "applied";
  operationId: string;
  orchestrationLane: "integration";
  productEnvironment: "staging";
  sourceCommit: string;
  outputDigest: string;
  release: FirstInstallReleaseIdentity;
  target: FirstInstallReleaseTarget;
  bootstrap: Readonly<{ moduleVersion: string }>;
  activated: Readonly<{ servedVersion: string }>;
  attempt: Readonly<{
    tag: string;
    message: string;
    versionId: string;
  }>;
  completeness: Readonly<{
    workerVersions: typeof TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.workerVersions & Readonly<{
      before: Readonly<{ status: "complete"; scans: 2 }>;
      after: Readonly<{ status: "complete"; scans: 2 }>;
      exactAttemptMatches: 1;
      exactInventoryAdditions: 1;
    }>;
    containerApplications:
      typeof TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.containerApplications & Readonly<{
        inventory: Readonly<{ status: "complete"; scans: 2 }>;
        exactApplicationNames: 3;
        healthyApplicationDetails: 3;
        activeRollouts: 0;
      }>;
  }>;
  health: Readonly<{ path: "/health"; status: 200 }>;
  appliedAt: string;
}>;

export type FirstInstallReleaseStatusResult = Readonly<{
  ownerContract: typeof TAKOS_FIRST_INSTALL_OWNER_CONTRACT_KIND;
  kind: "takos.first-install-release-status@v2";
  status: "active";
  operationId: string;
  orchestrationLane: "integration";
  productEnvironment: "staging";
  sourceCommit: string;
  outputDigest: string;
  release: FirstInstallReleaseIdentity;
  target: FirstInstallReleaseTarget;
  bootstrap: Readonly<{ moduleVersion: string }>;
  activated: Readonly<{ servedVersion: string }>;
  runtimeSecrets: Readonly<{
    provisioned: true;
    present: readonly string[];
    missing: readonly [];
  }>;
  completeness: Readonly<{
    containerApplications:
      typeof TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.containerApplications & Readonly<{
        inventory: Readonly<{ status: "complete"; scans: 2 }>;
        exactApplicationNames: 3;
        healthyApplicationDetails: 3;
        activeRollouts: 0;
      }>;
  }>;
  health: Readonly<{ path: "/health"; status: 200 }>;
  unrelatedDrift: readonly [];
  checkedAt: string;
}>;

export type FirstInstallRuntimeSecretsResult = Readonly<{
  kind: "takos.first-install-runtime-secrets@v1";
  status: "planned" | "installed";
  sourceCommit: string;
  outputDigest: string;
  operationId: string;
  environment: "integration" | "rehearsal" | "production";
  target: Readonly<{ accountId: string; workerName: string }>;
  bindings: readonly string[];
  attempts: readonly Readonly<{
    name: string;
    acknowledgement:
      | "planned"
      | "command-and-readback"
      | "authoritative-readback-after-lost-ack";
  }>[];
  installedAt?: string;
}>;

export type AbsenceStatus = "absent" | "present" | "indeterminate";

export type FirstInstallResourceAbsence = Readonly<{
  resourceType:
    | "worker"
    | "worker-version"
    | "worker-route"
    | "worker-custom-domain"
    | "workers.dev"
    | "d1"
    | "kv"
    | "r2"
    | "queue"
    | "vectorize"
    | "container-application";
  name: string;
  status: AbsenceStatus;
  evidence: "404" | "list-complete" | "disabled" | "not-applicable" | "api-indeterminate";
}>;

export type FirstInstallAbsenceResult = Readonly<{
  kind: "takos.first-install-absence@v1";
  status: AbsenceStatus;
  sourceCommit: string;
  outputDigest: string;
  operationId: string;
  environment: "integration" | "rehearsal" | "production";
  target: Readonly<{ accountId: string; workerName: string }>;
  checkedAt: string;
  resources: readonly FirstInstallResourceAbsence[];
  summary: Readonly<Record<AbsenceStatus, number>>;
}>;

export type FirstInstallCommandRequest = Readonly<{
  command: string;
  args: readonly string[];
  cwd?: string;
  stdinFile?: string;
  cloudflareApiTokenFile?: string;
  cloudflareAccountId?: string;
}>;

export type FirstInstallCommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type CloudflareApiRequest = Readonly<{
  method: "GET";
  path: string;
  query?: Readonly<Record<string, string>>;
  cloudflareApiTokenFile: string;
}>;

export type CloudflareApiResponse = Readonly<{
  status: number;
  body: unknown;
}>;

export type CloudflareListPagination = "numbered" | "cursor";

export type CloudflareListResult = Readonly<
  | { status: "complete"; rows: readonly Readonly<Record<string, unknown>>[] }
  | { status: "indeterminate" }
>;

export class FirstInstallOwnerError extends Error {
  readonly exitCode: number;
  readonly stage: "refused" | "indeterminate" | "post-conditions";

  constructor(
    stage: "refused" | "indeterminate" | "post-conditions",
    message: string,
  ) {
    super(message);
    this.name = "FirstInstallOwnerError";
    this.stage = stage;
    this.exitCode = stage === "refused" ? 2 : stage === "indeterminate" ? 3 : 4;
  }
}

type CommonInput = Readonly<{
  environment: "integration" | "rehearsal" | "production";
  sourceCommit: string;
  outputDigest: string;
  operationId: string;
  cloudflareApiTokenFile: string;
  repositoryRoot: string;
  outputs: ModuleOutputs;
  now?: () => Date;
}>;

function refuse(message: string): never {
  throw new FirstInstallOwnerError("refused", message);
}

function indeterminate(message: string): never {
  throw new FirstInstallOwnerError("indeterminate", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCommon(input: CommonInput): void {
  if (!COMMIT.test(input.sourceCommit)) refuse("source commit must be a full lowercase commit id");
  if (!DIGEST.test(input.outputDigest)) refuse("output digest must be sha256:<64 lowercase hex>");
  if (!OPERATION_ID.test(input.operationId)) refuse("operation id is not a bounded fixed identity");
  for (const [label, value] of [
    ["Worker name", input.outputs.serviceRuntimeName],
    ["public hostname", input.outputs.publicHostname],
    ["D1 name", input.outputs.d1.name],
    ["D1 id", input.outputs.d1.id],
    ["KV id", input.outputs.kvNamespaceIds.hostname_routing],
    ["Vectorize name", input.outputs.vectorIndex.name],
    ...Object.entries(input.outputs.objectBuckets).map(
      ([name, value]) => [`R2 ${name}`, value] as const,
    ),
    ...Object.entries(input.outputs.queues).map(
      ([name, value]) => [`Queue ${name}`, value] as const,
    ),
  ] as const) {
    if (
      value.length === 0 ||
      value.length > 255 ||
      hasAsciiControlCharacter(value)
    ) {
      refuse(`${label} is not a bounded non-control output identity`);
    }
  }
  const moduleNames = [...input.outputs.runtimeSecretBindingNames].sort();
  if (
    JSON.stringify(moduleNames) !==
      JSON.stringify([...REQUIRED_RUNTIME_SECRET_NAMES].sort())
  ) {
    refuse("module outputs do not declare the exact Takos runtime-secret closure");
  }
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function secretListRequest(
  outputs: ModuleOutputs,
  tokenFile: string,
  repositoryRoot: string,
): FirstInstallCommandRequest {
  return {
    command: "bunx",
    args: [
      "wrangler",
      "secret",
      "list",
      "--name",
      outputs.serviceRuntimeName,
      "--config",
      WRANGLER_TEMPLATE_PATH,
      "--format",
      "json",
    ],
    cwd: repositoryRoot,
    cloudflareApiTokenFile: tokenFile,
    cloudflareAccountId: outputs.accountId,
  };
}

function parseSecretNames(
  result: FirstInstallCommandResult,
  failureStage: "refused" | "indeterminate",
): readonly string[] {
  const failReadback = (message: string): never =>
    failureStage === "refused" ? refuse(message) : indeterminate(message);
  if (result.exitCode !== 0) {
    return failReadback("authoritative runtime-secret name readback failed");
  }
  if (result.stdout.length > 1024 * 1024) {
    return failReadback("authoritative runtime-secret name readback exceeded its size bound");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.slice(Math.max(0, result.stdout.indexOf("["))));
  } catch {
    return failReadback("authoritative runtime-secret name readback was not JSON");
  }
  if (!Array.isArray(parsed)) return failReadback("runtime-secret readback returned no list");
  if (parsed.length > 1024) {
    return failReadback("runtime-secret name readback exceeded its row bound");
  }
  const names: string[] = [];
  for (const entry of parsed) {
    const name = typeof entry === "object" && entry !== null
      ? (entry as Record<string, unknown>).name
      : null;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > 255 ||
      hasAsciiControlCharacter(name)
    ) {
      return failReadback("runtime-secret readback contained a malformed name row");
    }
    names.push(name);
  }
  return names;
}

export async function runFirstInstallRuntimeSecrets(
  input: CommonInput & Readonly<{
    execute: boolean;
    runtimeSecretDirectory: string;
  }>,
  run: (request: FirstInstallCommandRequest) => Promise<FirstInstallCommandResult>,
): Promise<FirstInstallRuntimeSecretsResult> {
  validateCommon(input);
  let tokenFile: string;
  let secretFiles: Readonly<Record<string, string>>;
  try {
    tokenFile = await assertOwnerPrivateFile(input.cloudflareApiTokenFile, {
      repositoryRoot: input.repositoryRoot,
      maxBytes: 8 * 1024,
    });
    if ((await readOwnerPrivateFile(tokenFile, {
      repositoryRoot: input.repositoryRoot,
      maxBytes: 8 * 1024,
    })).trim().length === 0) {
      refuse("Cloudflare API token file is empty");
    }
    secretFiles = await assertExactOwnerPrivateDirectory(
      input.runtimeSecretDirectory,
      REQUIRED_RUNTIME_SECRET_NAMES,
      { repositoryRoot: input.repositoryRoot, maxFileBytes: 256 * 1024 },
    );
    for (const name of REQUIRED_RUNTIME_SECRET_NAMES) {
      if ((await readOwnerPrivateFile(secretFiles[name], {
        repositoryRoot: input.repositoryRoot,
        maxBytes: 256 * 1024,
      })).trim().length === 0) {
        refuse(`runtime secret file ${name} is empty`);
      }
    }
  } catch (error) {
    if (error instanceof FirstInstallOwnerError) throw error;
    if (error instanceof OwnerPrivateInputError) refuse(error.message);
    return refuse("owner-private runtime-secret inputs could not be validated");
  }

  const base = {
    kind: "takos.first-install-runtime-secrets@v1" as const,
    sourceCommit: input.sourceCommit,
    outputDigest: input.outputDigest,
    operationId: input.operationId,
    environment: input.environment,
    target: {
      accountId: input.outputs.accountId,
      workerName: input.outputs.serviceRuntimeName,
    },
    bindings: [...REQUIRED_RUNTIME_SECRET_NAMES],
  };
  if (!input.execute) {
    return {
      ...base,
      status: "planned",
      attempts: REQUIRED_RUNTIME_SECRET_NAMES.map((name) => ({
        name,
        acknowledgement: "planned" as const,
      })),
    };
  }

  let initialReadback: FirstInstallCommandResult;
  try {
    initialReadback = await run(
      secretListRequest(input.outputs, tokenFile, input.repositoryRoot),
    );
  } catch {
    return refuse("authoritative runtime-secret name preflight could not be issued");
  }
  let before = parseSecretNames(initialReadback, "refused");
  const attempts: Array<{
    name: string;
    acknowledgement:
      | "command-and-readback"
      | "authoritative-readback-after-lost-ack";
  }> = [];
  for (const name of REQUIRED_RUNTIME_SECRET_NAMES) {
    const wasPresent = before.includes(name);
    let result: FirstInstallCommandResult;
    try {
      result = await run({
        command: "bunx",
        args: [
          "wrangler",
          "secret",
          "put",
          name,
          "--name",
          input.outputs.serviceRuntimeName,
          "--config",
          WRANGLER_TEMPLATE_PATH,
        ],
        cwd: input.repositoryRoot,
        stdinFile: secretFiles[name],
        cloudflareApiTokenFile: tokenFile,
        cloudflareAccountId: input.outputs.accountId,
      });
    } catch {
      // A thrown child transport can occur after Wrangler sent the request.
      // Treat it as a lost acknowledgement, discard its raw diagnostics, and
      // proceed only through the same authoritative name readback as an exit.
      result = { exitCode: 1, stdout: "", stderr: "" };
    }
    let afterResult: FirstInstallCommandResult;
    try {
      afterResult = await run(
        secretListRequest(input.outputs, tokenFile, input.repositoryRoot),
      );
    } catch {
      return indeterminate(
        `runtime secret ${name} authoritative readback could not be issued; do not retry blindly`,
      );
    }
    const after = parseSecretNames(afterResult, "indeterminate");
    const present = after.includes(name);
    if (!present) {
      return indeterminate(
        `runtime secret ${name} did not appear in authoritative name readback; do not retry blindly`,
      );
    }
    if (result.exitCode !== 0 && wasPresent) {
      return indeterminate(
        `runtime secret ${name} upload lost acknowledgement and pre-existing name readback cannot prove the new value; do not retry blindly`,
      );
    }
    attempts.push({
      name,
      acknowledgement:
        result.exitCode === 0
          ? "command-and-readback"
          : "authoritative-readback-after-lost-ack",
    });
    before = after;
  }
  let finalReadback: FirstInstallCommandResult;
  try {
    finalReadback = await run(
      secretListRequest(input.outputs, tokenFile, input.repositoryRoot),
    );
  } catch {
    return indeterminate("final runtime-secret readback could not be issued; do not retry blindly");
  }
  const finalNames = parseSecretNames(finalReadback, "indeterminate");
  const missing = REQUIRED_RUNTIME_SECRET_NAMES.filter(
    (name) => !finalNames.includes(name),
  );
  if (missing.length > 0) {
    return indeterminate(
      `final runtime-secret readback is missing ${missing.join(", ")}; do not retry blindly`,
    );
  }
  return {
    ...base,
    status: "installed",
    attempts,
    installedAt: (input.now ?? (() => new Date()))().toISOString(),
  };
}

type ApiEnvelope = Readonly<{
  success?: boolean;
  errors?: unknown;
  messages?: unknown;
  result?: unknown;
  result_info?: Readonly<Record<string, unknown>>;
}>;

function envelope(response: CloudflareApiResponse): ApiEnvelope | null {
  return typeof response.body === "object" && response.body !== null
    ? response.body as ApiEnvelope
    : null;
}

async function getResource(
  api: (request: CloudflareApiRequest) => Promise<CloudflareApiResponse>,
  tokenFile: string,
  path: string,
): Promise<{ status: AbsenceStatus; evidence: FirstInstallResourceAbsence["evidence"]; result?: unknown }> {
  let response: CloudflareApiResponse;
  try {
    response = await api({ method: "GET", path, cloudflareApiTokenFile: tokenFile });
  } catch {
    return { status: "indeterminate", evidence: "api-indeterminate" };
  }
  if (response.status === 404) return { status: "absent", evidence: "404" };
  const body = envelope(response);
  if (
    response.status >= 200 &&
    response.status < 300 &&
    body?.success === true &&
    Object.prototype.hasOwnProperty.call(body, "result")
  ) {
    return { status: "present", evidence: "list-complete", result: body?.result };
  }
  return { status: "indeterminate", evidence: "api-indeterminate" };
}

function resultRows(value: unknown): readonly Record<string, unknown>[] | null {
  const rows: unknown[] | null = Array.isArray(value)
    ? value as unknown[]
    : typeof value === "object" && value !== null &&
        Array.isArray((value as Record<string, unknown>).items)
      ? (value as Record<string, unknown>).items as unknown[]
      : null;
  if (
    !rows ||
    rows.some((row) => typeof row !== "object" || row === null || Array.isArray(row))
  ) return null;
  return rows as Record<string, unknown>[];
}

export const CLOUDFLARE_COMPLETE_LIST = {
  pageSize: TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.workerVersions.pageSize,
  maxPages: TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.workerVersions.maxPages,
  maxRows: TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.workerVersions.maxRows,
  stableScans: TAKOS_FIRST_INSTALL_RELEASE_EVIDENCE.workerVersions.stableScans,
} as const;

/**
 * Reads one complete, bounded Cloudflare list without relying on a CLI's
 * display limit. Authority-sensitive callers opt in to the exact V4 envelope;
 * older absence endpoints share the same bounded traversal while retaining
 * their historically looser envelope compatibility.
 */
export async function listCloudflareApiRows(
  api: (request: CloudflareApiRequest) => Promise<CloudflareApiResponse>,
  input: Readonly<{
    tokenFile: string;
    path: string;
    pagination: CloudflareListPagination;
    resultShape: "array" | "items";
    exactEnvelope: boolean;
  }>,
): Promise<CloudflareListResult> {
  const rows: Record<string, unknown>[] = [];
  const seenPageTokens = new Set<string>();
  let page = 1;
  let pageToken: string | undefined;
  let expectedTotalCount: number | undefined;
  let expectedTotalPages: number | undefined;

  for (
    let requestCount = 0;
    requestCount < CLOUDFLARE_COMPLETE_LIST.maxPages;
    requestCount += 1
  ) {
    let response: CloudflareApiResponse;
    try {
      response = await api({
        method: "GET",
        path: input.path,
        query: {
          per_page: String(CLOUDFLARE_COMPLETE_LIST.pageSize),
          ...(input.pagination === "cursor"
            ? (pageToken === undefined ? {} : { page_token: pageToken })
            : { page: String(page) }),
        },
        cloudflareApiTokenFile: input.tokenFile,
      });
    } catch {
      return { status: "indeterminate" };
    }

    const body = envelope(response);
    if (
      response.status !== 200 ||
      !body ||
      body.success !== true ||
      (input.exactEnvelope &&
        (!Array.isArray(body.errors) || !Array.isArray(body.messages))) ||
      !Object.prototype.hasOwnProperty.call(body, "result") ||
      !isRecord(body.result_info)
    ) {
      return { status: "indeterminate" };
    }
    const pageRows = input.resultShape === "items"
      ? isRecord(body.result) && Array.isArray(body.result.items)
        ? resultRows(body.result)
        : null
      : Array.isArray(body.result)
        ? resultRows(body.result)
        : null;
    if (
      pageRows === null ||
      pageRows.length > CLOUDFLARE_COMPLETE_LIST.pageSize ||
      rows.length + pageRows.length > CLOUDFLARE_COMPLETE_LIST.maxRows
    ) {
      return { status: "indeterminate" };
    }
    rows.push(...pageRows);

    const info = body.result_info;
    if (input.pagination === "cursor") {
      if (
        info.count !== undefined &&
        (typeof info.count !== "number" ||
          !Number.isSafeInteger(info.count) ||
          info.count !== pageRows.length)
      ) {
        return { status: "indeterminate" };
      }
      const nextToken = info.next_page_token;
      if (nextToken === undefined || nextToken === null) {
        return { status: "complete", rows };
      }
      if (
        typeof nextToken !== "string" ||
        nextToken.length === 0 ||
        nextToken.length > 2_048 ||
        hasAsciiControlCharacter(nextToken) ||
        seenPageTokens.has(nextToken)
      ) {
        return { status: "indeterminate" };
      }
      seenPageTokens.add(nextToken);
      pageToken = nextToken;
      continue;
    }

    const numeric = (name: string): number | undefined => {
      const value = info[name];
      return typeof value === "number" && Number.isSafeInteger(value)
        ? value
        : undefined;
    };
    const observedPage = numeric("page");
    const observedPerPage = numeric("per_page");
    const observedCount = numeric("count");
    const totalCount = numeric("total_count");
    const totalPages = numeric("total_pages");
    if (
      totalPages === undefined ||
      totalPages < 0 ||
      totalPages > CLOUDFLARE_COMPLETE_LIST.maxPages ||
      (input.exactEnvelope &&
        (observedPage !== page ||
          observedPerPage !== CLOUDFLARE_COMPLETE_LIST.pageSize ||
          observedCount !== pageRows.length ||
          totalCount === undefined ||
          totalCount < 0))
    ) {
      return { status: "indeterminate" };
    }
    if (expectedTotalPages === undefined) {
      expectedTotalPages = totalPages;
      expectedTotalCount = totalCount;
    } else if (
      totalPages !== expectedTotalPages ||
      (input.exactEnvelope && totalCount !== expectedTotalCount)
    ) {
      return { status: "indeterminate" };
    }
    if (totalPages === 0) {
      return page === 1 && rows.length === 0 &&
          (!input.exactEnvelope || expectedTotalCount === 0)
        ? { status: "complete", rows }
        : { status: "indeterminate" };
    }
    if (page > totalPages) return { status: "indeterminate" };
    if (page < totalPages) {
      page += 1;
      continue;
    }
    if (input.exactEnvelope && rows.length !== expectedTotalCount) {
      return { status: "indeterminate" };
    }
    return { status: "complete", rows };
  }
  return { status: "indeterminate" };
}

async function listResourceNames(
  api: (request: CloudflareApiRequest) => Promise<CloudflareApiResponse>,
  tokenFile: string,
  path: string,
  nameOf: (row: Record<string, unknown>) => string | null,
  pagination: CloudflareListPagination = "numbered",
): Promise<Readonly<{ status: "complete"; names: readonly string[] } | { status: "indeterminate" }>> {
  const listing = await listCloudflareApiRows(api, {
    tokenFile,
    path,
    pagination,
    resultShape: "array",
    exactEnvelope: false,
  });
  if (listing.status === "indeterminate") return listing;
  const names: string[] = [];
  try {
    for (const entry of listing.rows) {
      const name = nameOf(entry as Record<string, unknown>);
      if (name) names.push(name);
    }
  } catch {
    return { status: "indeterminate" };
  }
  return { status: "complete", names };
}

function row(
  resourceType: FirstInstallResourceAbsence["resourceType"],
  name: string,
  state: Pick<FirstInstallResourceAbsence, "status" | "evidence">,
): FirstInstallResourceAbsence {
  return { resourceType, name, ...state };
}

function listRows(
  resourceType: FirstInstallResourceAbsence["resourceType"],
  expected: readonly string[],
  listing: Readonly<{ status: "complete"; names: readonly string[] } | { status: "indeterminate" }>,
): FirstInstallResourceAbsence[] {
  if (listing.status === "indeterminate") {
    return expected.map((name) => row(resourceType, name, {
      status: "indeterminate",
      evidence: "api-indeterminate",
    }));
  }
  return expected.map((name) => row(resourceType, name, {
    status: listing.names.includes(name) ? "present" : "absent",
    evidence: "list-complete",
  }));
}

export async function runFirstInstallAbsenceProof(
  input: CommonInput,
  api: (request: CloudflareApiRequest) => Promise<CloudflareApiResponse>,
): Promise<FirstInstallAbsenceResult> {
  validateCommon(input);
  let tokenFile: string;
  try {
    tokenFile = await assertOwnerPrivateFile(input.cloudflareApiTokenFile, {
      repositoryRoot: input.repositoryRoot,
      maxBytes: 8 * 1024,
    });
    if ((await readOwnerPrivateFile(tokenFile, {
      repositoryRoot: input.repositoryRoot,
      maxBytes: 8 * 1024,
    })).trim().length === 0) {
      refuse("Cloudflare API token file is empty");
    }
  } catch (error) {
    if (error instanceof FirstInstallOwnerError) throw error;
    if (error instanceof OwnerPrivateInputError) refuse(error.message);
    return refuse("owner-private Cloudflare credential could not be validated");
  }
  const { outputs } = input;
  const account = `/accounts/${encodeURIComponent(outputs.accountId)}`;
  const workerName = encodeURIComponent(outputs.serviceRuntimeName);
  const resources: FirstInstallResourceAbsence[] = [];

  resources.push(row(
    "worker",
    outputs.serviceRuntimeName,
    await getResource(api, tokenFile, `${account}/workers/scripts/${workerName}/settings`),
  ));
  if (outputs.moduleWorkerVersionId) {
    resources.push(row(
      "worker-version",
      outputs.moduleWorkerVersionId,
      await getResource(
        api,
        tokenFile,
        `${account}/workers/scripts/${workerName}/versions/${encodeURIComponent(outputs.moduleWorkerVersionId)}`,
      ),
    ));
  } else {
    resources.push(row("worker-version", `${outputs.serviceRuntimeName}:any`, {
      status: "indeterminate",
      evidence: "api-indeterminate",
    }));
  }

  const zoneId = outputs.workerEnv.CF_ZONE_ID?.trim();
  if (zoneId) {
    const routes = await listResourceNames(
      api,
      tokenFile,
      `/zones/${encodeURIComponent(zoneId)}/workers/routes`,
      (entry) => {
        if (typeof entry.script !== "string" || typeof entry.pattern !== "string") {
          throw new Error("malformed Worker route row");
        }
        return entry.script === outputs.serviceRuntimeName ? entry.pattern : null;
      },
    );
    const [route] = listRows(
      "worker-route",
      [`${outputs.publicHostname}/*`],
      routes,
    );
    // The retained owner receipt identifies the authoritative hostname. The
    // Cloudflare route pattern is only the provider-side lookup key and must
    // not leak into the versioned 22-row coordinator contract.
    resources.push({ ...route, name: outputs.publicHostname });
  } else {
    resources.push(row("worker-route", outputs.publicHostname, {
      status: "absent",
      evidence: "not-applicable",
    }));
  }

  if (!outputs.publicHostname.endsWith(".workers.dev")) {
    const domains = await listResourceNames(
      api,
      tokenFile,
      `${account}/workers/domains`,
      (entry) => {
        if (typeof entry.service !== "string" || typeof entry.hostname !== "string") {
          throw new Error("malformed Worker custom-domain row");
        }
        return entry.service === outputs.serviceRuntimeName ? entry.hostname : null;
      },
    );
    resources.push(...listRows(
      "worker-custom-domain",
      [outputs.publicHostname],
      domains,
    ));
  } else {
    resources.push(row("worker-custom-domain", outputs.publicHostname, {
      status: "absent",
      evidence: "not-applicable",
    }));
  }

  const subdomain = await getResource(
    api,
    tokenFile,
    `${account}/workers/scripts/${workerName}/subdomain`,
  );
  if (subdomain.status !== "present") {
    resources.push(row("workers.dev", outputs.serviceRuntimeName, subdomain));
  } else if (
    typeof subdomain.result !== "object" ||
    subdomain.result === null ||
    typeof (subdomain.result as Record<string, unknown>).enabled !== "boolean"
  ) {
    resources.push(row("workers.dev", outputs.serviceRuntimeName, {
      status: "indeterminate",
      evidence: "api-indeterminate",
    }));
  } else if ((subdomain.result as Record<string, unknown>).enabled === false) {
    resources.push(row("workers.dev", outputs.serviceRuntimeName, {
      status: "absent",
      evidence: "disabled",
    }));
  } else {
    resources.push(row("workers.dev", outputs.serviceRuntimeName, subdomain));
  }

  resources.push(row(
    "d1",
    outputs.d1.name,
    await getResource(api, tokenFile, `${account}/d1/database/${encodeURIComponent(outputs.d1.id)}`),
  ));
  resources.push(row(
    "kv",
    outputs.kvNamespaceIds.hostname_routing,
    await getResource(
      api,
      tokenFile,
      `${account}/storage/kv/namespaces/${encodeURIComponent(outputs.kvNamespaceIds.hostname_routing)}`,
    ),
  ));
  for (const bucket of Object.values(outputs.objectBuckets)) {
    resources.push(row(
      "r2",
      bucket,
      await getResource(api, tokenFile, `${account}/r2/buckets/${encodeURIComponent(bucket)}`),
    ));
  }

  const queueNames = Object.values(outputs.queues);
  resources.push(...listRows(
    "queue",
    queueNames,
    await listResourceNames(
      api,
      tokenFile,
      `${account}/queues`,
      (entry) => {
        if (typeof entry.queue_name === "string") return entry.queue_name;
        if (typeof entry.name === "string") return entry.name;
        throw new Error("malformed Queue row");
      },
    ),
  ));
  resources.push(row(
    "vectorize",
    outputs.vectorIndex.name,
    await getResource(
      api,
      tokenFile,
      `${account}/vectorize/v2/indexes/${encodeURIComponent(outputs.vectorIndex.name)}`,
    ),
  ));
  const containerNames = CONTAINER_CLASS_NAMES.map(
    (className) => `${outputs.serviceRuntimeName}-${className}`.toLowerCase(),
  );
  resources.push(...listRows(
    "container-application",
    containerNames,
    await listResourceNames(
      api,
      tokenFile,
      `${account}/containers/dash/applications`,
      (entry) => {
        if (typeof entry.name !== "string") {
          throw new Error("malformed Container application row");
        }
        return entry.name;
      },
      "cursor",
    ),
  ));

  const summary: Record<AbsenceStatus, number> = {
    absent: 0,
    present: 0,
    indeterminate: 0,
  };
  for (const resource of resources) summary[resource.status] += 1;
  const status: AbsenceStatus = summary.present > 0
    ? "present"
    : summary.indeterminate > 0
      ? "indeterminate"
      : "absent";
  return {
    kind: "takos.first-install-absence@v1",
    status,
    sourceCommit: input.sourceCommit,
    outputDigest: input.outputDigest,
    operationId: input.operationId,
    environment: input.environment,
    target: {
      accountId: outputs.accountId,
      workerName: outputs.serviceRuntimeName,
    },
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    resources,
    summary,
  };
}

export async function defaultCloudflareApi(
  request: CloudflareApiRequest,
  repositoryRoot: string,
): Promise<CloudflareApiResponse> {
  if (request.method !== "GET" || !request.path.startsWith("/")) {
    return refuse("Cloudflare absence proof permits fixed GET paths only");
  }
  const token = (await readOwnerPrivateFile(request.cloudflareApiTokenFile, {
    repositoryRoot,
    maxBytes: 8 * 1024,
  })).trim();
  if (!token) return refuse("Cloudflare API token file is empty");
  const url = new URL(`https://api.cloudflare.com/client/v4${request.path}`);
  for (const [name, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(name, value);
  }
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await readBoundedResponseText(response, 4 * 1024 * 1024);
  if (text === null) {
    return { status: 599, body: null };
  }
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: null };
  }
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export function digestBytes(bytes: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function isExecutorContainerId(value: unknown): value is string {
  return typeof value === "string" && CONTAINER_ID.test(value);
}
