import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBaseContext } from "../../context.ts";
import type { Step } from "../../workflow-models.ts";
import { StepRunner } from "../../scheduler/step.ts";

import process from "node:process";

async function withProcessPlatform<T>(
  platform: NodeJS.Platform,
  run: () => Promise<T>,
): Promise<T> {
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "platform",
  );
  if (!platformDescriptor) {
    throw new Error("Unable to read process.platform descriptor");
  }

  Object.defineProperty(process, "platform", { value: platform });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "platform", platformDescriptor);
  }
}

test("step run interpolation - fails the step instead of running a command with a blanked expression", async () => {
  let executed: string | undefined;
  const runner = new StepRunner({
    shellExecutor: (command) => {
      executed = command;
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    },
  });

  // `==` is an unsupported operator; previously it was silently substituted
  // with "" and the (corrupted) command still ran. Now the step fails closed.
  const step: Step = {
    id: "credentialed",
    run: "curl -H \"Authorization: Bearer ${{ secrets.X == 'y' }}\"",
  };
  const result = await runner.runStep(step, createBaseContext());

  expect(result.conclusion).toEqual("failure");
  expect(executed).toEqual(undefined);
});

test("step output parsing - parses workflow command and simple outputs while ignoring malformed lines", async () => {
  const stdout = [
    "::set-output name=command_value::from-command",
    "::set-output name=command_empty::",
    "simple_output=from-simple",
    "command_value=from-simple-duplicate",
    "not-valid=value",
    "empty=",
  ].join("\n");

  const runner = new StepRunner({
    shellExecutor: () =>
      Promise.resolve({
        exitCode: 0,
        stdout,
        stderr: "",
      }),
  });

  const step: Step = { id: "parse-outputs", run: "echo output" };
  const result = await runner.runStep(step, createBaseContext());

  expect(result.outputs).toEqual({
    command_value: "from-command",
    command_empty: "",
    simple_output: "from-simple",
    empty: "",
  });
});
test("step output parsing - handles long workflow command output lines", async () => {
  const longName = "A".repeat(20_000);
  const stdout = `::set-output name=${longName}::value`;

  const runner = new StepRunner({
    shellExecutor: () =>
      Promise.resolve({
        exitCode: 0,
        stdout,
        stderr: "",
      }),
  });

  const step: Step = { id: "long-outputs", run: "echo output" };
  const result = await runner.runStep(step, createBaseContext());

  expect(result.outputs[longName]).toEqual("value");
});
test("step output parsing - reads command-file outputs and supports empty initial GitHub vars", async () => {
  const capturedEnv: Array<Record<string, string> | undefined> = [];
  const runner = new StepRunner({
    shellExecutor: async (_command, options) => {
      await Promise.resolve();
      capturedEnv.push(options.env);
      const outputFile = options.env?.GITHUB_OUTPUT;
      expect(outputFile).toBeTruthy();
      appendFileSync(outputFile!, "from_file=hello\n");
      appendFileSync(outputFile!, "multi<<EOF\nline1\nline2\nEOF\n");
      return {
        exitCode: 0,
        stdout: "from_stdout=ok",
        stderr: "",
      };
    },
  });

  const context = createBaseContext({ env: {} });
  const step: Step = { id: "command-file-outputs", run: "echo output" };
  const result = await runner.runStep(step, context);

  expect(result.outputs).toEqual({
    from_stdout: "ok",
    from_file: "hello",
    multi: "line1\nline2",
  });

  const firstEnv = capturedEnv[0];
  expect(firstEnv?.GITHUB_ENV).toBeTruthy();
  expect(firstEnv?.GITHUB_OUTPUT).toBeTruthy();
  expect(firstEnv?.GITHUB_PATH).toBeTruthy();
});
test("step output parsing - parses command-file heredoc outputs written with CRLF line endings", async () => {
  const runner = new StepRunner({
    shellExecutor: async (_command, options) => {
      await Promise.resolve();
      const outputFile = options.env?.GITHUB_OUTPUT;
      expect(outputFile).toBeTruthy();
      appendFileSync(outputFile!, "multi<<EOF\r\nline1\r\nline2\r\nEOF\r\n");
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    },
  });

  const context = createBaseContext({ env: {} });
  const step: Step = { id: "command-file-outputs-crlf", run: "echo output" };
  const result = await runner.runStep(step, context);

  expect(result.outputs).toEqual({
    multi: "line1\nline2",
  });
  expect(result.outputs.multi.includes("\r")).toEqual(false);
});

test("step command files - does not expose GITHUB_STEP_SUMMARY", async () => {
  const runner = new StepRunner({
    shellExecutor: async (_command, options) => {
      await Promise.resolve();
      expect(options.env?.GITHUB_STEP_SUMMARY).toEqual(undefined);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });

  const context = createBaseContext({ env: {} });
  const step: Step = { id: "summary-writer", run: "echo ok" };
  const result = await runner.runStep(step, context);

  expect(result.conclusion).toEqual("success");
  expect(Object.prototype.hasOwnProperty.call(result, "summary")).toEqual(false);
});

test("step default executors - uses pwsh by default on win32", async () => {
  let observedShell: Step["shell"] | undefined;

  await withProcessPlatform("win32", async () => {
    const runner = new StepRunner({
      shellExecutor: async (_command, options) => {
        await Promise.resolve();
        observedShell = options.shell;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await runner.runStep(
      { id: "win32-default-shell", run: "echo ok" },
      createBaseContext(),
    );
  });

  expect(observedShell).toEqual("pwsh");
});
test("step default executors - uses bash by default on non-win32 platforms", async () => {
  let observedShell: Step["shell"] | undefined;

  await withProcessPlatform("linux", async () => {
    const runner = new StepRunner({
      shellExecutor: async (_command, options) => {
        await Promise.resolve();
        observedShell = options.shell;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await runner.runStep(
      { id: "non-win32-default-shell", run: "echo ok" },
      createBaseContext(),
    );
  });

  expect(observedShell).toEqual("bash");
});
test("step default executors - prioritizes explicit shell configuration over platform defaults", async () => {
  const observedShells: Array<Step["shell"] | undefined> = [];

  await withProcessPlatform("win32", async () => {
    const runner = new StepRunner({
      defaultShell: "bash",
      shellExecutor: async (_command, options) => {
        await Promise.resolve();
        observedShells.push(options.shell);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await runner.runStep(
      { id: "configured-default-shell", run: "echo ok" },
      createBaseContext(),
    );
    await runner.runStep(
      { id: "step-explicit-shell", run: "echo ok", shell: "cmd" },
      createBaseContext(),
    );
  });

  expect(observedShells).toEqual(["bash", "cmd"]);
});
test("step default executors - respects working directory and env for default shell executor", async () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "actions-engine-step-"));

  try {
    const runner = new StepRunner({
      workingDirectory,
      defaultShell: "bash",
    });

    const step: Step = {
      id: "default-shell",
      run: 'echo "cwd=$PWD"; echo "from_env=$TAKOS_TEST_ENV"',
      env: {
        TAKOS_TEST_ENV: "from-step",
      },
    };

    const result = await runner.runStep(step, createBaseContext());

    expect(result.conclusion).toEqual("success");
    expect(result.outputs.cwd).toEqual(workingDirectory);
    expect(result.outputs.from_env).toEqual("from-step");
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
test("step default executors - returns failure when default shell executor times out", async () => {
  const runner = new StepRunner();
  const step: Step = {
    id: "timeout-shell",
    run: 'node -e "setTimeout(() => {}, 5000)"',
    "timeout-minutes": 0.001,
  };

  const result = await runner.runStep(step, createBaseContext());

  expect(result.conclusion).toEqual("failure");
  expect(result.error?.includes("Exit code: 124") ?? false).toBeTruthy();
});
test("step default executors - supports checkout no-op without a custom resolver", async () => {
  const runner = new StepRunner();
  const context = createBaseContext();
  const step: Step = {
    id: "checkout-noop",
    uses: "actions/checkout@v4",
  };

  const result = await runner.runStep(step, context);

  expect(result.conclusion).toEqual("success");
  expect(result.outputs.path).toEqual(context.github.workspace);
});
test("step default executors - fails explicitly for unsupported default actions", async () => {
  const runner = new StepRunner();
  const step: Step = {
    id: "unsupported-action",
    uses: "actions/cache@v4",
  };

  const result = await runner.runStep(step, createBaseContext());

  expect(result.conclusion).toEqual("failure");
  expect(result.error?.includes("Unsupported action: actions/cache@v4") ?? false).toBeTruthy();
});
