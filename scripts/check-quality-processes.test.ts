import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const scriptsRoot = import.meta.dir;
const repoRoot = resolve(scriptsRoot, "..");
const fixtureDebtFile = "scripts/__tests__/fixture.test.ts";

async function makeFixture(): Promise<string> {
  const parent = resolve(repoRoot, "tmp/quality-process-regressions");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "gate-"));
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "scripts/__tests__"), { recursive: true });
  await mkdir(join(root, "quality"), { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });

  for (const file of [
    "check-types.ts",
    "check-lint.ts",
    "quality-process-result.ts",
    "quality-ledger.ts",
  ]) {
    await copyFile(join(scriptsRoot, file), join(root, "scripts", file));
  }

  const shim = join(root, "bin/bunx");
  await writeFile(shim, `#!/bin/sh
if [ "$1" = "oxlint" ]; then
  cat "$QG_FIXTURE/lint.stdout"
  cat "$QG_FIXTURE/lint.stderr" >&2
  if [ "$(cat "$QG_FIXTURE/lint.exit")" = "signal:TERM" ]; then
    kill -TERM $$
  fi
  exit "$(cat "$QG_FIXTURE/lint.exit")"
fi
if echo "$*" | grep -q 'web/tsconfig.json'; then
  suffix=web
else
  suffix=core
fi
cat "$QG_FIXTURE/type-$suffix.stdout"
cat "$QG_FIXTURE/type-$suffix.stderr" >&2
if [ "$(cat "$QG_FIXTURE/type-$suffix.exit")" = "signal:TERM" ]; then
  kill -TERM $$
fi
exit "$(cat "$QG_FIXTURE/type-$suffix.exit")"
`);
  await chmod(shim, 0o755);
  return root;
}

async function setLedger(root: string, filename: string, count: number): Promise<void> {
  const ledger = {
    note: "fixture debt",
    totals: { files: count === 0 ? 0 : 1, diagnostics: count },
    files: count === 0 ? {} : { [filename]: count },
  };
  await writeFile(
    join(root, "quality/typescript-debt.json"),
    JSON.stringify(ledger),
  );
  await writeFile(join(root, "quality/lint-debt.json"), JSON.stringify(ledger));
}

async function setOutput(root: string, name: string, output: string): Promise<void> {
  await writeFile(join(root, name), output);
}

async function runGate(root: string, gate: "check-types.ts" | "check-lint.ts") {
  return Bun.spawnSync([process.execPath, join(root, "scripts", gate)], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
      QG_FIXTURE: root,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function prepareCleanOutputs(root: string): Promise<void> {
  for (const suffix of ["core", "web"]) {
    await setOutput(root, `type-${suffix}.stdout`, "");
    await setOutput(root, `type-${suffix}.stderr`, "");
    await setOutput(root, `type-${suffix}.exit`, "0");
  }
  await setOutput(root, "lint.stdout", '{"diagnostics":[]}\n');
  await setOutput(root, "lint.stderr", "");
  await setOutput(root, "lint.exit", "0");
}

test("type gate rejects diagnostic-free abnormal compiler completion", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 0);
    await prepareCleanOutputs(root);
    await setOutput(root, "type-core.stdout", "compiler-started\n");
    await setOutput(root, "type-core.stderr", "fatal-runtime-marker\n");
    await setOutput(root, "type-core.exit", "137");

    // At baseline 1c33fc9, both output streams were parsed as having no TS
    // diagnostics and the ignored 137 status let this exact fixture pass.
    const result = await runGate(root, "check-types.ts");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("status 137");
    expect(result.stderr.toString()).toContain("compiler-started");
    expect(result.stderr.toString()).toContain("fatal-runtime-marker");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("type gate rejects unrecognized stdout beside a declared diagnostic", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 1);
    await prepareCleanOutputs(root);
    await setOutput(
      root,
      "type-core.stdout",
      `${fixtureDebtFile}(3,4): error TS2322: fixture debt\nfatal: compiler child crashed\n`,
    );
    await setOutput(root, "type-core.exit", "2");
    const result = await runGate(root, "check-types.ts");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unrecognized output");
    expect(result.stderr.toString()).toContain("fatal: compiler child crashed");
    expect(result.stderr.toString()).toContain("stdout:");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("type gate accepts the pinned formatter's nested diagnostic continuations", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 1);
    await prepareCleanOutputs(root);
    await setOutput(
      root,
      "type-core.stdout",
      `${fixtureDebtFile}(3,4): error TS2322: Type 'Actual' is not assignable to type 'Expected'.\n` +
        "  Types of property 'a' are incompatible.\n" +
        "    Type 'number' is not assignable to type 'string'.\n",
    );
    await setOutput(root, "type-core.exit", "2");
    const result = await runGate(root, "check-types.ts");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("declared debt is 1 diagnostic");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lint gate rejects valid empty JSON after abnormal linter completion", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 0);
    await prepareCleanOutputs(root);
    await setOutput(root, "lint.stdout", '{"diagnostics":[]}\n');
    await setOutput(root, "lint.stderr", "linter-fatal-marker\n");
    await setOutput(root, "lint.exit", "137");

    // Baseline 1c33fc9 accepted this well-formed empty report without checking
    // the child status, so it was a direct false-green reproduction.
    const result = await runGate(root, "check-lint.ts");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("status 137");
    expect(result.stderr.toString()).toContain('{"diagnostics":[]}');
    expect(result.stderr.toString()).toContain("linter-fatal-marker");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("both gates reject signaled children and preserve both output streams", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 0);
    await prepareCleanOutputs(root);
    await setOutput(root, "type-core.stdout", "type-signal-stdout\n");
    await setOutput(root, "type-core.stderr", "type-signal-stderr\n");
    await setOutput(root, "type-core.exit", "signal:TERM");
    const typeResult = await runGate(root, "check-types.ts");
    expect(typeResult.exitCode).toBe(1);
    expect(typeResult.stderr.toString()).toContain("signal");
    expect(typeResult.stderr.toString()).toContain("type-signal-stdout");
    expect(typeResult.stderr.toString()).toContain("type-signal-stderr");

    await setOutput(root, "lint.stdout", '{"diagnostics":[]}\n');
    await setOutput(root, "lint.stderr", "lint-signal-stderr\n");
    await setOutput(root, "lint.exit", "signal:TERM");
    const lintResult = await runGate(root, "check-lint.ts");
    expect(lintResult.exitCode).toBe(1);
    expect(lintResult.stderr.toString()).toContain("signal");
    expect(lintResult.stderr.toString()).toContain('{"diagnostics":[]}');
    expect(lintResult.stderr.toString()).toContain("lint-signal-stderr");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lint gate rejects malformed diagnostic shape instead of treating it as empty", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 0);
    await prepareCleanOutputs(root);
    await setOutput(root, "lint.stdout", '{"diagnostics":null}\n');
    const result = await runGate(root, "check-lint.ts");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("malformed JSON report");
    expect(result.stderr.toString()).toContain('{"diagnostics":null}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clean gates and the existing declared-debt contract still pass", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 0);
    await prepareCleanOutputs(root);
    expect((await runGate(root, "check-types.ts")).exitCode).toBe(0);
    expect((await runGate(root, "check-lint.ts")).exitCode).toBe(0);

    await setLedger(root, fixtureDebtFile, 1);
    await setOutput(
      root,
      "type-core.stdout",
      `${fixtureDebtFile}(3,4): error TS2322: fixture debt\n`,
    );
    await setOutput(root, "type-core.exit", "2");
    const lintDiagnostic = {
      filename: fixtureDebtFile,
      code: "fixture/rule",
      message: "fixture debt",
      labels: [{ span: { line: 3, column: 4 } }],
    };
    await setOutput(
      root,
      "lint.stdout",
      `${JSON.stringify({ diagnostics: [lintDiagnostic] })}\n`,
    );
    await setOutput(root, "lint.exit", "1");

    expect((await runGate(root, "check-types.ts")).exitCode).toBe(0);
    expect((await runGate(root, "check-lint.ts")).exitCode).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("declared diagnostics do not hide abnormal later compiler or linter exit", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 1);
    await prepareCleanOutputs(root);
    await setOutput(
      root,
      "type-core.stdout",
      `${fixtureDebtFile}(3,4): error TS2322: fixture debt\n`,
    );
    await setOutput(root, "type-core.exit", "2");
    await setOutput(root, "type-web.stdout", "web-compiler-started\n");
    await setOutput(root, "type-web.stderr", "web-compiler-fatal\n");
    await setOutput(root, "type-web.exit", "137");
    const typeResult = await runGate(root, "check-types.ts");
    expect(typeResult.exitCode).toBe(1);
    expect(typeResult.stderr.toString()).toContain("status 137");
    expect(typeResult.stderr.toString()).toContain("web-compiler-started");
    expect(typeResult.stderr.toString()).toContain("web-compiler-fatal");

    const lintDiagnostic = {
      filename: fixtureDebtFile,
      code: "fixture/rule",
      message: "fixture debt",
      labels: [{ span: { line: 3, column: 4 } }],
    };
    await setOutput(
      root,
      "lint.stdout",
      `${JSON.stringify({ diagnostics: [lintDiagnostic] })}\n`,
    );
    await setOutput(root, "lint.stderr", "linter-fatal-after-finding\n");
    await setOutput(root, "lint.exit", "137");
    const lintResult = await runGate(root, "check-lint.ts");
    expect(lintResult.exitCode).toBe(1);
    expect(lintResult.stderr.toString()).toContain("status 137");
    expect(lintResult.stderr.toString()).toContain("fixture debt");
    expect(lintResult.stderr.toString()).toContain("linter-fatal-after-finding");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful child exit cannot contradict a nonempty diagnostics report", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 1);
    await prepareCleanOutputs(root);
    await setOutput(
      root,
      "type-core.stdout",
      `${fixtureDebtFile}(3,4): error TS2322: fixture debt\n`,
    );
    const typeResult = await runGate(root, "check-types.ts");
    expect(typeResult.exitCode).toBe(1);
    expect(typeResult.stderr.toString()).toContain("reported diagnostics but exited successfully");

    await setOutput(root, "lint.stdout", JSON.stringify({
      diagnostics: [{
        filename: fixtureDebtFile,
        code: "fixture/rule",
        message: "fixture debt",
      }],
    }));
    const lintResult = await runGate(root, "check-lint.ts");
    expect(lintResult.exitCode).toBe(1);
    expect(lintResult.stderr.toString()).toContain("reported diagnostics but exited successfully");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normal finding exit still rejects unexpected fatal stderr", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 1);
    await prepareCleanOutputs(root);
    await setOutput(
      root,
      "type-core.stdout",
      `${fixtureDebtFile}(3,4): error TS2322: fixture debt\n`,
    );
    await setOutput(root, "type-core.exit", "2");
    await setOutput(root, "type-core.stderr", "compiler-fatal-marker\n");
    const typeResult = await runGate(root, "check-types.ts");
    expect(typeResult.exitCode).toBe(1);
    expect(typeResult.stderr.toString()).toContain("wrote to stderr");
    expect(typeResult.stderr.toString()).toContain("compiler-fatal-marker");

    await setOutput(root, "type-core.stderr", "");
    await setOutput(root, "lint.stdout", JSON.stringify({
      diagnostics: [{
        filename: fixtureDebtFile,
        code: "fixture/rule",
        message: "fixture debt",
      }],
    }));
    await setOutput(root, "lint.exit", "1");
    await setOutput(root, "lint.stderr", "linter-fatal-marker\n");
    const lintResult = await runGate(root, "check-lint.ts");
    expect(lintResult.exitCode).toBe(1);
    expect(lintResult.stderr.toString()).toContain("wrote to stderr");
    expect(lintResult.stderr.toString()).toContain("linter-fatal-marker");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lint gate rejects malformed optional diagnostic locations", async () => {
  const root = await makeFixture();
  try {
    await setLedger(root, fixtureDebtFile, 1);
    await prepareCleanOutputs(root);
    for (const labels of [[null], [{ span: null }], [{ span: { line: "3", column: 4 } }]]) {
      await setOutput(root, "lint.stdout", JSON.stringify({
        diagnostics: [{
          filename: fixtureDebtFile,
          code: "fixture/rule",
          message: "fixture debt",
          labels,
        }],
      }));
      await setOutput(root, "lint.exit", "1");
      const result = await runGate(root, "check-lint.ts");
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("malformed diagnostic locations");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("type and lint countdown ledgers still reject vanished, increased, and undeclared debt", async () => {
  const root = await makeFixture();
  try {
    await prepareCleanOutputs(root);
    for (const gate of ["check-types.ts", "check-lint.ts"] as const) {
      await setLedger(root, fixtureDebtFile, 1);
      const vanished = await runGate(root, gate);
      expect(vanished.exitCode).toBe(1);
      expect(vanished.stderr.toString()).toContain("no diagnostics left");

      await setLedger(root, fixtureDebtFile, 1);
      await setOutput(
        root,
        gate === "check-types.ts" ? "type-core.stdout" : "lint.stdout",
        gate === "check-types.ts"
          ? `${fixtureDebtFile}(3,4): error TS2322: one\n${fixtureDebtFile}(4,5): error TS2322: two\n`
          : JSON.stringify({ diagnostics: [1, 2].map((line) => ({
            filename: fixtureDebtFile,
            code: "fixture/rule",
            message: `debt ${line}`,
          })) }),
      );
      if (gate === "check-types.ts") {
        await setOutput(root, "type-core.exit", "2");
      } else {
        await setOutput(root, "lint.exit", "1");
      }
      const increased = await runGate(root, gate);
      expect(increased.exitCode).toBe(1);
      expect(increased.stderr.toString()).toContain("declares 1");

      await setLedger(root, fixtureDebtFile, 0);
      if (gate === "check-types.ts") {
        await setOutput(root, "type-core.stdout", `${fixtureDebtFile}(3,4): error TS2322: undeclared\n`);
        await setOutput(root, "type-core.exit", "2");
      } else {
        await setOutput(root, "lint.stdout", JSON.stringify({ diagnostics: [{
          filename: fixtureDebtFile,
          code: "fixture/rule",
          message: "undeclared",
        }] }));
        await setOutput(root, "lint.exit", "1");
      }
      const undeclared = await runGate(root, gate);
      expect(undeclared.exitCode).toBe(1);
      expect(undeclared.stderr.toString()).toContain("not in quality/");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
