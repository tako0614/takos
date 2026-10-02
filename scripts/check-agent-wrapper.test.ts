import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertPosixProcessGroupSupport,
  type AgentWrapperCommandRunner,
  runAgentWrapperCommand,
  runAgentWrapperGate,
} from "./check-agent-wrapper.ts";

const PIN_REPOSITORY = "tako0614/takos-agent-engine";

test("refuses missing and mismatched engine pins before running Cargo", async () => {
  const root = await makeTakosFixture();
  const calls: string[] = [];
  const recordRunner: AgentWrapperCommandRunner = (options) => {
    calls.push(`${options.command} ${options.args.join(" ")}`);
    if (options.command === "git") {
      const result = spawnSync(options.command, [...options.args], {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
      });
      return {
        status: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? result.error?.message ?? "",
      };
    }
    return { status: 0, stdout: "" };
  };
  try {
    await writeFile(join(root.wrapper, "engine-source.json"), "{}\n");
    await expect(runAgentWrapperGate({ root: root.path, runner: recordRunner })).rejects.toThrow(
      "Takos agent engine pin must contain exactly",
    );
    expect(calls).toEqual([]);

    const wrongPin = "0".repeat(40);
    await writePin(root.wrapper, wrongPin);
    await expect(runAgentWrapperGate({
      root: root.path,
      env: { TAKOS_AGENT_ENGINE_REPOSITORY: root.engine },
      runner: recordRunner,
    })).rejects.toThrow("resolve the pinned takos-agent-engine commit failed");
    expect(calls.some((call) => call.startsWith("cargo "))).toBe(false);
  } finally {
    await rm(root.path, { recursive: true, force: true });
  }
});

test("refuses Docker/toolchain disagreement before resolving engine source", async () => {
  const root = await makeTakosFixture();
  const calls: string[] = [];
  const runner: AgentWrapperCommandRunner = (options) => {
    calls.push(options.command);
    return { status: 0, stdout: root.commit };
  };
  try {
    await writeFile(
      join(root.wrapper, "Dockerfile"),
      "FROM rust:1.95.0-bookworm AS builder\n",
    );
    await expect(runAgentWrapperGate({
      root: root.path,
      runner,
    })).rejects.toThrow("FROM rust:1.94.0-bookworm AS builder");
    expect(calls).toEqual([]);

    await writeFile(join(root.wrapper, "Dockerfile"), "FROM rust:1.94.0-bookworm AS builder\n");
    await writeFile(
      join(root.wrapper, "rust-toolchain.toml"),
      '[toolchain]\nchannel = "1.93.0"\ncomponents = ["rustfmt", "clippy"]\nprofile = "minimal"\n',
    );
    await expect(runAgentWrapperGate({ root: root.path, runner })).rejects.toThrow(
      "FROM rust:1.93.0-bookworm AS builder",
    );
    expect(calls).toEqual([]);
  } finally {
    await rm(root.path, { recursive: true, force: true });
  }
});

test("archives only the pinned engine commit and runs every wrapper phase in order", async () => {
  const root = await makeTakosFixture();
  const calls: Parameters<AgentWrapperCommandRunner>[0][] = [];
  const sourceLock = join(root.wrapper, "Cargo.lock");
  const lockBefore = await readFile(sourceLock);
  const providerKeys = [
    "OPENAI_API_KEY",
    "OPENAI_EMBEDDING_API_KEY",
    "TAKOS_EMBEDDING_API_KEY",
    "EMBEDDING_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
  ];
  let successWorkspace = "";
  let pinnedEngineContents = "";
  let includedUntrackedFile = false;
  const runner: AgentWrapperCommandRunner = async (options) => {
    calls.push(options);
    if (isWorkerProof(options, root.path)) return { status: 0 };
    if (options.command === "cargo") {
      successWorkspace = resolve(options.cwd, "../../..");
      pinnedEngineContents = await readFile(
        join(successWorkspace, "takos-agent-engine/engine.txt"),
        "utf8",
      );
      includedUntrackedFile = await pathExists(
        join(successWorkspace, "takos-agent-engine/untracked.txt"),
      );
      for (const key of providerKeys) expect(options.env[key]).toBeUndefined();
      expect(options.env.CARGO_BUILD_JOBS).toBe("2");
      const cargoTarget = options.env.CARGO_TARGET_DIR!;
      expect(cargoTarget).toBe(join(root.path, "tmp/agent-wrapper-target"));
      await writeFile(join(cargoTarget, "gate-cache-sentinel"), "keep\n");
      return { status: 0, stdout: "" };
    }
    return runRealCommand(options.command, options.args, options.cwd, options.env);
  };

  try {
    await writeFile(join(root.engine, "engine.txt"), "dirty sibling bytes\n");
    await writeFile(join(root.engine, "untracked.txt"), "must not enter archive\n");
    await runAgentWrapperGate({
      root: root.path,
      env: {
        TAKOS_AGENT_ENGINE_REPOSITORY: root.engine,
        OPENAI_API_KEY: "fixture-openai-secret",
        OPENAI_EMBEDDING_API_KEY: "fixture-openai-embedding-secret",
        TAKOS_EMBEDDING_API_KEY: "fixture-takos-embedding-secret",
        EMBEDDING_API_KEY: "fixture-embedding-secret",
        ANTHROPIC_API_KEY: "fixture-anthropic-secret",
        GOOGLE_API_KEY: "fixture-google-secret",
        RUSTUP_AUTO_INSTALL: "1",
      },
      runner,
      id: "pinned-test",
    });

    expect(pinnedEngineContents).toBe("pinned engine bytes\n");
    expect(includedUntrackedFile).toBe(false);
    expect(await pathExists(successWorkspace)).toBe(false);
    expect(await pathExists(join(root.path, "tmp/agent-wrapper-target"))).toBe(true);
    expect(await readFile(
      join(root.path, "tmp/agent-wrapper-target/gate-cache-sentinel"),
      "utf8",
    )).toBe("keep\n");
    expect(await readFile(sourceLock)).toEqual(lockBefore);

    const cargo = calls.filter((call) => call.command === "cargo");
    expect(cargo.map(({ args }) => cargoPhase(args))).toEqual([
      "fmt --all --check",
      "check --locked --offline --all-targets --all-features",
      "clippy --locked --offline --all-targets -- -D warnings",
      "clippy --locked --offline --all-targets --all-features -- -D warnings",
      "test --locked --offline --all-targets",
      "test --locked --offline --all-targets --features mock-llm",
      "build --locked --offline --bin takos-agent",
    ]);
    expect(cargo.every((call) => call.args[0] === "+1.94.0")).toBe(true);
    expect(cargo.every((call) => call.args[2] === "--manifest-path")).toBe(true);
    expect(cargo.every((call) => call.args[3] === join(
      root.path,
      "tmp/agent-wrapper-gate/pinned-test/takos/containers/agent/Cargo.toml",
    ))).toBe(true);
    expect(calls.some((call) => call.command === "cargo" && call.args.includes("--all-features") && call.args.includes("build"))).toBe(false);
    const proofCalls = calls.filter((call) => isWorkerProof(call, root.path));
    expect(proofCalls).toHaveLength(1);
    expect(proofCalls[0]!.args).toEqual([
      join(root.path, "scripts/prove-agent-worker-recovery.ts"),
      "--binary",
      join(
        root.path,
        "tmp/agent-wrapper-target/debug",
        process.platform === "win32" ? "takos-agent.exe" : "takos-agent",
      ),
      "--root",
      root.path,
    ]);
    expect(proofCalls[0]!.cwd).toBe(root.path);
    expect(proofCalls[0]!.timeoutMs).toBe(360_000);
    expect(proofCalls[0]!.isolateProcessGroup).toBe(true);
    expect(proofCalls[0]!.env).toEqual(cargo.at(-1)!.env);
    expectProviderKeysScrubbed(proofCalls[0]!.env);
    const checkedOrder = calls
      .filter((call) => call.command === "cargo" || isWorkerProof(call, root.path))
      .map((call) => isWorkerProof(call, root.path) ? "worker-recovery-proof" : cargoPhase(call.args));
    expect(checkedOrder).toEqual([
      "fmt --all --check",
      "check --locked --offline --all-targets --all-features",
      "clippy --locked --offline --all-targets -- -D warnings",
      "clippy --locked --offline --all-targets --all-features -- -D warnings",
      "test --locked --offline --all-targets",
      "test --locked --offline --all-targets --features mock-llm",
      "build --locked --offline --bin takos-agent",
      "worker-recovery-proof",
    ]);
    expect(cargo.every((call) => call.timeoutMs === undefined)).toBe(true);
    expect(cargo.every((call) => call.isolateProcessGroup === undefined)).toBe(true);
  } finally {
    await rm(root.path, { recursive: true, force: true });
  }
});

test("propagates Cargo compilation and test failures without running later phases", async () => {
  for (const failedPhase of [
    "check --locked --offline --all-targets --all-features",
    "clippy --locked --offline --all-targets -- -D warnings",
    "test --locked --offline --all-targets",
    "build --locked --offline --bin takos-agent",
  ]) {
    const root = await makeTakosFixture();
    const cargoPhases: string[] = [];
    let failureWorkspace = "";
    let failureTarget = "";
    const proofCalls: typeof cargoPhases = [];
    const runner: AgentWrapperCommandRunner = async (options) => {
      if (isWorkerProof(options, root.path)) {
        proofCalls.push("worker-recovery-proof");
        return { status: 0 };
      }
      if (options.command !== "cargo") {
        return runRealCommand(options.command, options.args, options.cwd, options.env);
      }
      failureWorkspace = resolve(options.cwd, "../../..");
      failureTarget = options.env.CARGO_TARGET_DIR!;
      expectProviderKeysScrubbed(options.env);
      await writeFile(join(failureTarget, "gate-cache-sentinel"), "keep\n");
      const phase = cargoPhase(options.args);
      cargoPhases.push(phase);
      return phase === failedPhase
        ? { status: 41, stderr: `fixture failure at ${phase}` }
        : { status: 0 };
    };
    try {
      await expect(runAgentWrapperGate({
        root: root.path,
        env: {
          TAKOS_AGENT_ENGINE_REPOSITORY: root.engine,
          RUSTUP_AUTO_INSTALL: "1",
        },
        runner,
      })).rejects.toThrow(`fixture failure at ${failedPhase}`);
      expect(await pathExists(failureWorkspace)).toBe(true);
      expect(await pathExists(join(failureWorkspace, "takos/containers/agent/Cargo.toml"))).toBe(true);
      expect(await pathExists(failureTarget)).toBe(true);
      expect(await readFile(join(failureTarget, "gate-cache-sentinel"), "utf8")).toBe("keep\n");
      expect(proofCalls).toEqual([]);
      const fullSequence = [
        "fmt --all --check",
        "check --locked --offline --all-targets --all-features",
        "clippy --locked --offline --all-targets -- -D warnings",
        "clippy --locked --offline --all-targets --all-features -- -D warnings",
        "test --locked --offline --all-targets",
        "test --locked --offline --all-targets --features mock-llm",
        "build --locked --offline --bin takos-agent",
      ];
      expect(cargoPhases).toEqual(fullSequence.slice(0, fullSequence.indexOf(failedPhase) + 1));
    } finally {
      await rm(root.path, { recursive: true, force: true });
    }
  }
});

test("worker recovery proof failure retains the context and prevents cleanup", async () => {
  const root = await makeTakosFixture();
  const calls: Parameters<AgentWrapperCommandRunner>[0][] = [];
  const runner: AgentWrapperCommandRunner = async (options) => {
    calls.push(options);
    if (options.command === "cargo") {
      expectProviderKeysScrubbed(options.env);
      await writeFile(join(options.env.CARGO_TARGET_DIR!, "gate-cache-sentinel"), "keep\n");
      return { status: 0 };
    }
    if (isWorkerProof(options, root.path)) {
      return { status: 23, stderr: "fixture worker recovery failure" };
    }
    return runRealCommand(options.command, options.args, options.cwd, options.env);
  };

  try {
    await expect(runAgentWrapperGate({
      root: root.path,
      env: {
        TAKOS_AGENT_ENGINE_REPOSITORY: root.engine,
        RUSTUP_AUTO_INSTALL: "1",
      },
      runner,
    })).rejects.toThrow("fixture worker recovery failure");
    const proofCalls = calls.filter((call) => isWorkerProof(call, root.path));
    expect(proofCalls).toHaveLength(1);
    expect(proofCalls[0]!.args).toEqual([
      join(root.path, "scripts/prove-agent-worker-recovery.ts"),
      "--binary",
      join(root.path, "tmp/agent-wrapper-target/debug", process.platform === "win32" ? "takos-agent.exe" : "takos-agent"),
      "--root",
      root.path,
    ]);
    expect(proofCalls[0]!.cwd).toBe(root.path);
    expect(proofCalls[0]!.timeoutMs).toBe(360_000);
    expect(proofCalls[0]!.isolateProcessGroup).toBe(true);
    expectProviderKeysScrubbed(proofCalls[0]!.env);
    const cargoCall = calls.find((call) => call.command === "cargo")!;
    const retainedWorkspace = resolve(cargoCall.cwd, "../../..");
    expect(await pathExists(retainedWorkspace)).toBe(true);
    expect(await pathExists(join(retainedWorkspace, "takos/containers/agent/Cargo.toml"))).toBe(true);
    expect(await readFile(
      join(root.path, "tmp/agent-wrapper-target/gate-cache-sentinel"),
      "utf8",
    )).toBe("keep\n");
  } finally {
    await rm(root.path, { recursive: true, force: true });
  }
});

test("locked prepare performs one locked Cargo fetch and leaves Cargo.lock unchanged", async () => {
  const root = await makeTakosFixture();
  const calls: Parameters<AgentWrapperCommandRunner>[0][] = [];
  const lockPath = join(root.wrapper, "Cargo.lock");
  const lockDigest = digest(await readFile(lockPath));
  let prepareWorkspace = "";
  const runner: AgentWrapperCommandRunner = async (options) => {
    calls.push(options);
    if (isWorkerProof(options, root.path)) return { status: 0 };
    if (options.command === "cargo") {
      prepareWorkspace = resolve(options.cwd, "../../..");
      expectProviderKeysScrubbed(options.env);
      await writeFile(join(options.env.CARGO_TARGET_DIR!, "gate-cache-sentinel"), "keep\n");
      return { status: 0 };
    }
    return runRealCommand(options.command, options.args, options.cwd, options.env);
  };
  try {
    await runAgentWrapperGate({
      root: root.path,
      env: {
        TAKOS_AGENT_ENGINE_REPOSITORY: root.engine,
        OPENAI_API_KEY: "fixture-openai-secret",
        OPENAI_EMBEDDING_API_KEY: "fixture-openai-embedding-secret",
        TAKOS_EMBEDDING_API_KEY: "fixture-takos-embedding-secret",
        EMBEDDING_API_KEY: "fixture-embedding-secret",
        ANTHROPIC_API_KEY: "fixture-anthropic-secret",
        GOOGLE_API_KEY: "fixture-google-secret",
        RUSTUP_AUTO_INSTALL: "1",
      },
      args: ["--prepare=locked"],
      runner,
    });
    const cargo = calls.filter((call) => call.command === "cargo");
    expect(calls.filter((call) => isWorkerProof(call, root.path))).toEqual([]);
    expect(cargo).toHaveLength(1);
    expect(cargo[0]!.args.slice(0, 3)).toEqual([
      "+1.94.0",
      "fetch",
      "--manifest-path",
    ]);
    expect(cargo[0]!.args[3]).toEndWith("/Cargo.toml");
    expect(cargo[0]!.args[4]).toBe("--locked");
    expect(calls.filter((call) => call.command === "git").map(({ args }) => args[2])).toEqual([
      "rev-parse",
      "archive",
    ]);
    expect(await pathExists(prepareWorkspace)).toBe(false);
    expect(await pathExists(join(root.path, "tmp/agent-wrapper-target"))).toBe(true);
    expect(await readFile(
      join(root.path, "tmp/agent-wrapper-target/gate-cache-sentinel"),
      "utf8",
    )).toBe("keep\n");
    expect(digest(await readFile(lockPath))).toBe(lockDigest);
  } finally {
    await rm(root.path, { recursive: true, force: true });
  }
});

test("rejects unknown flags before accessing the pin or invoking a command", async () => {
  const root = await makeTakosFixture();
  const calls: string[] = [];
  try {
    await expect(runAgentWrapperGate({
      root: root.path,
      args: ["--skip-tests"],
      runner: (options) => {
        calls.push(options.command);
        return { status: 0 };
      },
    })).rejects.toThrow("unknown agent wrapper gate arguments");
    expect(calls).toEqual([]);
  } finally {
    await rm(root.path, { recursive: true, force: true });
  }
});

test("isolated proof timeout kills its process group and reports the timeout", async () => {
  if (process.platform === "win32") return;
  const tempRoot = await mkdtemp(join(tmpdir(), "takos-proof-process-group-test-"));
  const pidPath = join(tempRoot, "descendant.pid");
  const script = [
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
    "setInterval(() => {}, 1000);",
  ].join(" ");
  try {
    const result = await runAgentWrapperCommand({
      command: process.execPath,
      args: ["-e", script],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 500,
      isolateProcessGroup: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exceeded its 500 ms timeout");
    const descendantPid = Number(await readFile(pidPath, "utf8"));
    expect(Number.isSafeInteger(descendantPid)).toBe(true);
    expect(await processIsRunning(descendantPid)).toBe(false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Windows proof supervision fails explicitly before spawning", () => {
  expect(() => assertPosixProcessGroupSupport("win32")).toThrow(
    "worker recovery proof requires POSIX process-group supervision; Windows is unsupported",
  );
});

test("isolated proof rejects and terminates a successful process with leftover group members", async () => {
  if (process.platform === "win32") return;
  const script = [
    'const { spawn } = require("node:child_process");',
    'spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    "setTimeout(() => process.exit(0), 25);",
  ].join(" ");
  const result = await runAgentWrapperCommand({
    command: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    env: {},
    timeoutMs: 2_000,
    isolateProcessGroup: true,
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("successful proof left process group");
  expect(result.stderr).toContain("terminated");
});

async function makeTakosFixture() {
  const path = await mkdtemp(join(tmpdir(), "takos-agent-wrapper-gate-test-"));
  const engine = join(path, "engine");
  const wrapper = join(path, "containers/agent");
  await mkdir(join(engine, "src"), { recursive: true });
  await mkdir(join(wrapper, "src"), { recursive: true });
  await mkdir(join(wrapper, "tests"), { recursive: true });
  await writeFile(join(engine, "Cargo.toml"), "[package]\nname = \"fixture-engine\"\nversion = \"0.1.0\"\n");
  await writeFile(join(engine, "engine.txt"), "pinned engine bytes\n");
  await writeFile(join(wrapper, "Cargo.toml"), "[package]\nname = \"takos-agent\"\n");
  await writeFile(join(wrapper, "Cargo.lock"), "version = 4\n");
  await writeFile(join(wrapper, "Dockerfile"), "FROM rust:1.94.0-bookworm AS builder\n");
  await writeFile(join(wrapper, "src/main.rs"), "fn main() {}\n");
  await writeFile(join(wrapper, "tests/gate.rs"), "#[test] fn works() {}\n");
  await writeFile(join(wrapper, "rust-toolchain.toml"), '[toolchain]\nchannel = "1.94.0"\ncomponents = ["rustfmt", "clippy"]\nprofile = "minimal"\n');

  runRealCommand("git", ["init", "-q"], engine, process.env);
  runRealCommand("git", ["config", "user.email", "fixture@example.test"], engine, process.env);
  runRealCommand("git", ["config", "user.name", "Fixture"], engine, process.env);
  runRealCommand("git", ["add", "."], engine, process.env);
  runRealCommand("git", ["commit", "-q", "-m", "fixture engine"], engine, process.env);
  const commit = runRealCommand("git", ["rev-parse", "HEAD"], engine, process.env).stdout.trim();
  await writePin(wrapper, commit);
  await writeFile(join(wrapper, "src", "agent.rs"), "pub fn fixture() {}\n");
  return { path, engine, wrapper, commit };
}

async function writePin(wrapper: string, commit: string) {
  await writeFile(
    join(wrapper, "engine-source.json"),
    `${JSON.stringify({ schemaVersion: 1, repository: PIN_REPOSITORY, commit }, null, 2)}\n`,
  );
}

function runRealCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const result = spawnSync(command, [...args], { cwd, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr ?? result.error?.message}`);
  }
  return { status: result.status ?? 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function digest(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function cargoPhase(args: readonly string[]) {
  expect(args[2]).toBe("--manifest-path");
  expect(args[3]?.endsWith("/Cargo.toml")).toBe(true);
  return [args[1], ...args.slice(4)].join(" ");
}

function isWorkerProof(
  options: Parameters<AgentWrapperCommandRunner>[0],
  root: string,
) {
  return (
    options.command === process.execPath &&
    options.args[0] === join(root, "scripts/prove-agent-worker-recovery.ts")
  );
}

function expectProviderKeysScrubbed(env: NodeJS.ProcessEnv) {
  expect(env.RUSTUP_AUTO_INSTALL).toBe("0");
  for (const key of [
    "OPENAI_API_KEY",
    "OPENAI_EMBEDDING_API_KEY",
    "TAKOS_EMBEDDING_API_KEY",
    "EMBEDDING_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
  ]) {
    expect(env[key]).toBeUndefined();
  }
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function processIsRunning(pid: number): Promise<boolean> {
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/u);
      return fields[0] !== "Z" && fields[0] !== "X";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}
