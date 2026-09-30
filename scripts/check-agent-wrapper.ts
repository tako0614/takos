#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, rmdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const PIN_REPOSITORY = "tako0614/takos-agent-engine";
const PIN_PATTERN = /^[0-9a-f]{40}$/u;

export type AgentWrapperCommandResult = Readonly<{
  status: number;
  stdout?: string;
  stderr?: string;
}>;

export type AgentWrapperCommandRunner = (options: {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => AgentWrapperCommandResult | Promise<AgentWrapperCommandResult>;

export type AgentWrapperGateOptions = Readonly<{
  root?: string;
  env?: NodeJS.ProcessEnv;
  args?: readonly string[];
  runner?: AgentWrapperCommandRunner;
  id?: string;
}>;

type EnginePin = Readonly<{
  schemaVersion: 1;
  repository: typeof PIN_REPOSITORY;
  commit: string;
}>;

const runProcess: AgentWrapperCommandRunner = ({ command, args, cwd, env }) => {
  const result = spawnSync(command, [...args], {
    cwd,
    env,
    encoding: "utf8",
    stdio: command === "cargo" ? "inherit" : "pipe",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
};

export async function runAgentWrapperGate(
  options: AgentWrapperGateOptions = {},
): Promise<void> {
  const root = resolve(options.root ?? join(import.meta.dir, ".."));
  const args = options.args ?? [];
  const prepare = parseArgs(args);
  const env = { ...(options.env ?? process.env) };
  const runner = options.runner ?? runProcess;
  const wrapperDir = join(root, "containers/agent");
  const temporaryRoot = join(root, "tmp/agent-wrapper-gate");
  const workspaceId = options.id ?? `${Date.now()}-${randomUUID()}`;
  if (!/^[a-zA-Z0-9-]+$/u.test(workspaceId)) {
    throw new Error("agent wrapper gate workspace id is invalid");
  }

  const pin = await readEnginePin(join(wrapperDir, "engine-source.json"));
  const toolchain = await readToolchain(join(wrapperDir, "rust-toolchain.toml"));
  await assertDockerToolchain(join(wrapperDir, "Dockerfile"), toolchain);
  const engineRepository = resolve(
    root,
    env.TAKOS_AGENT_ENGINE_REPOSITORY ?? "../takos-agent-engine",
  );
  const resolvedCommit = await runChecked(runner, {
    command: "git",
    args: ["-C", engineRepository, "rev-parse", `${pin.commit}^{commit}`],
    cwd: root,
    env,
    label: "resolve the pinned takos-agent-engine commit",
  });
  if (resolvedCommit.trim() !== pin.commit) {
    throw new Error(
      `takos-agent-engine pin resolved to ${resolvedCommit.trim()}, expected ${pin.commit}`,
    );
  }

  const workspace = join(temporaryRoot, workspaceId);
  await mkdir(temporaryRoot, { recursive: true });
  await mkdir(workspace);
  console.log(
    `[agent-wrapper-gate] repository=${pin.repository} commit=${pin.commit} toolchain=${toolchain} context=${workspace}`,
  );
  const engineMirror = join(workspace, "takos-agent-engine");
  const wrapperMirror = join(workspace, "takos/containers/agent");
  let succeeded = false;
  let cargoTargetDirectory: string | undefined;
  try {
    await mkdir(engineMirror, { recursive: true });
    await mkdir(wrapperMirror, { recursive: true });
    const archivePath = join(workspace, "takos-agent-engine.tar");
    await runChecked(runner, {
      command: "git",
      args: [
        "-C",
        engineRepository,
        "archive",
        "--format=tar",
        `--output=${archivePath}`,
        pin.commit,
      ],
      cwd: root,
      env,
      label: "archive the pinned takos-agent-engine source",
    });
    await runChecked(runner, {
      command: "tar",
      args: ["-xf", archivePath, "-C", engineMirror],
      cwd: root,
      env,
      label: "extract the pinned takos-agent-engine source",
    });
    for (const filename of ["Cargo.toml", "Cargo.lock"]) {
      await cp(join(wrapperDir, filename), join(wrapperMirror, filename));
    }
    await cp(
      join(wrapperDir, "rust-toolchain.toml"),
      join(wrapperMirror, "rust-toolchain.toml"),
    );
    for (const directory of ["src", "tests"]) {
      await cp(join(wrapperDir, directory), join(wrapperMirror, directory), {
        recursive: true,
      });
    }

    const cargoEnv = { ...env };
    for (const key of [
      "OPENAI_API_KEY",
      "OPENAI_EMBEDDING_API_KEY",
      "TAKOS_EMBEDDING_API_KEY",
      "EMBEDDING_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
    ]) {
      delete cargoEnv[key];
    }
    cargoEnv.RUSTUP_AUTO_INSTALL = "0";
    cargoEnv.CARGO_TARGET_DIR = resolve(
      env.CARGO_TARGET_DIR ?? join(root, "tmp/agent-wrapper-target"),
    );
    cargoTargetDirectory = cargoEnv.CARGO_TARGET_DIR;
    cargoEnv.CARGO_BUILD_JOBS ??= "2";
    await mkdir(cargoEnv.CARGO_TARGET_DIR, { recursive: true });

    const manifest = join(wrapperMirror, "Cargo.toml");
    if (prepare) {
      await runChecked(runner, {
        command: "cargo",
        args: [`+${toolchain}`, "fetch", "--manifest-path", manifest, "--locked"],
        cwd: wrapperMirror,
        env: cargoEnv,
        label: "fetch locked Cargo dependencies for the Takos agent wrapper",
      });
      succeeded = true;
      return;
    }

    const phases: readonly Readonly<{
      label: string;
      subcommand: string;
      args: readonly string[];
    }>[] = [
      { label: "check wrapper formatting", subcommand: "fmt", args: ["--all", "--check"] },
      {
        label: "check the Takos agent wrapper",
        subcommand: "check",
        args: ["--locked", "--offline", "--all-targets", "--all-features"],
      },
      {
        label: "lint the Takos agent wrapper with default features",
        subcommand: "clippy",
        args: ["--locked", "--offline", "--all-targets", "--", "-D", "warnings"],
      },
      {
        label: "lint the Takos agent wrapper",
        subcommand: "clippy",
        args: ["--locked", "--offline", "--all-targets", "--all-features", "--", "-D", "warnings"],
      },
      {
        label: "test the Takos agent wrapper default features",
        subcommand: "test",
        args: ["--locked", "--offline", "--all-targets"],
      },
      {
        label: "test the Takos agent wrapper mock-llm feature",
        subcommand: "test",
        args: ["--locked", "--offline", "--all-targets", "--features", "mock-llm"],
      },
      {
        label: "build the Takos agent production executable",
        subcommand: "build",
        args: ["--locked", "--offline", "--bin", "takos-agent"],
      },
    ];
    for (const phase of phases) {
      await runChecked(runner, {
        command: "cargo",
        args: [`+${toolchain}`, phase.subcommand, "--manifest-path", manifest, ...phase.args],
        cwd: wrapperMirror,
        env: cargoEnv,
        label: phase.label,
      });
    }
    succeeded = true;
  } finally {
    if (succeeded) {
      const generatedPaths = [
        engineMirror,
        join(workspace, "takos"),
        join(workspace, "takos-agent-engine.tar"),
      ];
      for (const generatedPath of generatedPaths) {
        if (!cargoTargetDirectory || !pathsOverlap(generatedPath, cargoTargetDirectory)) {
          await rm(generatedPath, { recursive: true, force: true });
        }
      }
      if (!cargoTargetDirectory || !pathsOverlap(workspace, cargoTargetDirectory)) {
        await rmdir(workspace);
      }
    }
  }
}

function pathsOverlap(first: string, second: string): boolean {
  return pathIsWithin(first, second) || pathIsWithin(second, first);
}

function pathIsWithin(parent: string, child: string): boolean {
  const childPath = relative(parent, child);
  return (
    childPath === "" ||
    (!isAbsolute(childPath) && childPath !== ".." && !childPath.startsWith(`..${sep}`))
  );
}

async function readEnginePin(path: string): Promise<EnginePin> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read Takos agent engine pin at ${path}: ${String(error)}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("Takos agent engine pin must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.join(",") !== "commit,repository,schemaVersion" ||
    record.schemaVersion !== 1 ||
    record.repository !== PIN_REPOSITORY ||
    typeof record.commit !== "string" ||
    !PIN_PATTERN.test(record.commit)
  ) {
    throw new Error(
      `Takos agent engine pin must contain exactly schemaVersion: 1, repository: ${PIN_REPOSITORY}, and a 40-character lowercase commit SHA`,
    );
  }
  return record as EnginePin;
}

async function readToolchain(path: string): Promise<string> {
  const source = await readFile(path, "utf8");
  const channels = [...source.matchAll(/^\s*channel\s*=\s*"([^"]+)"\s*$/gmu)];
  if (channels.length !== 1 || !/^\d+\.\d+\.\d+$/u.test(channels[0]![1]!)) {
    throw new Error(
      "Takos agent rust-toolchain.toml must declare one exact x.y.z channel",
    );
  }
  return channels[0]![1]!;
}

async function assertDockerToolchain(path: string, channel: string): Promise<void> {
  const source = await readFile(path, "utf8");
  const builderImages = [...source.matchAll(/^FROM rust:([^\s]+) AS builder$/gmu)];
  if (
    builderImages.length !== 1 ||
    builderImages[0]![1] !== `${channel}-bookworm`
  ) {
    throw new Error(
      `Takos agent Dockerfile must declare exactly FROM rust:${channel}-bookworm AS builder to match rust-toolchain.toml`,
    );
  }
}

function parseArgs(args: readonly string[]): boolean {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === "--prepare=locked") return true;
  throw new Error(`unknown agent wrapper gate arguments: ${args.join(" ")}`);
}

async function runChecked(
  runner: AgentWrapperCommandRunner,
  options: {
    command: string;
    args: readonly string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    label: string;
  },
): Promise<string> {
  const result = await runner(options);
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr]
      .filter((value) => value && value.length > 0)
      .join("\n");
    throw new Error(
      `${options.label} failed with exit code ${result.status}${details ? `:\n${details}` : ""}`,
    );
  }
  return result.stdout ?? "";
}

if (import.meta.main) {
  try {
    await runAgentWrapperGate({ args: Bun.argv.slice(2) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
