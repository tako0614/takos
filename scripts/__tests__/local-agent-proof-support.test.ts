import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCoreDumpsDisabled,
  assertFreshAgentProofBuild,
  assertLocalhostComposePorts,
  cleanupLocalE2eProject,
  createLocalE2eProjectCleanup,
  createLocalProofInterruption,
  createOfficialAgentProofEnvironment,
  computeAgentSourceFingerprint,
  installLocalProofSignalHandlers,
  parseLocalhostPublishedPort,
  parseLiveProofEvidence,
  type LocalProofDockerRunner,
} from "../local-agent-proof-support.ts";

const SOURCE_FINGERPRINT = "a".repeat(64);

function validStdout(sourceFingerprint = SOURCE_FINGERPRINT): string {
  return [
    `[local-e2e] agent image proof ${JSON.stringify({
      kind: "takos.local-agent-image-proof@v1",
      imageId: `sha256:${"b".repeat(64)}`,
      sourceFingerprint,
      sourceFingerprintMatched: true,
    })}`,
    `[local-e2e] agent run proof ${JSON.stringify({
      kind: "takos.local-agent-run-proof@v1",
      spaceId: "space-proof",
      threadId: "thread-proof",
      runId: "run-proof",
      status: "completed",
      observedStatuses: ["queued", "completed"],
      eventTypes: ["started", "message", "completed"],
      workspaceListObserved: true,
      runOutputObserved: true,
      assistantMessageObserved: true,
      terminalEventObserved: true,
      pollCount: 2,
    })}`,
  ].join("\n");
}

describe("local agent proof support", () => {
  test("rejects skip-build for official live evidence", () => {
    expect(() => assertFreshAgentProofBuild("1")).toThrow(
      "fresh source-verified image build is required",
    );
    expect(() => assertFreshAgentProofBuild("0")).not.toThrow();
    expect(() => assertFreshAgentProofBuild(undefined)).not.toThrow();
  });

  test("creates isolated official project, dynamic ports, and per-run secrets", () => {
    let uuidIndex = 0;
    const randomUUID = () => {
      uuidIndex += 1;
      const marker = String.fromCharCode(96 + uuidIndex).repeat(8);
      return `${marker}-0000-4000-8000-000000000000`;
    };
    const first = createOfficialAgentProofEnvironment({
      pid: 42,
      now: () => 1_234,
      randomUUID,
    });
    const second = createOfficialAgentProofEnvironment({
      pid: 42,
      now: () => 1_234,
      randomUUID,
    });

    expect(first.TAKOS_LOCAL_E2E_PROJECT).toMatch(
      /^takos-agent-proof-42-ya-[a-z0-9]{20}$/u,
    );
    expect(second.TAKOS_LOCAL_E2E_PROJECT).not.toBe(
      first.TAKOS_LOCAL_E2E_PROJECT,
    );
    expect(first.TAKOS_WORKER_PORT).toBe("8787");
    expect(first.TAKOS_WORKER_HOST_PORT).toBe("0");
    expect(first.TAKOSUMI_HOST_PORT).toBe("0");
    expect(first.TAKOS_AGENT_HOST_PORT).toBe("0");
    expect(first.TAKOS_AGENT_PROOF_PORT).toBe("0");
    expect(first.TAKOS_POSTGRES_PORT).toBe("0");
    expect(first.TAKOS_REDIS_PORT).toBe("0");
    expect(
      new Set([
        first.TAKOS_INTERNAL_SERVICE_SECRET,
        first.TAKOS_AGENT_START_TOKEN,
        first.TAKOS_AGENT_PROOF_SECRET,
        first.TAKOS_AGENT_PROOF_DISPATCH_SECRET,
        first.TAKOS_AGENT_PROOF_MODEL_KEY,
      ]).size,
    ).toBe(5);
    expect(first.TAKOS_AGENT_PROOF_DISPATCH_SECRET).not.toBe(
      second.TAKOS_AGENT_PROOF_DISPATCH_SECRET,
    );
  });

  test("records only the first termination signal and preserves its exit code", () => {
    const interruption = createLocalProofInterruption();
    expect(interruption.interrupt("SIGTERM")).toBe(true);
    expect(interruption.signal.aborted).toBe(true);
    expect(interruption.receivedSignal).toBe("SIGTERM");
    expect(interruption.exitCode).toBe(143);
    expect(interruption.interrupt("SIGINT")).toBe(false);
    expect(interruption.receivedSignal).toBe("SIGTERM");
  });

  test("signal handlers abort once and remove both process listeners", () => {
    const interruption = createLocalProofInterruption();
    const target = new EventEmitter();
    const observed: string[] = [];
    const remove = installLocalProofSignalHandlers({
      interruption,
      target,
      onInterrupt: (signal) => observed.push(signal),
    });

    expect(target.listenerCount("SIGINT")).toBe(1);
    expect(target.listenerCount("SIGTERM")).toBe(1);
    target.emit("SIGINT");

    expect(observed).toEqual(["SIGINT"]);
    expect(interruption.signal.aborted).toBe(true);
    expect(target.listenerCount("SIGINT")).toBe(0);
    expect(target.listenerCount("SIGTERM")).toBe(0);
    target.emit("SIGTERM");
    expect(observed).toEqual(["SIGINT"]);
    expect(() => remove()).not.toThrow();
  });

  test("accepts only one Docker-assigned localhost binding", () => {
    expect(
      parseLocalhostPublishedPort("127.0.0.1:49152\n", "takos-worker"),
    ).toBe("49152");
    expect(() =>
      parseLocalhostPublishedPort("0.0.0.0:49152\n", "takos-worker"),
    ).toThrow("Docker-assigned 127.0.0.1 port");
    expect(() =>
      parseLocalhostPublishedPort(
        "127.0.0.1:49152\n127.0.0.1:49153\n",
        "takos-worker",
      ),
    ).toThrow("exactly one localhost port binding");
  });

  test("requires every rendered compose port to bind localhost", () => {
    const expected = [
      { service: "postgres", target: 5432, published: "15432" },
      { service: "takos-worker", target: 8787, published: "18787" },
    ];
    const localhostConfig = JSON.stringify({
      services: {
        postgres: {
          ports: [{ host_ip: "127.0.0.1", target: 5432, published: "15432" }],
        },
        "takos-worker": {
          ports: [{ host_ip: "127.0.0.1", target: 8787, published: "18787" }],
        },
      },
    });
    expect(() =>
      assertLocalhostComposePorts(localhostConfig, expected),
    ).not.toThrow();

    const exposedConfig = localhostConfig.replace(
      '"host_ip":"127.0.0.1"',
      '"host_ip":"0.0.0.0"',
    );
    expect(() => assertLocalhostComposePorts(exposedConfig, expected)).toThrow(
      "postgres must publish only 127.0.0.1:15432:5432",
    );

    const extraSurfaceConfig = localhostConfig.replace(
      '"target":5432,"published":"15432"',
      '"target":5432,"published":"15432"},{"host_ip":"0.0.0.0","target":9000,"published":"9000"',
    );
    expect(() =>
      assertLocalhostComposePorts(extraSurfaceConfig, expected),
    ).toThrow("postgres must publish only 127.0.0.1:15432:5432");
  });

  test("requires every proof service to disable core dumps", () => {
    const secureConfig = JSON.stringify({
      services: {
        worker: { ulimits: { core: {} } },
        agent: { ulimits: { core: 0 } },
      },
    });
    expect(() =>
      assertCoreDumpsDisabled(secureConfig, ["worker", "agent"]),
    ).not.toThrow();

    const unsafeConfig = JSON.stringify({
      services: {
        worker: { ulimits: { core: { hard: 0, soft: 0 } } },
        agent: {},
      },
    });
    expect(() =>
      assertCoreDumpsDisabled(unsafeConfig, ["worker", "agent"]),
    ).toThrow("agent must disable core dumps with ulimit 0");
  });

  test("requires complete run evidence and matching image provenance", () => {
    expect(parseLiveProofEvidence(validStdout(), SOURCE_FINGERPRINT).ok).toBe(
      true,
    );
    expect(
      parseLiveProofEvidence(validStdout("c".repeat(64)), SOURCE_FINGERPRINT),
    ).toEqual({
      ok: false,
      reason: "local:e2e agent image provenance did not match current source",
    });
    const missingTerminal = validStdout().replace(
      '["started","message","completed"]',
      '["started","message"]',
    );
    expect(parseLiveProofEvidence(missingTerminal, SOURCE_FINGERPRINT)).toEqual(
      {
        ok: false,
        reason: "local:e2e emitted incomplete public API agent run evidence",
      },
    );
    const fastCompletion = validStdout().replace(
      '["queued","completed"]',
      '["completed"]',
    );
    expect(parseLiveProofEvidence(fastCompletion, SOURCE_FINGERPRINT).ok).toBe(
      true,
    );
  });

  test("fingerprints the exact current agent Docker build inputs", async () => {
    const fingerprint = await computeAgentSourceFingerprint(process.cwd());
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("uses project-scoped local-image cleanup and verifies no residue", async () => {
    const calls: string[][] = [];
    const runDocker: LocalProofDockerRunner = async (args) => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    };

    await cleanupLocalE2eProject({
      composeArgs: ["compose", "-p", "proof-project"],
      commandEnv: {},
      project: "proof-project",
      runDocker,
    });

    expect(calls[0]).toEqual([
      "compose",
      "-p",
      "proof-project",
      "down",
      "--volumes",
      "--remove-orphans",
      "--rmi",
      "local",
      "--timeout",
      "10",
    ]);
    const listCalls = calls.slice(1);
    expect(listCalls.length).toBe(8);
    expect(
      listCalls.every((args) =>
        args.includes("label=com.docker.compose.project=proof-project"),
      ),
    ).toBe(true);
  });

  test("deduplicates concurrent cleanup requests", async () => {
    const calls: string[][] = [];
    const runDocker: LocalProofDockerRunner = async (args) => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    };
    const cleanup = createLocalE2eProjectCleanup({
      composeArgs: ["compose", "-p", "proof-project"],
      commandEnv: {},
      project: "proof-project",
      runDocker,
    });

    await Promise.all([cleanup(), cleanup(), cleanup()]);

    expect(calls.filter((args) => args.includes("down"))).toHaveLength(1);
  });

  test("removes and reports a core dump left by the project", async () => {
    const directory = await mkdtemp(join(tmpdir(), "takos-proof-core-"));
    const corePath = join(directory, "core");
    await writeFile(corePath, "generated core fixture");
    const runDocker: LocalProofDockerRunner = async () => ({
      code: 0,
      stdout: "",
      stderr: "",
    });

    try {
      await expect(
        cleanupLocalE2eProject({
          composeArgs: ["compose", "-p", "proof-project"],
          commandEnv: {},
          project: "proof-project",
          coreArtifactPaths: [corePath],
          runDocker,
        }),
      ).rejects.toThrow("core dump artifact remained: core");
      await expect(access(corePath)).rejects.toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("propagates down failure after removing exact project residue", async () => {
    const calls: string[][] = [];
    let listCalls = 0;
    const runDocker: LocalProofDockerRunner = async (args) => {
      calls.push(args);
      if (args.includes("down")) {
        return { code: 1, stdout: "", stderr: "daemon interrupted" };
      }
      if (args.includes("--filter")) {
        const round = Math.floor(listCalls / 4);
        listCalls += 1;
        if (round === 0 && args[0] === "ps") {
          return { code: 0, stdout: "container-proof\n", stderr: "" };
        }
        if (round === 0 && args[0] === "image") {
          return { code: 0, stdout: "image-proof\n", stderr: "" };
        }
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    await expect(
      cleanupLocalE2eProject({
        composeArgs: ["compose", "-p", "proof-project"],
        commandEnv: {},
        project: "proof-project",
        runDocker,
      }),
    ).rejects.toThrow("docker compose down failed with 1");

    expect(calls).toContainEqual(["rm", "-f", "container-proof"]);
    expect(calls).toContainEqual(["image", "rm", "image-proof"]);
    expect(
      calls.every(
        (args) =>
          !args.includes("--filter") ||
          args.includes("label=com.docker.compose.project=proof-project"),
      ),
    ).toBe(true);
  });

  test("continues project-scoped fallback cleanup when compose down throws", async () => {
    const calls: string[][] = [];
    let listCalls = 0;
    const runDocker: LocalProofDockerRunner = async (args) => {
      calls.push(args);
      if (args.includes("down")) throw new Error("down timed out");
      if (args.includes("--filter")) {
        const round = Math.floor(listCalls / 4);
        listCalls += 1;
        if (round === 0 && args[0] === "volume") {
          return { code: 0, stdout: "volume-proof\n", stderr: "" };
        }
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    await expect(
      cleanupLocalE2eProject({
        composeArgs: ["compose", "-p", "proof-project"],
        commandEnv: {},
        project: "proof-project",
        runDocker,
      }),
    ).rejects.toThrow("docker compose down failed: down timed out");
    expect(calls).toContainEqual(["volume", "rm", "-f", "volume-proof"]);
  });
});
