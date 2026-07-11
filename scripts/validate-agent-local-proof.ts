#!/usr/bin/env -S bun
import { resolve } from "node:path";
import * as runtime from "./runtime.ts";
import {
  assertFreshAgentProofBuild,
  computeAgentSourceFingerprint,
  createLocalProofInterruption,
  createOfficialAgentProofEnvironment,
  installLocalProofSignalHandlers,
  parseLiveProofEvidence,
} from "./local-agent-proof-support.ts";

type ProofStep = {
  name: string;
  command: string[];
  cwd: string;
  status: "passed" | "failed" | "unavailable" | "not_requested";
  exitCode: number | null;
  reason?: string;
  evidence?: unknown;
};

type ProofStepConfig = {
  name: string;
  command: string[];
  cwd: string;
  env?: Record<string, string>;
};

const takosRoot = runtime.cwd();
const componentSteps: readonly ProofStepConfig[] = [
  {
    name: "public-api-agent-proof-driver",
    command: [
      "bun",
      "test",
      "scripts/__tests__/local-agent-proof.test.ts",
      "scripts/__tests__/local-agent-proof-support.test.ts",
    ],
    cwd: takosRoot,
  },
  {
    name: "worker-agent-atomic-lifecycle-and-proof",
    command: [
      "bun",
      "test",
      "src/worker/application/services/agent/__tests__/complete-run.test.ts",
      "src/worker/application/services/run-notifier/__tests__/index-outbox.test.ts",
      "src/worker/application/services/run-notifier/__tests__/terminal-transition.test.ts",
      "src/worker/runtime/container-hosts/__tests__/executor-complete-run-validation.test.ts",
      "src/worker/runtime/container-hosts/__tests__/executor-control-rpc-cache.test.ts",
      "src/worker/runtime/container-hosts/__tests__/executor-control-rpc-checkpoint.test.ts",
      "src/worker/runtime/container-hosts/__tests__/executor-control-rpc-lease.test.ts",
      "src/worker/runtime/container-hosts/__tests__/executor-control-rpc.test.ts",
      "src/worker/runtime/container-hosts/__tests__/executor-token-lifecycle.test.ts",
      "src/worker/runtime/indexer/__tests__/handlers.test.ts",
      "src/worker/runtime/indexer/__tests__/index.test.ts",
      "src/worker/runtime/runner/__tests__/agent-proof.test.ts",
      "src/worker/runtime/runner/__tests__/cron-handler.test.ts",
      "src/worker/runtime/runner/__tests__/run-queue-policy.test.ts",
      "src/worker/local-platform/__tests__/worker-forwarding-auth.test.ts",
    ],
    cwd: takosRoot,
  },
  {
    name: "agent-container-external-context-protocol",
    command: ["cargo", "test", "--all-features"],
    cwd: resolve(takosRoot, "containers/agent"),
    env: {
      OPENAI_API_KEY: "",
      OPENAI_EMBEDDING_API_KEY: "",
      TAKOS_EMBEDDING_API_KEY: "",
      EMBEDDING_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GOOGLE_API_KEY: "",
    },
  },
] as const;

const results: ProofStep[] = [];
const liveMode = process.env.TAKOS_AGENT_LOCAL_PROOF_MODE?.trim() || "required";
if (liveMode !== "required" && liveMode !== "components") {
  failValidation(
    `TAKOS_AGENT_LOCAL_PROOF_MODE must be required or components (got ${liveMode})`,
  );
}
try {
  assertFreshAgentProofBuild(process.env.TAKOS_LOCAL_E2E_SKIP_BUILD);
} catch (error) {
  failValidation(error instanceof Error ? error.message : String(error));
}

for (const step of componentSteps) {
  const [command, ...args] = step.command;
  const result = await runtime.runCommand(command, {
    args,
    cwd: step.cwd,
    env: step.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const proofStep: ProofStep = {
    name: step.name,
    command: step.command,
    cwd: relativeOrSame(takosRoot, step.cwd),
    status: result.success ? "passed" : "failed",
    exitCode: result.code,
  };
  results.push(proofStep);
  if (!result.success) {
    console.error(decode(result.stdout));
    console.error(decode(result.stderr));
    console.error(
      JSON.stringify(
        {
          ok: false,
          complete: false,
          kind: "takos.agent-local-proof@v2",
          failed: proofStep,
          results,
        },
        null,
        2,
      ),
    );
    runtime.exit(result.code || 1);
  }
}

if (liveMode === "components") {
  results.push({
    name: "local-compose-public-api-run",
    command: ["bun", "scripts/local-e2e.mjs"],
    cwd: ".",
    status: "not_requested",
    exitCode: null,
    reason:
      "component-only mode was explicitly selected; no queue/container run evidence was claimed",
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        complete: false,
        kind: "takos.agent-local-proof@v2",
        mode: liveMode,
        checked: results.filter((result) => result.status === "passed").length,
        results,
      },
      null,
      2,
    ),
  );
  runtime.exit(0);
}

const dockerProbe = await probeDocker();
if ("reason" in dockerProbe) {
  results.push({
    name: "local-compose-public-api-run",
    command: ["bun", "scripts/local-e2e.mjs"],
    cwd: ".",
    status: "unavailable",
    exitCode: dockerProbe.exitCode,
    reason: dockerProbe.reason,
  });
  console.error(
    JSON.stringify(
      {
        ok: false,
        complete: false,
        kind: "takos.agent-local-proof@v2",
        mode: liveMode,
        reason:
          "live queue/container evidence is required, but the local Compose substrate is unavailable",
        results,
      },
      null,
      2,
    ),
  );
  runtime.exit(1);
}

const liveCommand = ["bun", "scripts/local-e2e.mjs"];
const expectedSourceFingerprint =
  await computeAgentSourceFingerprint(takosRoot);
const officialRunEnv = createOfficialAgentProofEnvironment();
const validatorInterruption = createLocalProofInterruption();
const removeTerminationHandlers = installLocalProofSignalHandlers({
  interruption: validatorInterruption,
  onInterrupt(signal) {
    console.error(
      `[agent-local-proof] received ${signal}; waiting for isolated child cleanup`,
    );
  },
});
let liveResult: Awaited<ReturnType<typeof runtime.runCommand>>;
try {
  liveResult = await runtime.runCommand(liveCommand[0], {
    args: liveCommand.slice(1),
    cwd: takosRoot,
    env: officialRunEnv,
    stdout: "pipe",
    stderr: "pipe",
    signal: validatorInterruption.signal,
  });
} catch (error) {
  if (validatorInterruption.receivedSignal) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          complete: false,
          kind: "takos.agent-local-proof@v2",
          mode: liveMode,
          reason: `official validator interrupted by ${validatorInterruption.receivedSignal}`,
          results,
        },
        null,
        2,
      ),
    );
    runtime.exit(validatorInterruption.exitCode);
  }
  failValidation(
    `unable to execute local:e2e: ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  removeTerminationHandlers();
}
if (validatorInterruption.receivedSignal) {
  runtime.exit(validatorInterruption.exitCode);
}
const liveStdout = decode(liveResult.stdout);
const liveStderr = decode(liveResult.stderr);
const sourceFingerprintAfter = liveResult.success
  ? await computeAgentSourceFingerprint(takosRoot)
  : null;
const liveEvidence =
  liveResult.success && sourceFingerprintAfter === expectedSourceFingerprint
    ? parseLiveProofEvidence(liveStdout, expectedSourceFingerprint)
    : liveResult.success
      ? {
          ok: false as const,
          reason: "takos-agent Rust build inputs changed during live proof",
        }
      : null;
const livePassed = liveResult.success && liveEvidence?.ok === true;
const liveStep: ProofStep = {
  name: "local-compose-public-api-run",
  command: liveCommand,
  cwd: ".",
  status: livePassed ? "passed" : "failed",
  exitCode: liveResult.code,
};
if (liveEvidence?.ok) {
  liveStep.evidence = liveEvidence.value;
} else {
  liveStep.reason = liveResult.success
    ? liveEvidence && "reason" in liveEvidence
      ? liveEvidence.reason
      : "local:e2e emitted no live proof evidence"
    : summarizeFailure(liveStdout, liveStderr);
}
results.push(liveStep);
if (!livePassed) {
  if (liveStdout) console.error(liveStdout);
  if (liveStderr) console.error(liveStderr);
  console.error(
    JSON.stringify(
      {
        ok: false,
        complete: false,
        kind: "takos.agent-local-proof@v2",
        mode: liveMode,
        failed: liveStep,
        results,
      },
      null,
      2,
    ),
  );
  runtime.exit(liveResult.code || 1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      complete: true,
      kind: "takos.agent-local-proof@v2",
      mode: liveMode,
      checked: results.length,
      prerequisites: {
        auth: "proof-only local OIDC issuer and seeded identity",
        model: "deterministic OpenAI-compatible local endpoint",
        execution:
          "RUN_QUEUE -> local executor bridge -> takos-agent container",
      },
      results,
    },
    null,
    2,
  ),
);

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trimEnd();
}

function relativeOrSame(root: string, path: string): string {
  if (path === root) return ".";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

async function probeDocker(): Promise<
  { ok: true } | { ok: false; reason: string; exitCode: number | null }
> {
  try {
    const result = await runtime.runCommand("docker", {
      args: ["info", "--format", "{{.ServerVersion}}"],
      cwd: takosRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.success) return { ok: true };
    return {
      ok: false,
      exitCode: result.code,
      reason: `docker info failed: ${summarizeFailure(
        decode(result.stdout),
        decode(result.stderr),
      )}`,
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: null,
      reason: `docker command is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function summarizeFailure(stdout: string, stderr: string): string {
  const combined = [stderr, stdout].filter(Boolean).join("\n").trim();
  if (!combined) return "command failed without output";
  return combined.split("\n").slice(-8).join("\n");
}

function failValidation(reason: string): never {
  console.error(
    JSON.stringify(
      {
        ok: false,
        complete: false,
        kind: "takos.agent-local-proof@v2",
        reason,
        results,
      },
      null,
      2,
    ),
  );
  runtime.exit(1);
}
