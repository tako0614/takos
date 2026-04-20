import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBaseContext } from "../../context.ts";
import type { Step } from "../../workflow-models.ts";
import { StepRunner } from "../../scheduler/step.ts";

import { assert, assertEquals } from "jsr:@std/assert";

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

Deno.test("step output parsing - parses legacy and simple outputs while ignoring malformed lines", async () => {
  const stdout = [
    "::set-output name=legacy::from-legacy",
    "::set-output name=legacy_empty::",
    "simple_output=from-simple",
    "legacy=from-simple-duplicate",
    "not-valid=value",
    "empty=",
  ].join("\n");

  const runner = new StepRunner({
    shellExecutor: async () => ({
      exitCode: 0,
      stdout,
      stderr: "",
    }),
  });

  const step: Step = { id: "parse-outputs", run: "echo output" };
  const result = await runner.runStep(step, createBaseContext());

  assertEquals(result.outputs, {
    legacy: "from-legacy",
    legacy_empty: "",
    simple_output: "from-simple",
    empty: "",
  });
});
Deno.test("step output parsing - handles long legacy output lines", async () => {
  const longName = "A".repeat(20_000);
  const stdout = `::set-output name=${longName}::value`;

  const runner = new StepRunner({
    shellExecutor: async () => ({
      exitCode: 0,
      stdout,
      stderr: "",
    }),
  });

  const step: Step = { id: "long-outputs", run: "echo output" };
  const result = await runner.runStep(step, createBaseContext());

  assertEquals(result.outputs[longName], "value");
});
Deno.test("step output parsing - reads command-file outputs and supports empty initial GitHub vars", async () => {
  const capturedEnv: Array<Record<string, string> | undefined> = [];
  const runner = new StepRunner({
    shellExecutor: async (_command, options) => {
      capturedEnv.push(options.env);
      const outputFile = options.env?.GITHUB_OUTPUT;
      assert(outputFile);
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

  assertEquals(result.outputs, {
    from_stdout: "ok",
    from_file: "hello",
    multi: "line1\nline2",
  });

  const firstEnv = capturedEnv[0];
  assert(firstEnv?.GITHUB_ENV);
  assert(firstEnv?.GITHUB_OUTPUT);
  assert(firstEnv?.GITHUB_PATH);
});
Deno.test("step output parsing - parses command-file heredoc outputs written with CRLF line endings", async () => {
  const runner = new StepRunner({
    shellExecutor: async (_command, options) => {
      const outputFile = options.env?.GITHUB_OUTPUT;
      assert(outputFile);
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

  assertEquals(result.outputs, {
    multi: "line1\nline2",
  });
  assertEquals(result.outputs.multi.includes("\r"), false);
});

Deno.test("step command files - does not expose GITHUB_STEP_SUMMARY", async () => {
  const runner = new StepRunner({
    shellExecutor: async (_command, options) => {
      assertEquals(options.env?.GITHUB_STEP_SUMMARY, undefined);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });

  const context = createBaseContext({ env: {} });
  const step: Step = { id: "summary-writer", run: "echo ok" };
  const result = await runner.runStep(step, context);

  assertEquals(result.conclusion, "success");
  assertEquals(
    Object.prototype.hasOwnProperty.call(result, "summary"),
    false,
  );
});

Deno.test("step default executors - uses pwsh by default on win32", async () => {
  let observedShell: Step["shell"] | undefined;

  await withProcessPlatform("win32", async () => {
    const runner = new StepRunner({
      shellExecutor: async (_command, options) => {
        observedShell = options.shell;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await runner.runStep(
      { id: "win32-default-shell", run: "echo ok" },
      createBaseContext(),
    );
  });

  assertEquals(observedShell, "pwsh");
});
Deno.test("step default executors - uses bash by default on non-win32 platforms", async () => {
  let observedShell: Step["shell"] | undefined;

  await withProcessPlatform("linux", async () => {
    const runner = new StepRunner({
      shellExecutor: async (_command, options) => {
        observedShell = options.shell;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await runner.runStep(
      { id: "non-win32-default-shell", run: "echo ok" },
      createBaseContext(),
    );
  });

  assertEquals(observedShell, "bash");
});
Deno.test("step default executors - prioritizes explicit shell configuration over platform defaults", async () => {
  const observedShells: Array<Step["shell"] | undefined> = [];

  await withProcessPlatform("win32", async () => {
    const runner = new StepRunner({
      defaultShell: "bash",
      shellExecutor: async (_command, options) => {
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

  assertEquals(observedShells, ["bash", "cmd"]);
});
Deno.test("step default executors - respects working directory and env for default shell executor", async () => {
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

    assertEquals(result.conclusion, "success");
    assertEquals(result.outputs.cwd, workingDirectory);
    assertEquals(result.outputs.from_env, "from-step");
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
Deno.test("step default executors - returns failure when default shell executor times out", async () => {
  const runner = new StepRunner();
  const step: Step = {
    id: "timeout-shell",
    run: 'node -e "setTimeout(() => {}, 5000)"',
    "timeout-minutes": 0.001,
  };

  const result = await runner.runStep(step, createBaseContext());

  assertEquals(result.conclusion, "failure");
  assert(result.error?.includes("Exit code: 124") ?? false);
});
Deno.test("step default executors - supports compatibility checkout no-op without a custom resolver", async () => {
  const runner = new StepRunner();
  const context = createBaseContext();
  const step: Step = {
    id: "compat-checkout",
    uses: "actions/checkout@v4",
  };

  const result = await runner.runStep(step, context);

  assertEquals(result.conclusion, "success");
  assertEquals(result.outputs.path, context.github.workspace);
});
Deno.test("step default executors - fails explicitly for unsupported default actions", async () => {
  const runner = new StepRunner();
  const step: Step = {
    id: "unsupported-action",
    uses: "actions/cache@v4",
  };

  const result = await runner.runStep(step, createBaseContext());

  assertEquals(result.conclusion, "failure");
  assert(
    result.error?.includes("Unsupported action: actions/cache@v4") ?? false,
  );
});
