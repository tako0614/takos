import * as runtime from "./runtime.ts";
import { resolve } from "node:path";
import { runLocalAgentPublicApiProof } from "./local-agent-proof.ts";
import {
  cleanupTakosumiDependencies,
  prepareTakosumiDependencies,
} from "./local-takosumi-dependencies.ts";
import {
  AGENT_SOURCE_FINGERPRINT_LABEL,
  assertCoreDumpsDisabled,
  assertFreshAgentProofBuild,
  assertLocalhostComposePorts,
  computeAgentSourceFingerprint,
  createLocalE2eProjectCleanup,
  createLocalProofInterruption,
  installLocalProofSignalHandlers,
  parseLocalhostPublishedPort,
} from "./local-agent-proof-support.ts";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

const servicePorts = [
  {
    label: "takos-worker",
    resultKey: "TAKOS_WORKER_PORT",
    publishedEnv: "TAKOS_WORKER_HOST_PORT",
  },
  {
    label: "takosumi",
    resultKey: "TAKOSUMI_PORT",
    publishedEnv: "TAKOSUMI_HOST_PORT",
  },
  {
    label: "takos-agent",
    resultKey: "TAKOS_AGENT_PORT",
    publishedEnv: "TAKOS_AGENT_HOST_PORT",
  },
  {
    label: "agent-proof-runtime",
    resultKey: "TAKOS_AGENT_PROOF_PORT",
    publishedEnv: "TAKOS_AGENT_PROOF_PORT",
  },
  {
    label: "postgres",
    resultKey: "TAKOS_POSTGRES_PORT",
    publishedEnv: "TAKOS_POSTGRES_PORT",
  },
  {
    label: "redis",
    resultKey: "TAKOS_REDIS_PORT",
    publishedEnv: "TAKOS_REDIS_PORT",
  },
];

const interruption = createLocalProofInterruption();
const activeCommands = new Set();

function env(name, fallback) {
  return runtime.env.get(name) || fallback;
}

function numberEnv(name, fallback) {
  const value = Number(runtime.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function delay(ms) {
  if (interruption.signal.aborted) {
    return Promise.reject(interruption.signal.reason);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    interruption.signal.addEventListener("abort", abort, { once: true });
    function finish() {
      interruption.signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(interruption.signal.reason);
    }
  });
}

function composeBaseArgs(project, envFile) {
  return [
    "compose",
    "--env-file",
    envFile,
    "-p",
    project,
    "-f",
    "compose.local.yml",
    "-f",
    "scripts/local-agent-proof.compose.yml",
  ];
}

function dynamicPublishedPortEnvironment() {
  return Object.fromEntries(
    servicePorts.map((service) => [service.publishedEnv, "0"]),
  );
}

function configuredPortTargets(config) {
  const targets = {};
  for (const service of servicePorts) {
    const ports = config?.services?.[service.label]?.ports;
    const target = Array.isArray(ports) ? Number(ports[0]?.target) : 0;
    if (!Number.isInteger(target) || target < 1 || target > 65_535) {
      throw new Error(
        `docker compose service ${service.label} has no valid target port`,
      );
    }
    targets[service.label] = target;
  }
  return targets;
}

async function runCommand(commandName, args, options = {}) {
  const {
    check = true,
    cwd,
    env = {},
    ignoreInterruption = false,
    timeoutMs = numberEnv("TAKOS_LOCAL_E2E_COMMAND_TIMEOUT_MS", 5 * 60 * 1000),
  } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortForInterruption = () =>
    controller.abort(interruption.signal.reason);
  if (!ignoreInterruption) {
    if (interruption.signal.aborted) abortForInterruption();
    else {
      interruption.signal.addEventListener("abort", abortForInterruption, {
        once: true,
      });
    }
  }
  const command = runtime.runCommand(commandName, {
    args,
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    signal: controller.signal,
  });
  activeCommands.add(command);
  try {
    const output = await command;
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    if (!ignoreInterruption && interruption.signal.aborted) {
      throw interruption.signal.reason;
    }
    if (check && output.code !== 0) {
      throw new Error(
        `${commandName} ${args.join(" ")} failed with ${output.code}\n${stdout}${stderr}`,
      );
    }
    return { code: output.code, stdout, stderr };
  } catch (error) {
    if (!ignoreInterruption && interruption.signal.aborted) {
      throw interruption.signal.reason;
    }
    if (timedOut || error?.name === "AbortError") {
      throw new Error(
        `${commandName} ${args.join(" ")} timed out after ${timeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    activeCommands.delete(command);
    clearTimeout(timer);
    interruption.signal.removeEventListener("abort", abortForInterruption);
  }
}

async function waitForActiveCommands() {
  await Promise.allSettled([...activeCommands]);
}

async function runDocker(args, options = {}) {
  return await runCommand("docker", args, options);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortForInterruption = () =>
    controller.abort(interruption.signal.reason);
  if (interruption.signal.aborted) abortForInterruption();
  else {
    interruption.signal.addEventListener("abort", abortForInterruption, {
      once: true,
    });
  }
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    interruption.signal.removeEventListener("abort", abortForInterruption);
  }
}

async function waitForHealth(ports) {
  const timeoutMs = numberEnv("TAKOS_LOCAL_E2E_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = numberEnv(
    "TAKOS_LOCAL_E2E_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );
  const deadline = Date.now() + timeoutMs;
  const healthChecks = [
    {
      label: "takos-worker",
      url: `http://127.0.0.1:${ports.TAKOS_WORKER_PORT}/health`,
    },
    {
      label: "takosumi",
      url: `http://127.0.0.1:${ports.TAKOSUMI_PORT}/livez`,
    },
    {
      label: "takos-agent",
      url: `http://127.0.0.1:${ports.TAKOS_AGENT_PORT}/health`,
    },
    {
      label: "agent-proof-runtime",
      url: `http://127.0.0.1:${ports.TAKOS_AGENT_PROOF_PORT}/health`,
    },
  ];
  const pending = new Map(healthChecks.map((check) => [check.label, check]));
  const lastErrors = new Map();

  while (pending.size > 0 && Date.now() < deadline) {
    for (const [label, check] of [...pending]) {
      try {
        const response = await fetchWithTimeout(check.url);
        const bodyText = await response.text();
        if (!response.ok) {
          lastErrors.set(label, `${response.status} ${bodyText}`);
          continue;
        }
        JSON.parse(bodyText);
        pending.delete(label);
        console.log(`[local-e2e] ${label} health ok`);
      } catch (error) {
        lastErrors.set(
          label,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (pending.size > 0) await delay(pollIntervalMs);
  }

  if (pending.size > 0) {
    const details = [...pending.keys()]
      .map((label) => `${label}: ${lastErrors.get(label) ?? "not ready"}`)
      .join("\n");
    throw new Error(`compose services did not become healthy:\n${details}`);
  }
}

async function discoverPublishedPorts(composeArgs, commandEnv, targets) {
  const ports = {};
  for (const service of servicePorts) {
    const target = targets[service.label];
    const published = await runDocker(
      [...composeArgs, "port", service.label, String(target)],
      { env: commandEnv, timeoutMs: 60_000 },
    );
    ports[service.resultKey] = parseLocalhostPublishedPort(
      published.stdout,
      service.label,
    );
  }
  return ports;
}

async function verifyProofBridge(ports) {
  const unauthorizedDispatch = await fetchWithTimeout(
    `http://127.0.0.1:${ports.TAKOS_AGENT_PROOF_PORT}/dispatch`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "unauthorized-proof-probe",
        serviceId: "unauthorized-proof-probe",
      }),
    },
    5_000,
  );
  if (unauthorizedDispatch.status !== 401) {
    throw new Error(
      `agent proof dispatch accepted an unauthenticated request (${unauthorizedDispatch.status})`,
    );
  }
  console.log("[local-e2e] proof bridge authentication boundary ok");
}

async function verifyAgentImageProvenance(
  composeArgs,
  commandEnv,
  sourceFingerprint,
) {
  const imageResult = await runDocker(
    [...composeArgs, "images", "-q", "takos-agent"],
    { env: commandEnv, timeoutMs: 60_000 },
  );
  const imageIds = [
    ...new Set(
      imageResult.stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (imageIds.length !== 1) {
    throw new Error(
      `expected one takos-agent image after build, got ${imageIds.length}`,
    );
  }
  const imageId = imageIds[0];
  const label = await runDocker(
    [
      "image",
      "inspect",
      "--format",
      `{{ index .Config.Labels "${AGENT_SOURCE_FINGERPRINT_LABEL}" }}`,
      imageId,
    ],
    { env: commandEnv, timeoutMs: 60_000 },
  );
  if (label.stdout.trim() !== sourceFingerprint) {
    throw new Error(
      "takos-agent image source fingerprint does not match the current Rust build inputs",
    );
  }
  return {
    kind: "takos.local-agent-image-proof@v1",
    imageId,
    sourceFingerprint,
    sourceFingerprintMatched: true,
  };
}

async function printDiagnostics(composeArgs, commandEnv) {
  const ps = await runDocker([...composeArgs, "ps"], {
    check: false,
    env: commandEnv,
    timeoutMs: 60_000,
  });
  if (ps.stdout.trim()) console.error(ps.stdout.trim());
  if (ps.stderr.trim()) console.error(ps.stderr.trim());

  const logs = await runDocker(
    [...composeArgs, "logs", "--no-color", "--tail", "160"],
    {
      check: false,
      env: commandEnv,
      timeoutMs: 120_000,
    },
  );
  if (logs.stdout.trim()) console.error(logs.stdout.trim());
  if (logs.stderr.trim()) console.error(logs.stderr.trim());
}

async function main() {
  assertFreshAgentProofBuild(runtime.env.get("TAKOS_LOCAL_E2E_SKIP_BUILD"));
  const takosRoot = runtime.cwd();
  const takosumiRoot = resolve(
    takosRoot,
    env("TAKOSUMI_SOURCE_DIR", "../takosumi"),
  );
  const sourceFingerprint = await computeAgentSourceFingerprint(takosRoot);
  const project = env(
    "TAKOS_LOCAL_E2E_PROJECT",
    `takos-e2e-${Date.now()}-${runtime.pid}`,
  );
  const envFile = env("TAKOS_LOCAL_ENV_FILE", ".env.local.example");
  const secret = env("TAKOS_INTERNAL_SERVICE_SECRET", "local-dev-secret");
  const proofSecret = env(
    "TAKOS_AGENT_PROOF_SECRET",
    `local-agent-proof-${crypto.randomUUID()}`,
  );
  const proofDispatchSecret = env(
    "TAKOS_AGENT_PROOF_DISPATCH_SECRET",
    `local-agent-proof-dispatch-${crypto.randomUUID()}`,
  );
  const proofModelKey = env(
    "TAKOS_AGENT_PROOF_MODEL_KEY",
    "local-agent-proof-model-key",
  );
  const commandEnv = {
    ...dynamicPublishedPortEnvironment(),
    TAKOSUMI_SOURCE_DIR: takosumiRoot,
    TAKOS_WORKER_URL: "",
    TAKOS_INTERNAL_SERVICE_SECRET: secret,
    TAKOS_INTERNAL_API_SECRET: env("TAKOS_INTERNAL_API_SECRET", secret),
    TAKOSUMI_INTERNAL_API_SECRET: env("TAKOSUMI_INTERNAL_API_SECRET", secret),
    TAKOS_AGENT_PROOF_SECRET: proofSecret,
    TAKOS_AGENT_PROOF_DISPATCH_SECRET: proofDispatchSecret,
    TAKOS_AGENT_PROOF_MODEL_KEY: proofModelKey,
    TAKOS_AGENT_SOURCE_FINGERPRINT: sourceFingerprint,
  };
  const composeArgs = composeBaseArgs(project, envFile);
  const keepStack = runtime.env.get("TAKOS_LOCAL_E2E_KEEP_STACK") === "1";
  let started = false;
  let startAttempted = false;
  let failure = null;
  let preparedTakosumiDependencies = null;
  const cleanupProject = createLocalE2eProjectCleanup({
    composeArgs,
    commandEnv,
    project,
    coreArtifactPaths: [resolve(takosRoot, "core")],
    runDocker: (args, options) =>
      runDocker(args, { ...options, ignoreInterruption: true }),
  });
  let requestedCleanup = null;
  const requestCleanup = () => {
    requestedCleanup ??= (async () => {
      await waitForActiveCommands();
      await cleanupProject();
    })();
    return requestedCleanup;
  };
  const removeTerminationHandlers = installLocalProofSignalHandlers({
    interruption,
    onInterrupt(signal) {
      console.error(
        `[local-e2e] received ${signal}; aborting active work before project cleanup`,
      );
      if (startAttempted) void requestCleanup().catch(() => {});
    },
  });

  console.log(`[local-e2e] project=${project}`);
  console.log("[local-e2e] requesting Docker-assigned localhost ports");

  try {
    preparedTakosumiDependencies = await prepareTakosumiDependencies({
      takosumiRoot,
      install: async (dependencyRoot) => {
        const result = await runCommand(
          "bun",
          ["install", "--frozen-lockfile", "--ignore-scripts"],
          {
            check: false,
            cwd: dependencyRoot,
            timeoutMs: numberEnv(
              "TAKOS_LOCAL_E2E_DEPENDENCY_TIMEOUT_MS",
              5 * 60 * 1000,
            ),
          },
        );
        if (result.code !== 0) {
          throw new Error(
            `isolated Takosumi dependency install rejected its frozen lockfile (exit ${result.code})`,
          );
        }
      },
    });
    commandEnv.TAKOSUMI_E2E_WORKSPACE_PATH =
      preparedTakosumiDependencies.workspaceRoot;
    console.log(
      `[local-e2e] Takosumi frozen dependencies ready (lock sha256 ${preparedTakosumiDependencies.lockDigest.slice(0, 12)})`,
    );

    const config = await runDocker(
      [...composeArgs, "config", "--format", "json"],
      {
        env: commandEnv,
        timeoutMs: 120_000,
      },
    );
    const renderedConfig = JSON.parse(config.stdout);
    const targets = configuredPortTargets(renderedConfig);
    assertLocalhostComposePorts(
      config.stdout,
      servicePorts.map((service) => ({
        service: service.label,
        target: targets[service.label],
        published: "0",
      })),
    );
    const services = Object.keys(renderedConfig.services).sort();
    const expectedServices = [
      "postgres",
      "postgres-init",
      "redis",
      "agent-proof-runtime",
      "takos-agent",
      "takos-worker",
      "takosumi",
    ];
    for (const expected of expectedServices) {
      if (!services.includes(expected)) {
        throw new Error(`compose config is missing service ${expected}`);
      }
    }
    assertCoreDumpsDisabled(config.stdout, expectedServices);
    console.log(
      `[local-e2e] compose config/localhost bindings ok (${services.join(", ")})`,
    );

    startAttempted = true;
    await runDocker(
      [
        ...composeArgs,
        "run",
        "--rm",
        "--no-deps",
        "takosumi",
        "bun",
        "build",
        "--target=bun",
        "core/index.ts",
        "--outfile",
        "/tmp/takosumi-local-e2e-preflight.mjs",
      ],
      { env: commandEnv, timeoutMs: 120_000 },
    );
    console.log("[local-e2e] Takosumi service import preflight ok");

    const upArgs = [...composeArgs, "up", "--build", "-d"];
    await runDocker(upArgs, {
      env: commandEnv,
      timeoutMs: numberEnv("TAKOS_LOCAL_E2E_UP_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    });
    started = true;
    console.log("[local-e2e] compose stack started");

    const ports = await discoverPublishedPorts(
      composeArgs,
      commandEnv,
      targets,
    );
    console.log(
      `[local-e2e] Docker-assigned ports worker=${ports.TAKOS_WORKER_PORT} takosumi=${ports.TAKOSUMI_PORT} agent=${ports.TAKOS_AGENT_PORT} proof=${ports.TAKOS_AGENT_PROOF_PORT}`,
    );

    const sourceFingerprintAfterBuild =
      await computeAgentSourceFingerprint(takosRoot);
    if (sourceFingerprintAfterBuild !== sourceFingerprint) {
      throw new Error(
        "takos-agent Rust build inputs changed while the proof image was building",
      );
    }
    const imageProof = await verifyAgentImageProvenance(
      composeArgs,
      commandEnv,
      sourceFingerprint,
    );
    console.log(`[local-e2e] agent image proof ${JSON.stringify(imageProof)}`);

    await waitForHealth(ports);
    await verifyProofBridge(ports);
    const proof = await runLocalAgentPublicApiProof({
      workerBaseUrl: `http://127.0.0.1:${ports.TAKOS_WORKER_PORT}`,
      proofRuntimeBaseUrl: `http://127.0.0.1:${ports.TAKOS_AGENT_PROOF_PORT}`,
      proofSecret,
      timeoutMs: numberEnv("TAKOS_LOCAL_E2E_RUN_TIMEOUT_MS", 120_000),
      pollIntervalMs: numberEnv("TAKOS_LOCAL_E2E_RUN_POLL_INTERVAL_MS", 500),
      signal: interruption.signal,
    });
    console.log(`[local-e2e] agent run proof ${JSON.stringify(proof)}`);
  } catch (error) {
    failure = error;
    console.error(
      `[local-e2e] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!interruption.signal.aborted && startAttempted) {
      await printDiagnostics(composeArgs, commandEnv).catch(
        (diagnosticError) => {
          console.error(
            `[local-e2e] failed to collect diagnostics: ${
              diagnosticError instanceof Error
                ? diagnosticError.message
                : String(diagnosticError)
            }`,
          );
        },
      );
    }
  } finally {
    if (startAttempted && (!keepStack || interruption.signal.aborted)) {
      try {
        await requestCleanup();
        console.log("[local-e2e] compose stack and project image cleaned up");
      } catch (cleanupError) {
        failure = combineFailures(failure, cleanupError);
      }
    } else if (started) {
      console.log("[local-e2e] keeping compose stack for inspection");
    }
    if (!started || !keepStack || interruption.signal.aborted) {
      try {
        await cleanupTakosumiDependencies(preparedTakosumiDependencies);
      } catch (dependencyCleanupError) {
        failure = combineFailures(failure, dependencyCleanupError);
      }
    } else if (preparedTakosumiDependencies) {
      console.log(
        `[local-e2e] keeping isolated Takosumi workspace for the retained stack: ${preparedTakosumiDependencies.workspaceRoot}`,
      );
    }
    removeTerminationHandlers();
  }
  if (interruption.signal.aborted && !failure) {
    failure = interruption.signal.reason;
  }
  if (failure) throw failure;
  console.log("[local-e2e] completed");
}

function combineFailures(primary, cleanup) {
  if (!primary) return cleanup;
  const primaryMessage =
    primary instanceof Error ? primary.message : String(primary);
  const cleanupMessage =
    cleanup instanceof Error ? cleanup.message : String(cleanup);
  return new Error(
    `local E2E failed: ${primaryMessage}\ncleanup also failed: ${cleanupMessage}`,
    { cause: new AggregateError([primary, cleanup]) },
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  runtime.exit(interruption.receivedSignal ? interruption.exitCode : 1);
});
