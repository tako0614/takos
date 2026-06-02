#!/usr/bin/env -S bun
import { resolve } from "node:path";
import * as runtime from "./runtime.ts";

type ProofStep = {
  name: string;
  command: string[];
  cwd: string;
  status: "passed" | "failed";
  exitCode: number;
};

type ProofStepConfig = {
  name: string;
  command: string[];
  cwd: string;
  env?: Record<string, string>;
};

const takosRoot = runtime.cwd();
const steps: readonly ProofStepConfig[] = [
  {
    name: "worker-agent-control-memory-run-events",
    command: [
      "bun",
      "test",
      "src/worker/application/services/agent/__tests__/memory-manager.test.ts",
      "src/worker/application/services/agent/__tests__/run-lifecycle.test.ts",
      "src/worker/application/services/memory-graph/__tests__/memory-graph-runtime.test.ts",
      "src/worker/runtime/container-hosts/__tests__/executor-control-rpc.test.ts",
      "src/worker/runtime/runner/__tests__/agent-proof.test.ts",
    ],
    cwd: takosRoot,
  },
  {
    name: "agent-container-mock-llm-tool-memory",
    command: [
      "cargo",
      "test",
      "--features",
      "mock-llm",
      "--test",
      "agent_mock_llm_test",
    ],
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
for (const step of steps) {
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
    console.error(JSON.stringify({
      ok: false,
      kind: "takos.agent-local-proof@v1",
      failed: proofStep,
      results,
    }, null, 2));
    runtime.exit(result.code || 1);
  }
}

console.log(JSON.stringify({
  ok: true,
  kind: "takos.agent-local-proof@v1",
  checked: results.length,
  results,
}, null, 2));

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trimEnd();
}

function relativeOrSame(root: string, path: string): string {
  if (path === root) return ".";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
