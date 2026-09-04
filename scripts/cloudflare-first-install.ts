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

export const TAKOS_FIRST_INSTALL_OWNER_CONTRACT = {
  kind: "takos.first-install-owner-contract@v1",
  deployContractKind: "takos.deploy-contract@v2",
  deploySurface: "takos-cloudflare-production",
  operations: [
    "runtime-secrets-install",
    "functional-proof",
    "absence-proof",
  ],
  resultKinds: {
    runtimeSecretsInstall: "takos.first-install-runtime-secrets@v1",
    functionalProof: "takos.first-install-functional-proof@v1",
    absenceProof: "takos.first-install-absence@v1",
  },
  usage: {
    runtimeSecretsInstall:
      "bun run deploy -- takos-cloudflare-production --runtime-secrets-install --environment integration --outputs <absolute retained outputs.json> --output-digest sha256:<64hex> --source-commit <40hex> --operation-id <fixed id> --runtime-secret-directory <absolute 0700 directory> --cloudflare-api-token-file <absolute 0600 file> --execute",
    functionalProof:
      "bun run first-install:functional-proof -- --environment integration --public-url <https origin> --source-commit <40hex> --served-version <uuid> --owner-session-file <absolute 0600 file>",
    absenceProof:
      "bun run deploy -- takos-cloudflare-production --absence-proof --environment integration --outputs <absolute retained outputs.json> --output-digest sha256:<64hex> --source-commit <40hex> --operation-id <fixed id> --cloudflare-api-token-file <absolute 0600 file>",
  },
} as const;

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

async function listResourceNames(
  api: (request: CloudflareApiRequest) => Promise<CloudflareApiResponse>,
  tokenFile: string,
  path: string,
  nameOf: (row: Record<string, unknown>) => string | null,
): Promise<Readonly<{ status: "complete"; names: readonly string[] } | { status: "indeterminate" }>> {
  const names: string[] = [];
  let page = 1;
  let pageToken: string | undefined;
  for (let requestCount = 0; requestCount < 100; requestCount += 1) {
    let response: CloudflareApiResponse;
    try {
      response = await api({
        method: "GET",
        path,
        query: {
          per_page: "100",
          ...(pageToken ? { page_token: pageToken } : { page: String(page) }),
        },
        cloudflareApiTokenFile: tokenFile,
      });
    } catch {
      return { status: "indeterminate" };
    }
    const body = envelope(response);
    if (
      response.status !== 200 ||
      !body ||
      body.success !== true
    ) {
      return { status: "indeterminate" };
    }
    const rows = resultRows(body.result);
    if (!rows) return { status: "indeterminate" };
    try {
      for (const row of rows) {
        const name = nameOf(row);
        if (name) names.push(name);
      }
    } catch {
      return { status: "indeterminate" };
    }
    if (
      body.result_info !== undefined &&
      (typeof body.result_info !== "object" || body.result_info === null)
    ) {
      return { status: "indeterminate" };
    }
    const info = body.result_info ?? {};
    const nextToken =
      typeof info.next_page_token === "string" && info.next_page_token.length > 0
        ? info.next_page_token
        : null;
    if (nextToken) {
      if (nextToken.length > 2_048 || hasAsciiControlCharacter(nextToken)) {
        return { status: "indeterminate" };
      }
      if (nextToken === pageToken) return { status: "indeterminate" };
      pageToken = nextToken;
      continue;
    }
    if (info.total_pages === undefined) {
      return rows.length < 100
        ? { status: "complete", names }
        : { status: "indeterminate" };
    }
    const totalPages = Number(info.total_pages);
    if (!Number.isSafeInteger(totalPages) || totalPages < page) {
      return { status: "indeterminate" };
    }
    if (page < totalPages) {
      page += 1;
      continue;
    }
    return { status: "complete", names };
  }
  return { status: "indeterminate" };
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
