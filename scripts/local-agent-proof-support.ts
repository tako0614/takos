import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";
import { lstat, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

export const AGENT_SOURCE_FINGERPRINT_LABEL = "jp.takos.agent.source-sha256";

const AGENT_BUILD_INPUTS = [
  ".dockerignore",
  "takos/containers/agent/Cargo.toml",
  "takos/containers/agent/Cargo.lock",
  "takos/containers/agent/Dockerfile",
  "takos/containers/agent/src",
  "takos-agent-engine/Cargo.toml",
  "takos-agent-engine/Cargo.lock",
  "takos-agent-engine/src",
] as const;

type DockerCommandResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

type DockerCommandOptions = {
  readonly check: false;
  readonly env: Record<string, string>;
  readonly timeoutMs: number;
};

export type LocalProofDockerRunner = (
  args: string[],
  options: DockerCommandOptions,
) => Promise<DockerCommandResult>;

type ProjectResources = {
  readonly containers: readonly string[];
  readonly volumes: readonly string[];
  readonly networks: readonly string[];
  readonly images: readonly string[];
};

export type AgentImageProof = {
  readonly kind: "takos.local-agent-image-proof@v1";
  readonly imageId: string;
  readonly sourceFingerprint: string;
  readonly sourceFingerprintMatched: true;
};

export type ExpectedPublishedPort = {
  readonly service: string;
  readonly target: number;
  readonly published: string;
};

export type LocalProofSignal = "SIGINT" | "SIGTERM";

export type LocalProofInterruption = {
  readonly signal: AbortSignal;
  readonly receivedSignal: LocalProofSignal | null;
  readonly exitCode: number;
  interrupt(signal: LocalProofSignal): boolean;
};

export type LocalProofSignalTarget = {
  once(signal: LocalProofSignal, listener: () => void): unknown;
  off(signal: LocalProofSignal, listener: () => void): unknown;
};

export type LocalE2eCleanupInput = {
  readonly composeArgs: string[];
  readonly commandEnv: Record<string, string>;
  readonly project: string;
  readonly runDocker: LocalProofDockerRunner;
  readonly coreArtifactPaths?: readonly string[];
};

type JsonRecord = Record<string, unknown>;

export function assertFreshAgentProofBuild(
  skipBuild: string | undefined,
): void {
  if (skipBuild?.trim() === "1") {
    throw new Error(
      "TAKOS_LOCAL_E2E_SKIP_BUILD=1 is not allowed for local agent proof; a fresh source-verified image build is required",
    );
  }
}

export function createOfficialAgentProofEnvironment(
  dependencies: {
    readonly pid?: number;
    readonly now?: () => number;
    readonly randomUUID?: () => string;
  } = {},
): Record<string, string> {
  const pid = dependencies.pid ?? process.pid;
  const now = dependencies.now ?? Date.now;
  const randomUUID = dependencies.randomUUID ?? nodeRandomUUID;
  const projectNonce = randomUUID()
    .replace(/[^a-z0-9]/giu, "")
    .toLowerCase()
    .slice(0, 20);
  if (!projectNonce) {
    throw new Error("unable to generate an isolated local proof project name");
  }
  const internalSecret = `local-proof-internal-${randomUUID()}`;

  return {
    TAKOS_LOCAL_E2E_PROJECT: `takos-agent-proof-${pid}-${now().toString(36)}-${projectNonce}`,
    TAKOS_LOCAL_E2E_SKIP_BUILD: "0",
    TAKOS_LOCAL_E2E_KEEP_STACK: "0",
    TAKOS_WORKER_PORT: "8787",
    TAKOSUMI_PORT: "8788",
    TAKOS_AGENT_PORT: "8789",
    TAKOS_WORKER_HOST_PORT: "0",
    TAKOSUMI_HOST_PORT: "0",
    TAKOS_AGENT_HOST_PORT: "0",
    TAKOS_AGENT_PROOF_PORT: "0",
    TAKOS_POSTGRES_PORT: "0",
    TAKOS_REDIS_PORT: "0",
    TAKOS_WORKER_URL: "",
    TAKOS_INTERNAL_SERVICE_SECRET: internalSecret,
    TAKOS_INTERNAL_API_SECRET: internalSecret,
    TAKOSUMI_INTERNAL_API_SECRET: internalSecret,
    TAKOS_AGENT_START_TOKEN: `local-proof-start-${randomUUID()}`,
    TAKOS_AGENT_PROOF_SECRET: `local-proof-bootstrap-${randomUUID()}`,
    TAKOS_AGENT_PROOF_DISPATCH_SECRET: `local-proof-dispatch-${randomUUID()}`,
    TAKOS_AGENT_PROOF_MODEL_KEY: `local-proof-model-${randomUUID()}`,
  };
}

export function createLocalProofInterruption(): LocalProofInterruption {
  const controller = new AbortController();
  let receivedSignal: LocalProofSignal | null = null;
  return {
    signal: controller.signal,
    get receivedSignal() {
      return receivedSignal;
    },
    get exitCode() {
      return receivedSignal === "SIGINT"
        ? 130
        : receivedSignal === "SIGTERM"
          ? 143
          : 1;
    },
    interrupt(signal) {
      if (receivedSignal) return false;
      receivedSignal = signal;
      controller.abort(new Error(`local E2E interrupted by ${signal}`));
      return true;
    },
  };
}

export function installLocalProofSignalHandlers(input: {
  readonly interruption: LocalProofInterruption;
  readonly target?: LocalProofSignalTarget;
  readonly onInterrupt?: (signal: LocalProofSignal) => void;
}): () => void {
  const target = input.target ?? process;
  let installed = true;
  const onSigint = () => handle("SIGINT");
  const onSigterm = () => handle("SIGTERM");
  target.once("SIGINT", onSigint);
  target.once("SIGTERM", onSigterm);

  function remove(): void {
    if (!installed) return;
    installed = false;
    target.off("SIGINT", onSigint);
    target.off("SIGTERM", onSigterm);
  }

  function handle(signal: LocalProofSignal): void {
    if (!input.interruption.interrupt(signal)) return;
    remove();
    input.onInterrupt?.(signal);
  }

  return remove;
}

export function parseLocalhostPublishedPort(
  output: string,
  service: string,
): string {
  const bindings = outputLines(output);
  if (bindings.length !== 1) {
    throw new Error(
      `${service} must have exactly one localhost port binding (got ${bindings.join(", ") || "none"})`,
    );
  }
  const match = /^127\.0\.0\.1:(\d{1,5})$/u.exec(bindings[0] ?? "");
  const port = match ? Number(match[1]) : 0;
  if (!match || port < 1 || port > 65_535) {
    throw new Error(
      `${service} must have a Docker-assigned 127.0.0.1 port (got ${bindings[0] ?? "none"})`,
    );
  }
  return String(port);
}

export function createLocalE2eProjectCleanup(
  input: LocalE2eCleanupInput,
): () => Promise<void> {
  let cleanupPromise: Promise<void> | null = null;
  return () => {
    cleanupPromise ??= cleanupLocalE2eProject(input);
    return cleanupPromise;
  };
}

export function assertLocalhostComposePorts(
  renderedConfig: string,
  expectedPorts: readonly ExpectedPublishedPort[],
): void {
  let config: unknown;
  try {
    config = JSON.parse(renderedConfig) as unknown;
  } catch {
    throw new Error("docker compose emitted invalid JSON config");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("docker compose emitted an invalid config object");
  }
  const services = (config as JsonRecord).services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    throw new Error("docker compose config has no services object");
  }

  const expectedServices = new Set(expectedPorts.map(({ service }) => service));
  for (const [serviceName, serviceValue] of Object.entries(services)) {
    if (
      serviceValue &&
      typeof serviceValue === "object" &&
      !Array.isArray(serviceValue) &&
      Array.isArray((serviceValue as JsonRecord).ports) &&
      ((serviceValue as JsonRecord).ports as unknown[]).length > 0 &&
      !expectedServices.has(serviceName)
    ) {
      throw new Error(
        `docker compose service ${serviceName} has unexpected published ports`,
      );
    }
  }

  for (const expected of expectedPorts) {
    const service = (services as JsonRecord)[expected.service];
    if (!service || typeof service !== "object" || Array.isArray(service)) {
      throw new Error(
        `docker compose config is missing service ${expected.service}`,
      );
    }
    const ports = (service as JsonRecord).ports;
    if (!Array.isArray(ports)) {
      throw new Error(
        `docker compose service ${expected.service} has no published ports`,
      );
    }
    const bindings = ports
      .filter(
        (entry): entry is JsonRecord =>
          !!entry && typeof entry === "object" && !Array.isArray(entry),
      )
      .map(
        (port) =>
          `${String(port.host_ip ?? "0.0.0.0")}:${String(port.published)}:${String(port.target)}`,
      );
    const port = ports[0] as JsonRecord | undefined;
    if (
      ports.length !== 1 ||
      !port ||
      typeof port !== "object" ||
      Array.isArray(port) ||
      port.host_ip !== "127.0.0.1" ||
      Number(port.target) !== expected.target ||
      String(port.published) !== expected.published
    ) {
      const renderedBindings = bindings.join(", ");
      throw new Error(
        `docker compose service ${expected.service} must publish only 127.0.0.1:${expected.published}:${expected.target} (got ${renderedBindings || "none"})`,
      );
    }
  }
}

export async function computeAgentSourceFingerprint(
  takosRoot: string,
): Promise<string> {
  const ecosystemRoot = resolve(takosRoot, "..");
  const files: string[] = [];
  for (const input of AGENT_BUILD_INPUTS) {
    await collectFiles(resolve(ecosystemRoot, input), files);
  }
  files.sort((left, right) => left.localeCompare(right));

  const hash = createHash("sha256");
  for (const file of files) {
    const path = relative(ecosystemRoot, file).replaceAll("\\", "/");
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectFiles(path: string, files: string[]): Promise<void> {
  const info = await stat(path);
  if (info.isFile()) {
    files.push(path);
    return;
  }
  if (!info.isDirectory()) {
    throw new Error(`unsupported agent build input: ${path}`);
  }
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(
        `agent build input must not be a symlink: ${path}/${entry.name}`,
      );
    }
    await collectFiles(resolve(path, entry.name), files);
  }
}

export function parseLiveProofEvidence(
  stdout: string,
  expectedSourceFingerprint: string,
):
  | { ok: true; value: { run: JsonRecord; image: AgentImageProof } }
  | { ok: false; reason: string } {
  const run = parsePrefixedJson(
    stdout,
    "[local-e2e] agent run proof ",
    "agent run proof",
  );
  if ("reason" in run) return { ok: false, reason: run.reason };
  const image = parsePrefixedJson(
    stdout,
    "[local-e2e] agent image proof ",
    "agent image proof",
  );
  if ("reason" in image) return { ok: false, reason: image.reason };

  const runValue = run.value;
  const eventTypes = stringArray(runValue.eventTypes);
  const observedStatuses = stringArray(runValue.observedStatuses);
  if (
    runValue.kind !== "takos.local-agent-run-proof@v1" ||
    runValue.status !== "completed" ||
    !nonEmptyString(runValue.spaceId) ||
    !nonEmptyString(runValue.threadId) ||
    !nonEmptyString(runValue.runId) ||
    runValue.workspaceListObserved !== true ||
    runValue.runOutputObserved !== true ||
    runValue.assistantMessageObserved !== true ||
    runValue.terminalEventObserved !== true ||
    !eventTypes.includes("started") ||
    !eventTypes.includes("completed") ||
    !observedStatuses.includes("completed") ||
    typeof runValue.pollCount !== "number" ||
    !Number.isInteger(runValue.pollCount) ||
    runValue.pollCount < 1
  ) {
    return {
      ok: false,
      reason: "local:e2e emitted incomplete public API agent run evidence",
    };
  }

  const imageValue = image.value;
  const imageId = nonEmptyString(imageValue.imageId);
  if (
    imageValue.kind !== "takos.local-agent-image-proof@v1" ||
    !imageId ||
    !/^(?:sha256:)?[0-9a-f]{12,64}$/u.test(imageId) ||
    imageValue.sourceFingerprint !== expectedSourceFingerprint ||
    imageValue.sourceFingerprintMatched !== true
  ) {
    return {
      ok: false,
      reason: "local:e2e agent image provenance did not match current source",
    };
  }

  return {
    ok: true,
    value: {
      run: runValue,
      image: {
        kind: "takos.local-agent-image-proof@v1",
        imageId,
        sourceFingerprint: expectedSourceFingerprint,
        sourceFingerprintMatched: true,
      },
    },
  };
}

function parsePrefixedJson(
  stdout: string,
  prefix: string,
  label: string,
): { ok: true; value: JsonRecord } | { ok: false; reason: string } {
  const line = stdout.split("\n").find((entry) => entry.startsWith(prefix));
  if (!line) {
    return { ok: false, reason: `local:e2e passed without an ${label} record` };
  }
  try {
    const value = JSON.parse(line.slice(prefix.length)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        ok: false,
        reason: `local:e2e emitted an invalid ${label} record`,
      };
    }
    return { ok: true, value: value as JsonRecord };
  } catch {
    return {
      ok: false,
      reason: `local:e2e emitted an invalid ${label} record`,
    };
  }
}

export async function cleanupLocalE2eProject(
  input: LocalE2eCleanupInput,
): Promise<void> {
  const options: DockerCommandOptions = {
    check: false,
    env: input.commandEnv,
    timeoutMs: 120_000,
  };
  const problems: string[] = [];
  try {
    const down = await input.runDocker(
      [
        ...input.composeArgs,
        "down",
        "--volumes",
        "--remove-orphans",
        "--rmi",
        "local",
        "--timeout",
        "10",
      ],
      options,
    );
    if (down.code !== 0) {
      problems.push(
        `docker compose down failed with ${down.code}: ${commandSummary(down)}`,
      );
    }
  } catch (error) {
    problems.push(
      `docker compose down failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let resources: ProjectResources | null = null;
  try {
    resources = await listProjectResources(input, options);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  if (resources && resourceCount(resources) > 0) {
    problems.push(
      `project resources remained after compose down: ${describeResources(resources)}`,
    );
    await removeProjectResources(input.runDocker, resources, options, problems);
  }

  try {
    const remaining = await listProjectResources(input, options);
    if (resourceCount(remaining) > 0) {
      problems.push(
        `project cleanup incomplete: ${describeResources(remaining)}`,
      );
      await removeProjectResources(
        input.runDocker,
        remaining,
        options,
        problems,
      );
      const afterFallback = await listProjectResources(input, options);
      if (resourceCount(afterFallback) > 0) {
        problems.push(
          `project resources still present after fallback cleanup: ${describeResources(afterFallback)}`,
        );
      }
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  await cleanupCoreArtifacts(input.coreArtifactPaths ?? [], problems);

  if (problems.length > 0) {
    throw new Error(`local E2E cleanup failed:\n${problems.join("\n")}`);
  }
}

async function cleanupCoreArtifacts(
  paths: readonly string[],
  problems: string[],
): Promise<void> {
  for (const path of paths) {
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (isNotFoundError(error)) continue;
      problems.push(
        `failed to inspect core dump artifact ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (!info.isFile()) {
      problems.push(
        `refusing to remove non-file core artifact path ${basename(path)}`,
      );
      continue;
    }
    problems.push(`core dump artifact remained: ${basename(path)}`);
    try {
      await rm(path, { force: true });
    } catch (error) {
      problems.push(
        `failed to remove core dump artifact ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    try {
      await lstat(path);
      problems.push(
        `core dump artifact still present after cleanup: ${basename(path)}`,
      );
    } catch (error) {
      if (!isNotFoundError(error)) {
        problems.push(
          `failed to verify core dump cleanup ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function listProjectResources(
  input: Pick<
    Parameters<typeof cleanupLocalE2eProject>[0],
    "project" | "runDocker"
  >,
  options: DockerCommandOptions,
): Promise<ProjectResources> {
  const filter = `label=com.docker.compose.project=${input.project}`;
  const commands = {
    containers: ["ps", "-aq", "--filter", filter],
    volumes: ["volume", "ls", "-q", "--filter", filter],
    networks: ["network", "ls", "-q", "--filter", filter],
    images: ["image", "ls", "-q", "--filter", filter],
  } as const;
  const entries = await Promise.all(
    Object.entries(commands).map(async ([kind, args]) => {
      const result = await input.runDocker([...args], options);
      if (result.code !== 0) {
        throw new Error(
          `failed to inspect project ${kind}: ${commandSummary(result)}`,
        );
      }
      return [kind, outputLines(result.stdout)] as const;
    }),
  );
  const resources = Object.fromEntries(entries) as Record<string, string[]>;
  return {
    containers: resources.containers ?? [],
    volumes: resources.volumes ?? [],
    networks: resources.networks ?? [],
    images: resources.images ?? [],
  };
}

async function removeProjectResources(
  runDocker: LocalProofDockerRunner,
  resources: ProjectResources,
  options: DockerCommandOptions,
  problems: string[],
): Promise<void> {
  const removals: Array<[string, readonly string[], string[]]> = [
    ["containers", resources.containers, ["rm", "-f"]],
    ["volumes", resources.volumes, ["volume", "rm", "-f"]],
    ["networks", resources.networks, ["network", "rm"]],
    ["images", resources.images, ["image", "rm"]],
  ];
  for (const [kind, ids, command] of removals) {
    if (ids.length === 0) continue;
    try {
      const result = await runDocker([...command, ...ids], options);
      if (result.code === 0) continue;
      problems.push(
        `failed to remove project ${kind}: ${commandSummary(result)}`,
      );
    } catch (error) {
      problems.push(
        `failed to remove project ${kind}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function commandSummary(result: DockerCommandResult): string {
  const combined = [result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n")
    .trim();
  return combined ? combined.split("\n").slice(-4).join("\n") : "no output";
}

function outputLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resourceCount(resources: ProjectResources): number {
  return Object.values(resources).reduce(
    (total, values) => total + values.length,
    0,
  );
}

function describeResources(resources: ProjectResources): string {
  return Object.entries(resources)
    .filter(([, values]) => values.length > 0)
    .map(([kind, values]) => `${kind}=${values.join(",")}`)
    .join(" ");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
