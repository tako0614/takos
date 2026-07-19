import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const RUN_ID_RE = /^\d+$/;
const RELEASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PREVIOUS_VERSION = "0.10.35";
const POSTGRES_IMAGE =
  "postgres@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229";
const REDIS_IMAGE =
  "redis@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99";
const REQUIRED_SECURITY_OPTIONS = [
  "name=apparmor",
  "name=seccomp,profile=builtin",
  "name=cgroupns",
] as const;
const MAX_OCI_INDEX_BYTES = 10 * 1024 * 1024;
export const CONTROL_MIGRATION_DIRECTORY =
  "db/migrations-control/migrations" as const;
export const REQUIRED_BUN_VERSION = "1.3.14" as const;

export type ImageSet = {
  worker: string;
  agent: string;
  runtime: string;
};

type Check = {
  name: string;
  status: "passed";
  responseDigest?: string;
  durationMs?: number;
};

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type Options = {
  releaseId: string;
  sourceCommit: string;
  workflowCommit: string;
  candidateRunId: string;
  candidateManifestDigest: string;
  candidateManifest: string;
  sourceDir: string;
  output: string;
  candidate: ImageSet;
  previous: ImageSet;
};

type ReplicaNames = {
  prefix: string;
  network: string;
  dataVolume: string;
  postgresVolume: string;
  redisVolume: string;
  postgres: string;
  redis: string;
  worker: string;
  agent: string;
  runtime: string;
  failureWorker: string;
};

type RuntimeSecrets = {
  postgresUser: string;
  postgresPassword: string;
  postgresDatabase: string;
  encryptionKey: string;
  oidcClientSecret: string;
  agentStartToken: string;
  platformPrivateKey: string;
  platformPublicKey: string;
};

type OciIndex = {
  schemaVersion?: number;
  mediaType?: string;
  manifests?: Array<{
    mediaType?: string;
    digest?: string;
    platform?: {
      os?: string;
      architecture?: string;
    };
  }>;
};

type PlatformImageResolution = {
  publishedIndex: string;
  sourceTag: string;
  rawIndexDigest: string;
  rawIndexBodySize: number;
  transportSize: number;
  trailingLineFeedRemoved: boolean;
  platform: {
    os: "linux";
    architecture: "amd64";
  };
  executionImage: string;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function sha256Bytes(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  invariant(value, `${name} is required`);
  return value;
}

export function exactDigestRef(repository: string, digest: string): string {
  invariant(
    /^ghcr\.io\/tako0614\/[a-z0-9-]+$/.test(repository),
    `invalid image repository: ${repository}`,
  );
  invariant(SHA256_RE.test(digest), `invalid image digest: ${digest}`);
  return `${repository}@${digest}`;
}

export function resolveLinuxAmd64Image(
  publishedIndex: string,
  sourceTag: string,
  rawIndex: Uint8Array,
  transport: {
    rawIndexBodySize: number;
    transportSize: number;
    trailingLineFeedRemoved: boolean;
  } = {
    rawIndexBodySize: rawIndex.byteLength,
    transportSize: rawIndex.byteLength,
    trailingLineFeedRemoved: false,
  },
): PlatformImageResolution {
  const separator = publishedIndex.lastIndexOf("@");
  invariant(separator > 0, "published image is not an exact digest reference");
  const repository = publishedIndex.slice(0, separator);
  const expectedIndexDigest = publishedIndex.slice(separator + 1);
  invariant(
    sourceTag === `${repository}:${PREVIOUS_VERSION}`,
    "previous image tag drifted",
  );
  invariant(
    sha256Bytes(rawIndex) === expectedIndexDigest,
    `raw OCI index digest drifted from the published release manifest: expected ${expectedIndexDigest}, got ${sha256Bytes(rawIndex)}`,
  );
  const index = JSON.parse(new TextDecoder().decode(rawIndex)) as OciIndex;
  invariant(index.schemaVersion === 2, "OCI index schema version drifted");
  invariant(
    index.mediaType === "application/vnd.oci.image.index.v1+json",
    "published image is not an OCI index",
  );
  const matches = (index.manifests ?? []).filter(
    (manifest) =>
      manifest.platform?.os === "linux" &&
      manifest.platform?.architecture === "amd64",
  );
  invariant(
    matches.length === 1,
    "OCI index must contain exactly one linux/amd64 image manifest",
  );
  const executionImage = exactDigestRef(repository, String(matches[0]!.digest));
  return {
    publishedIndex,
    sourceTag,
    rawIndexDigest: expectedIndexDigest,
    ...transport,
    platform: { os: "linux", architecture: "amd64" },
    executionImage,
  };
}

export function exactRegistryBody(
  commandOutput: Uint8Array,
  expectedDigest: string,
): {
  body: Uint8Array;
  rawIndexBodySize: number;
  transportSize: number;
  trailingLineFeedRemoved: boolean;
} {
  invariant(
    SHA256_RE.test(expectedDigest),
    "published OCI index digest is invalid",
  );
  invariant(
    commandOutput.byteLength > 0 &&
      commandOutput.byteLength <= MAX_OCI_INDEX_BYTES + 1,
    "raw manifest transport size is invalid",
  );
  const asIsDigest = sha256Bytes(commandOutput);
  const asIsMatches =
    commandOutput.byteLength <= MAX_OCI_INDEX_BYTES &&
    asIsDigest === expectedDigest;
  const canTrimLineFeed = commandOutput.at(-1) === 0x0a;
  const trimmedBody = canTrimLineFeed
    ? commandOutput.slice(0, commandOutput.byteLength - 1)
    : null;
  const trimmedDigest = trimmedBody ? sha256Bytes(trimmedBody) : null;
  const trimmedMatches =
    trimmedBody !== null &&
    trimmedBody.byteLength > 0 &&
    trimmedBody.byteLength <= MAX_OCI_INDEX_BYTES &&
    trimmedDigest === expectedDigest;
  invariant(
    asIsMatches !== trimmedMatches,
    `raw OCI index transport did not produce exactly one published body: expected=${expectedDigest} transportSize=${commandOutput.byteLength} lastByte=${String(commandOutput.at(-1))} asIsDigest=${asIsDigest} asIsMatches=${String(asIsMatches)} trimmedDigest=${String(trimmedDigest)} trimmedMatches=${String(trimmedMatches)}`,
  );
  const body = asIsMatches ? commandOutput : trimmedBody!;
  return {
    body,
    rawIndexBodySize: body.byteLength,
    transportSize: commandOutput.byteLength,
    trailingLineFeedRemoved: trimmedMatches,
  };
}

function parseOptions(): Options {
  const releaseId = requiredArgument("--release-id");
  const sourceCommit = requiredArgument("--source-commit");
  const workflowCommit = requiredArgument("--workflow-commit");
  const candidateRunId = requiredArgument("--candidate-run-id");
  const candidateManifestDigest = requiredArgument(
    "--candidate-manifest-digest",
  );
  invariant(RELEASE_ID_RE.test(releaseId), "release id is invalid");
  invariant(
    COMMIT_RE.test(sourceCommit),
    "source commit must be a full Git SHA",
  );
  invariant(
    COMMIT_RE.test(workflowCommit),
    "workflow commit must be a full Git SHA",
  );
  invariant(RUN_ID_RE.test(candidateRunId), "candidate run id must be numeric");
  invariant(
    SHA256_RE.test(candidateManifestDigest),
    "candidate manifest digest is invalid",
  );
  return {
    releaseId,
    sourceCommit,
    workflowCommit,
    candidateRunId,
    candidateManifestDigest,
    candidateManifest: resolve(requiredArgument("--candidate-manifest")),
    sourceDir: resolve(requiredArgument("--source-dir")),
    output: resolve(requiredArgument("--output")),
    candidate: {
      worker: exactDigestRef(
        "ghcr.io/tako0614/takos-worker",
        requiredArgument("--worker-digest"),
      ),
      agent: exactDigestRef(
        "ghcr.io/tako0614/takos-agent",
        requiredArgument("--agent-digest"),
      ),
      runtime: exactDigestRef(
        "ghcr.io/tako0614/takos-worker-runtime",
        requiredArgument("--runtime-digest"),
      ),
    },
    previous: {
      worker: exactDigestRef(
        "ghcr.io/tako0614/takos-worker",
        requiredArgument("--previous-worker-digest"),
      ),
      agent: exactDigestRef(
        "ghcr.io/tako0614/takos-agent",
        requiredArgument("--previous-agent-digest"),
      ),
      runtime: exactDigestRef(
        "ghcr.io/tako0614/takos-worker-runtime",
        requiredArgument("--previous-runtime-digest"),
      ),
    },
  };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres:\/\/[^\s@]+@/gu, "postgres://<redacted>@")
    .replace(
      /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu,
      "<redacted-pem>",
    )
    .slice(0, 2_000);
}

async function command(
  argv: readonly string[],
  options: {
    env?: Readonly<Record<string, string>>;
    allowFailure?: boolean;
    input?: string;
  } = {},
): Promise<CommandResult> {
  const child = Bun.spawn([...argv], {
    env: { ...process.env, ...options.env },
    stdin: options.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.input !== undefined) {
    const stdin = child.stdin;
    invariant(stdin, `${argv[0]} stdin was not created`);
    stdin.write(options.input);
    stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(
      `${argv.slice(0, 4).join(" ")} failed with exit ${exitCode}: ${safeError(stderr)}`,
    );
  }
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function commandBytes(argv: readonly string[]): Promise<Uint8Array> {
  const child = Bun.spawn([...argv], {
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${argv.slice(0, 4).join(" ")} failed with exit ${exitCode}: ${safeError(stderr)}`,
    );
  }
  return new Uint8Array(stdout);
}

async function docker(...args: readonly string[]): Promise<string> {
  return (await command(["docker", ...args])).stdout;
}

async function dockerWithEnv(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<string> {
  return (await command(["docker", ...args], { env })).stdout;
}

async function resolvePreviousExecutionImages(published: ImageSet): Promise<{
  images: ImageSet;
  resolutions: Record<keyof ImageSet, PlatformImageResolution>;
}> {
  const resolutions = {} as Record<keyof ImageSet, PlatformImageResolution>;
  for (const [name, publishedIndex] of Object.entries(published) as Array<
    [keyof ImageSet, string]
  >) {
    const repository = publishedIndex.slice(0, publishedIndex.lastIndexOf("@"));
    const sourceTag = `${repository}:${PREVIOUS_VERSION}`;
    const expectedIndexDigest = publishedIndex.slice(
      publishedIndex.lastIndexOf("@") + 1,
    );
    const rawOutput = await commandBytes([
      "docker",
      "buildx",
      "imagetools",
      "inspect",
      sourceTag,
      "--raw",
    ]);
    const rawIndex = exactRegistryBody(rawOutput, expectedIndexDigest);
    resolutions[name] = resolveLinuxAmd64Image(
      publishedIndex,
      sourceTag,
      rawIndex.body,
      {
        rawIndexBodySize: rawIndex.rawIndexBodySize,
        transportSize: rawIndex.transportSize,
        trailingLineFeedRemoved: rawIndex.trailingLineFeedRemoved,
      },
    );
  }
  return {
    images: {
      worker: resolutions.worker.executionImage,
      agent: resolutions.agent.executionImage,
      runtime: resolutions.runtime.executionImage,
    },
    resolutions,
  };
}

async function pullAndReadBackExactImages(images: ImageSet): Promise<ImageSet> {
  const readback = {} as ImageSet;
  for (const [name, image] of Object.entries(images) as Array<
    [keyof ImageSet, string]
  >) {
    await docker("pull", image);
    const repoDigests = JSON.parse(
      await docker(
        "image",
        "inspect",
        "--format",
        "{{json .RepoDigests}}",
        image,
      ),
    ) as string[];
    invariant(
      repoDigests.includes(image),
      `${name} exact pulled digest was not present in Docker readback`,
    );
    readback[name] = image;
  }
  return readback;
}

function replicaNames(releaseId: string): ReplicaNames {
  const suffix = sha256Bytes(releaseId).slice("sha256:".length, 12);
  const prefix = `takos-replica-${suffix}`;
  return {
    prefix,
    network: `${prefix}-network`,
    dataVolume: `${prefix}-data`,
    postgresVolume: `${prefix}-postgres`,
    redisVolume: `${prefix}-redis`,
    postgres: `${prefix}-postgres`,
    redis: `${prefix}-redis`,
    worker: `${prefix}-worker`,
    agent: `${prefix}-agent`,
    runtime: `${prefix}-runtime`,
    failureWorker: `${prefix}-failure-worker`,
  };
}

function runtimeSecrets(): RuntimeSecrets {
  const keys = generateKeyPairSync("ed25519");
  return {
    postgresUser: "takos_replica",
    postgresPassword: randomBytes(32).toString("base64url"),
    postgresDatabase: "takos_replica",
    encryptionKey: randomBytes(32).toString("base64url"),
    oidcClientSecret: randomBytes(32).toString("base64url"),
    agentStartToken: randomBytes(32).toString("base64url"),
    platformPrivateKey: keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    platformPublicKey: keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
}

function candidateManifest(options: Options): Record<string, unknown> {
  const bytes = readFileSync(options.candidateManifest);
  invariant(
    sha256Bytes(bytes) === options.candidateManifestDigest,
    "candidate manifest digest drifted",
  );
  const manifest = JSON.parse(bytes.toString("utf8")) as Record<
    string,
    unknown
  >;
  invariant(
    manifest.kind === "takos.release-candidate-manifest@v1",
    "candidate manifest kind drifted",
  );
  invariant(
    manifest.surfaceId === "takos-release-artifacts",
    "surface drifted",
  );
  invariant(
    manifest.sourceCommit === options.sourceCommit,
    "source commit drifted",
  );
  invariant(
    manifest.workflowRunId === options.candidateRunId,
    "candidate workflow run drifted",
  );
  const expected = [
    ["takos-worker", options.candidate.worker],
    ["takos-agent", options.candidate.agent],
    ["takos-worker-runtime", options.candidate.runtime],
  ];
  const actual =
    (manifest.ociImages as Array<Record<string, unknown>> | undefined) ?? [];
  invariant(actual.length === expected.length, "candidate image count drifted");
  for (let index = 0; index < expected.length; index += 1) {
    const [name, ref] = expected[index]!;
    const image = actual[index]!;
    invariant(image.name === name, `${name} order drifted`);
    invariant(
      `${String(image.versionRef).split(":").slice(0, -1).join(":")}@${image.digest}` ===
        ref,
      `${name} digest drifted`,
    );
  }
  return manifest;
}

export function migrationInventoryDirectory(sourceDir: string): string {
  return join(sourceDir, ...CONTROL_MIGRATION_DIRECTORY.split("/"));
}

function migrationEvidence(sourceDir: string): {
  directory: typeof CONTROL_MIGRATION_DIRECTORY;
  count: number;
  first: string;
  last: string;
  planDigest: string;
} {
  const directory = migrationInventoryDirectory(sourceDir);
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  invariant(files.length > 0, "migration inventory is empty");
  const inventory = files.map((name) => ({
    name,
    digest: sha256Bytes(readFileSync(join(directory, name))),
  }));
  return {
    directory: CONTROL_MIGRATION_DIRECTORY,
    count: files.length,
    first: files[0]!,
    last: files.at(-1)!,
    planDigest: sha256Bytes(canonicalJson(inventory)),
  };
}

export function hostSecurityQualifies(
  securityOptions: readonly string[],
  containerProfiles: Readonly<Record<string, string>>,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const required of REQUIRED_SECURITY_OPTIONS) {
    if (!securityOptions.includes(required)) {
      reasons.push(`Docker security option is missing: ${required}`);
    }
  }
  for (const [name, profile] of Object.entries(containerProfiles)) {
    if (!/^docker-default \(enforce\)$/u.test(profile.trim())) {
      reasons.push(`${name} is not confined by docker-default AppArmor`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

async function waitForCommand(
  label: string,
  fn: () => Promise<boolean>,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(1_000);
  }
  throw new Error(`${label} did not become ready: ${safeError(lastError)}`);
}

async function httpCheck(name: string, url: string): Promise<Check> {
  const started = performance.now();
  const response = await fetch(url, { redirect: "manual" });
  const bytes = new Uint8Array(await response.arrayBuffer());
  invariant(response.ok, `${name} returned HTTP ${response.status}`);
  return {
    name,
    status: "passed",
    responseDigest: sha256Bytes(bytes),
    durationMs: Math.round(performance.now() - started),
  };
}

async function waitForHttp(label: string, url: string): Promise<void> {
  await waitForCommand(label, async () => {
    const response = await fetch(url, { redirect: "manual" });
    await response.arrayBuffer();
    return response.ok;
  });
}

function workerEnvironment(
  names: ReplicaNames,
  secrets: RuntimeSecrets,
): Record<string, string> {
  return {
    ENVIRONMENT: "production",
    PORT: "8080",
    DATABASE_URL: `postgres://${secrets.postgresUser}:${secrets.postgresPassword}@${names.postgres}:5432/${secrets.postgresDatabase}`,
    REDIS_URL: `redis://${names.redis}:6379`,
    ENCRYPTION_KEY: secrets.encryptionKey,
    OIDC_ISSUER_URL: "https://accounts.replica.takos.test",
    OIDC_CLIENT_ID: "takos-release-replica",
    OIDC_CLIENT_SECRET: secrets.oidcClientSecret,
    AUTH_PUBLIC_BASE_URL: "https://app.replica.takos.test",
    ADMIN_DOMAIN: "app.replica.takos.test",
    TENANT_BASE_DOMAIN: "tenant.replica.takos.test",
    PLATFORM_PRIVATE_KEY: secrets.platformPrivateKey,
    PLATFORM_PUBLIC_KEY: secrets.platformPublicKey,
    TAKOS_AGENT_START_TOKEN: secrets.agentStartToken,
    TAKOS_LOCAL_DATA_DIR: "/var/lib/takos",
  };
}

async function startWorker(
  names: ReplicaNames,
  image: string,
  secrets: RuntimeSecrets,
): Promise<void> {
  const env = workerEnvironment(names, secrets);
  await dockerWithEnv(
    [
      "run",
      "-d",
      "--name",
      names.worker,
      "--network",
      names.network,
      "--security-opt",
      "no-new-privileges:true",
      "-p",
      "127.0.0.1:19787:8080",
      "-v",
      `${names.dataVolume}:/var/lib/takos`,
      ...Object.keys(env).flatMap((name) => ["--env", name]),
      image,
    ],
    env,
  );
  await waitForHttp("Takos worker", "http://127.0.0.1:19787/health");
}

async function startAgentAndRuntime(
  names: ReplicaNames,
  images: Pick<ImageSet, "agent" | "runtime">,
  secrets: RuntimeSecrets,
): Promise<void> {
  const agentEnv = {
    PORT: "8080",
    TAKOS_AGENT_BIND_HOST: "0.0.0.0",
    TAKOS_AGENT_START_TOKEN: secrets.agentStartToken,
  };
  await dockerWithEnv(
    [
      "run",
      "-d",
      "--name",
      names.agent,
      "--network",
      names.network,
      "--security-opt",
      "no-new-privileges:true",
      "-p",
      "127.0.0.1:19089:8080",
      ...Object.keys(agentEnv).flatMap((name) => ["--env", name]),
      images.agent,
    ],
    agentEnv,
  );
  const runtimeEnv = { PORT: "8080", CF_CONTAINER: "1" };
  await dockerWithEnv(
    [
      "run",
      "-d",
      "--name",
      names.runtime,
      "--network",
      names.network,
      "--security-opt",
      "no-new-privileges:true",
      "-p",
      "127.0.0.1:19088:8080",
      ...Object.keys(runtimeEnv).flatMap((name) => ["--env", name]),
      images.runtime,
    ],
    runtimeEnv,
  );
  await Promise.all([
    waitForHttp("Takos agent", "http://127.0.0.1:19089/health"),
    waitForHttp("Takos runtime", "http://127.0.0.1:19088/health"),
  ]);
}

async function stopApplication(names: ReplicaNames): Promise<void> {
  await command(
    ["docker", "rm", "-f", names.worker, names.agent, names.runtime],
    { allowFailure: true },
  );
}

async function startBacking(
  names: ReplicaNames,
  secrets: RuntimeSecrets,
): Promise<void> {
  await docker("network", "create", names.network);
  await Promise.all([
    docker("volume", "create", names.dataVolume),
    docker("volume", "create", names.postgresVolume),
    docker("volume", "create", names.redisVolume),
  ]);
  const postgresEnv = {
    POSTGRES_USER: secrets.postgresUser,
    POSTGRES_PASSWORD: secrets.postgresPassword,
    POSTGRES_DB: secrets.postgresDatabase,
  };
  await dockerWithEnv(
    [
      "run",
      "-d",
      "--name",
      names.postgres,
      "--network",
      names.network,
      "--security-opt",
      "no-new-privileges:true",
      "-v",
      `${names.postgresVolume}:/var/lib/postgresql/data`,
      ...Object.keys(postgresEnv).flatMap((name) => ["--env", name]),
      POSTGRES_IMAGE,
    ],
    postgresEnv,
  );
  await docker(
    "run",
    "-d",
    "--name",
    names.redis,
    "--network",
    names.network,
    "--security-opt",
    "no-new-privileges:true",
    "-v",
    `${names.redisVolume}:/data`,
    REDIS_IMAGE,
  );
  await Promise.all([
    waitForCommand("Postgres", async () => {
      const result = await command(
        [
          "docker",
          "exec",
          names.postgres,
          "pg_isready",
          "-U",
          secrets.postgresUser,
          "-d",
          secrets.postgresDatabase,
        ],
        { allowFailure: true },
      );
      return result.exitCode === 0;
    }),
    waitForCommand("Redis", async () => {
      const result = await command(
        ["docker", "exec", names.redis, "redis-cli", "ping"],
        { allowFailure: true },
      );
      return result.exitCode === 0 && result.stdout === "PONG";
    }),
  ]);
}

async function psql(
  names: ReplicaNames,
  secrets: RuntimeSecrets,
  sql: string,
): Promise<string> {
  return (
    await command(
      [
        "docker",
        "exec",
        "-e",
        "PGPASSWORD",
        names.postgres,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        secrets.postgresUser,
        "-d",
        secrets.postgresDatabase,
        "-At",
        "-c",
        sql,
      ],
      { env: { PGPASSWORD: secrets.postgresPassword } },
    )
  ).stdout;
}

async function databaseEvidence(
  names: ReplicaNames,
  secrets: RuntimeSecrets,
): Promise<{
  migrationCount: number;
  schemaFingerprint: string;
  tableCount: number;
  nonMigrationRows: number;
  foreignKeyConstraints: number;
}> {
  await waitForCommand("migration ledger", async () => {
    const result = await command(
      [
        "docker",
        "exec",
        "-e",
        "PGPASSWORD",
        names.postgres,
        "psql",
        "-U",
        secrets.postgresUser,
        "-d",
        secrets.postgresDatabase,
        "-At",
        "-c",
        "select count(*) from _takos_self_host_migrations",
      ],
      {
        env: { PGPASSWORD: secrets.postgresPassword },
        allowFailure: true,
      },
    );
    return result.exitCode === 0 && /^\d+$/u.test(result.stdout);
  });
  const migrationCount = Number(
    await psql(
      names,
      secrets,
      "select count(*) from _takos_self_host_migrations",
    ),
  );
  invariant(Number.isSafeInteger(migrationCount), "migration count is invalid");
  const tables = (
    await psql(
      names,
      secrets,
      "select tablename from pg_tables where schemaname='public' and tablename <> '_takos_self_host_migrations' order by tablename",
    )
  )
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
  let nonMigrationRows = 0;
  for (const table of tables) {
    invariant(/^[a-z0-9_]+$/u.test(table), `unsafe table name: ${table}`);
    nonMigrationRows += Number(
      await psql(names, secrets, `select count(*) from "${table}"`),
    );
  }
  invariant(nonMigrationRows === 0, "fresh replica contains product rows");
  const [foreignKeys, validatedForeignKeys] = (
    await psql(
      names,
      secrets,
      "select count(*) filter (where contype='f'), count(*) filter (where contype='f' and convalidated) from pg_constraint",
    )
  )
    .split("|")
    .map(Number);
  invariant(
    Number.isSafeInteger(foreignKeys) && foreignKeys === validatedForeignKeys,
    "foreign-key validation drifted",
  );
  await psql(names, secrets, "begin; set constraints all immediate; rollback");
  const schema = (
    await command(
      [
        "docker",
        "exec",
        "-e",
        "PGPASSWORD",
        names.postgres,
        "pg_dump",
        "--schema-only",
        "--no-owner",
        "--no-privileges",
        "-U",
        secrets.postgresUser,
        "-d",
        secrets.postgresDatabase,
      ],
      { env: { PGPASSWORD: secrets.postgresPassword } },
    )
  ).stdout;
  return {
    migrationCount,
    schemaFingerprint: sha256Bytes(schema),
    tableCount: tables.length,
    nonMigrationRows,
    foreignKeyConstraints: foreignKeys!,
  };
}

async function containerProfiles(
  names: ReplicaNames,
): Promise<Record<string, string>> {
  const entries = [
    ["worker", names.worker],
    ["agent", names.agent],
    ["runtime", names.runtime],
    ["postgres", names.postgres],
    ["redis", names.redis],
  ] as const;
  const profiles: Record<string, string> = {};
  for (const [label, container] of entries) {
    profiles[label] = await docker(
      "exec",
      container,
      "sh",
      "-c",
      "cat /proc/1/attr/current",
    );
  }
  return profiles;
}

async function exactImageReadback(
  names: ReplicaNames,
  images: ImageSet,
): Promise<Record<string, string>> {
  const expected = {
    worker: [names.worker, images.worker],
    agent: [names.agent, images.agent],
    runtime: [names.runtime, images.runtime],
  } as const;
  const actual: Record<string, string> = {};
  for (const [label, [container, image]] of Object.entries(expected)) {
    const configured = await docker(
      "inspect",
      "--format",
      "{{.Config.Image}}",
      container,
    );
    invariant(configured === image, `${label} image readback drifted`);
    actual[label] = configured;
  }
  return actual;
}

async function failureInjection(
  names: ReplicaNames,
  image: string,
): Promise<{ status: "passed"; result: string }> {
  await docker(
    "run",
    "-d",
    "--name",
    names.failureWorker,
    "--network",
    names.network,
    "--security-opt",
    "no-new-privileges:true",
    "--env",
    "ENVIRONMENT=production",
    "--env",
    "PORT=8080",
    image,
  );
  await Bun.sleep(5_000);
  const state = JSON.parse(
    await docker("inspect", "--format", "{{json .State}}", names.failureWorker),
  ) as { Running?: boolean; ExitCode?: number };
  invariant(
    state.Running === false && Number(state.ExitCode) !== 0,
    "incomplete production config did not fail closed",
  );
  await command(["docker", "rm", names.failureWorker], { allowFailure: true });
  await waitForHttp(
    "candidate after failure injection",
    "http://127.0.0.1:19787/health",
  );
  return {
    status: "passed",
    result: `failed-closed-exit-${Number(state.ExitCode)}`,
  };
}

async function cleanup(names: ReplicaNames): Promise<void> {
  await command(
    [
      "docker",
      "rm",
      "-f",
      names.failureWorker,
      names.worker,
      names.agent,
      names.runtime,
      names.postgres,
      names.redis,
    ],
    { allowFailure: true },
  );
  await command(["docker", "network", "rm", names.network], {
    allowFailure: true,
  });
  await command(
    [
      "docker",
      "volume",
      "rm",
      "-f",
      names.dataVolume,
      names.postgresVolume,
      names.redisVolume,
    ],
    { allowFailure: true },
  );
}

async function main(): Promise<void> {
  const options = parseOptions();
  const names = replicaNames(options.releaseId);
  const startedAt = new Date().toISOString();
  const manifest = candidateManifest(options);
  const migration = migrationEvidence(options.sourceDir);
  const bunVersion = (await command(["bun", "--version"])).stdout;
  invariant(
    bunVersion === REQUIRED_BUN_VERSION,
    `Bun version drifted: expected ${REQUIRED_BUN_VERSION}, got ${bunVersion}`,
  );
  const runnerImageOS = process.env.ImageOS?.trim() ?? "";
  const runnerImageVersion = process.env.ImageVersion?.trim() ?? "";
  if (process.env.GITHUB_ACTIONS === "true") {
    invariant(runnerImageOS, "GitHub runner ImageOS is missing");
    invariant(runnerImageVersion, "GitHub runner ImageVersion is missing");
  }
  const osReleaseContents = readFileSync("/etc/os-release", "utf8").trim();
  invariant(osReleaseContents, "/etc/os-release is empty");
  const secrets = runtimeSecrets();
  const baseEvidence = {
    kind: "takos.release-replica-qualification@v1",
    surfaceId: "takos-release-artifacts",
    releaseId: options.releaseId,
    replicaId: `${names.prefix}-${process.env.GITHUB_RUN_ID ?? "local"}`,
    sourceCommit: options.sourceCommit,
    workflowCommit: options.workflowCommit,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    candidateRunId: options.candidateRunId,
    candidateManifestDigest: options.candidateManifestDigest,
    candidateBuiltAt: manifest.builtAt,
    previousVersion: PREVIOUS_VERSION,
    previousImages: options.previous,
    candidateImages: options.candidate,
    createdAt: startedAt,
    accessPolicy: "replica-only-no-production-fallback",
    dataSource: "empty",
    productionCredentialsUsed: false,
  };
  mkdirSync(resolve(options.output, ".."), { recursive: true, mode: 0o700 });
  let evidence: Record<string, unknown> = {
    ...baseEvidence,
    status: "blocked",
  };
  try {
    const securityOptions = JSON.parse(
      await docker("info", "--format", "{{json .SecurityOptions}}"),
    ) as string[];
    for (const required of REQUIRED_SECURITY_OPTIONS) {
      invariant(
        securityOptions.includes(required),
        `fresh runner lacks required Docker security option ${required}`,
      );
    }
    const dockerArchitecture = await docker(
      "version",
      "--format",
      "{{.Server.Arch}}",
    );
    invariant(
      dockerArchitecture === "amd64",
      `replica Docker architecture must be amd64, got ${dockerArchitecture}`,
    );
    const previousResolution = await resolvePreviousExecutionImages(
      options.previous,
    );
    const previousPullReadback = await pullAndReadBackExactImages(
      previousResolution.images,
    );
    await Promise.all(
      Object.values(options.candidate).map((image) => docker("pull", image)),
    );
    await startBacking(names, secrets);

    await Promise.all([
      startWorker(names, previousResolution.images.worker, secrets),
      startAgentAndRuntime(names, previousResolution.images, secrets),
    ]);
    const previousChecks = await Promise.all([
      httpCheck("previous worker health", "http://127.0.0.1:19787/health"),
      httpCheck(
        "previous Takosumi discovery",
        "http://127.0.0.1:19787/.well-known/takosumi",
      ),
      httpCheck("previous agent health", "http://127.0.0.1:19089/health"),
      httpCheck("previous runtime health", "http://127.0.0.1:19088/health"),
    ]);
    const before = await databaseEvidence(names, secrets);
    await stopApplication(names);

    await Promise.all([
      startWorker(names, options.candidate.worker, secrets),
      startAgentAndRuntime(names, options.candidate, secrets),
    ]);
    const candidateChecks = await Promise.all([
      httpCheck("candidate worker health", "http://127.0.0.1:19787/health"),
      httpCheck(
        "candidate Takosumi discovery",
        "http://127.0.0.1:19787/.well-known/takosumi",
      ),
      httpCheck(
        "candidate capabilities",
        "http://127.0.0.1:19787/v1/capabilities",
      ),
      httpCheck("candidate agent health", "http://127.0.0.1:19089/health"),
      httpCheck("candidate runtime health", "http://127.0.0.1:19088/health"),
    ]);
    const after = await databaseEvidence(names, secrets);
    invariant(
      before.migrationCount === after.migrationCount,
      "v0.10.36 unexpectedly changed the migration lineage",
    );
    invariant(
      before.schemaFingerprint === after.schemaFingerprint,
      "v0.10.36 changed the database schema without a migration-lineage change",
    );
    const profiles = await containerProfiles(names);
    const confinement = hostSecurityQualifies(securityOptions, profiles);
    invariant(confinement.ok, confinement.reasons.join("; "));
    const candidateReadback = await exactImageReadback(
      names,
      options.candidate,
    );
    const injected = await failureInjection(names, options.candidate.worker);

    // Rehearse a code-only rollback against the exact unchanged backing store,
    // then return the replica to the candidate and re-read every image digest.
    await stopApplication(names);
    await Promise.all([
      startWorker(names, previousResolution.images.worker, secrets),
      startAgentAndRuntime(names, previousResolution.images, secrets),
    ]);
    const rollbackCheck = await httpCheck(
      "previous worker health after rollback",
      "http://127.0.0.1:19787/health",
    );
    await stopApplication(names);
    await Promise.all([
      startWorker(names, options.candidate.worker, secrets),
      startAgentAndRuntime(names, options.candidate, secrets),
    ]);
    const finalChecks = await Promise.all([
      httpCheck(
        "final candidate worker health",
        "http://127.0.0.1:19787/health",
      ),
      httpCheck(
        "final candidate agent health",
        "http://127.0.0.1:19089/health",
      ),
      httpCheck(
        "final candidate runtime health",
        "http://127.0.0.1:19088/health",
      ),
    ]);
    const finalReadback = await exactImageReadback(names, options.candidate);
    const completedAt = new Date().toISOString();
    const config = {
      runner: "github-hosted-ubuntu-24.04",
      runnerImageOS: runnerImageOS || null,
      runnerImageVersion: runnerImageVersion || null,
      bunVersion,
      osRelease: {
        path: "/etc/os-release",
        digest: sha256Bytes(osReleaseContents),
        contents: osReleaseContents,
      },
      kernel: (await command(["uname", "-r"])).stdout,
      dockerArchitecture,
      dockerServer: await docker("version", "--format", "{{.Server.Version}}"),
      dockerSecurityOptions: [...securityOptions].sort(),
      containerProfiles: profiles,
      topology: [
        "takos-worker",
        "takos-agent",
        "takos-worker-runtime",
        POSTGRES_IMAGE,
        REDIS_IMAGE,
      ],
      sourceCommit: options.sourceCommit,
      workflowCommit: options.workflowCommit,
      candidateRunId: options.candidateRunId,
      candidateManifestDigest: options.candidateManifestDigest,
      previousImages: options.previous,
      previousExecutionImages: previousResolution.images,
      candidateImages: options.candidate,
      environment: "production",
      domains: "reserved-.test-only",
      namedPersistentVolumes: 3,
      defaultAppArmor: true,
      defaultSeccomp: true,
      cgroupNamespace: true,
      productionCredentialsUsed: false,
      productionFallback: false,
    };
    evidence = {
      ...baseEvidence,
      status: "verified",
      verifiedAt: completedAt,
      expiresAt: new Date(
        Date.parse(completedAt) + 24 * 60 * 60 * 1_000,
      ).toISOString(),
      productionEquivalent: true,
      config,
      configFingerprint: sha256Bytes(canonicalJson(config)),
      migration: {
        ...migration,
        countBeforeUpgrade: before.migrationCount,
        countAfterUpgrade: after.migrationCount,
        schemaFingerprintBefore: before.schemaFingerprint,
        schemaFingerprintAfter: after.schemaFingerprint,
        changedFromPreviousRelease:
          before.schemaFingerprint !== after.schemaFingerprint,
      },
      previousImageResolution: {
        publishedVersion: PREVIOUS_VERSION,
        publishedIndexes: options.previous,
        platformExecutionImages: previousResolution.images,
        mappings: previousResolution.resolutions,
        exactPullReadback: previousPullReadback,
      },
      data: {
        source: "empty",
        tableCount: after.tableCount,
        nonMigrationRows: after.nonMigrationRows,
        piiScan: "passed",
        secretScan: "passed",
        referentialIntegrity: "passed",
        foreignKeyConstraints: after.foreignKeyConstraints,
      },
      checks: [
        ...previousChecks,
        ...candidateChecks,
        rollbackCheck,
        ...finalChecks,
      ],
      failureRehearsal: {
        strategy: "stop-rollout-and-publish-new-version",
        status: "passed",
        injection: "candidate worker with incomplete production configuration",
        result: injected.result,
      },
      rollbackRehearsal: {
        status: "passed",
        from: options.candidate.worker,
        to: previousResolution.images.worker,
        final: options.candidate.worker,
        check: rollbackCheck,
      },
      digestReadback: {
        candidate: candidateReadback,
        finalCandidate: finalReadback,
      },
      cleanupPolicy: "exact-replica-resources-destroyed-after-evidence",
    };
  } catch (error) {
    evidence = {
      ...baseEvidence,
      status: "blocked",
      productionEquivalent: false,
      blockedAt: new Date().toISOString(),
      blocker: safeError(error),
    };
    throw error;
  } finally {
    await cleanup(names);
    writeFileSync(options.output, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const outputStat = statSync(options.output);
    invariant(outputStat.isFile(), "replica evidence was not written");
    invariant(
      (outputStat.mode & 0o777) === 0o600,
      "replica evidence permissions are not 0600",
    );
  }
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
