import {
  appendOutput,
  buildCombinedResult,
} from "../../runtime/actions/action-result-converter.ts";

// ---------------------------------------------------------------------------
// appendOutput
// ---------------------------------------------------------------------------

import { assertEquals } from "jsr:@std/assert";

Deno.test("appendOutput - appends stdout and stderr", () => {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  appendOutput(
    {
      exitCode: 0,
      stdout: "out1",
      stderr: "err1",
      outputs: {},
      conclusion: "success",
    },
    stdoutParts,
    stderrParts,
  );

  assertEquals(stdoutParts, ["out1"]);
  assertEquals(stderrParts, ["err1"]);
});
Deno.test("appendOutput - skips empty stdout", () => {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  appendOutput(
    {
      exitCode: 0,
      stdout: "",
      stderr: "err",
      outputs: {},
      conclusion: "success",
    },
    stdoutParts,
    stderrParts,
  );

  assertEquals(stdoutParts, []);
  assertEquals(stderrParts, ["err"]);
});
Deno.test("appendOutput - skips empty stderr", () => {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  appendOutput(
    {
      exitCode: 0,
      stdout: "out",
      stderr: "",
      outputs: {},
      conclusion: "success",
    },
    stdoutParts,
    stderrParts,
  );

  assertEquals(stdoutParts, ["out"]);
  assertEquals(stderrParts, []);
});
Deno.test("appendOutput - accumulates multiple results", () => {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  appendOutput(
    {
      exitCode: 0,
      stdout: "out1",
      stderr: "err1",
      outputs: {},
      conclusion: "success",
    },
    stdoutParts,
    stderrParts,
  );
  appendOutput(
    {
      exitCode: 0,
      stdout: "out2",
      stderr: "err2",
      outputs: {},
      conclusion: "success",
    },
    stdoutParts,
    stderrParts,
  );

  assertEquals(stdoutParts, ["out1", "out2"]);
  assertEquals(stderrParts, ["err1", "err2"]);
});
Deno.test("appendOutput - handles undefined stdout/stderr", () => {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  appendOutput(
    {
      exitCode: 0,
      stdout: undefined as any,
      stderr: undefined as any,
      outputs: {},
      conclusion: "success",
    },
    stdoutParts,
    stderrParts,
  );

  assertEquals(stdoutParts, []);
  assertEquals(stderrParts, []);
});
// ---------------------------------------------------------------------------
// buildCombinedResult
// ---------------------------------------------------------------------------

Deno.test("buildCombinedResult - builds success result", () => {
  const result = buildCombinedResult(
    ["out1", "out2"],
    ["err1"],
    { key: "value" },
    "success",
  );

  assertEquals(result, {
    exitCode: 0,
    stdout: "out1\nout2",
    stderr: "err1",
    outputs: { key: "value" },
    conclusion: "success",
  });
});
Deno.test("buildCombinedResult - builds failure result with exit code 1", () => {
  const result = buildCombinedResult([], [], {}, "failure");
  assertEquals(result.exitCode, 1);
  assertEquals(result.conclusion, "failure");
});
Deno.test("buildCombinedResult - trims trailing whitespace from joined output", () => {
  const result = buildCombinedResult(["line1  ", "line2  "], [], {}, "success");
  assertEquals(result.stdout, "line1  \nline2");
});
Deno.test("buildCombinedResult - handles empty arrays", () => {
  const result = buildCombinedResult([], [], {}, "success");
  assertEquals(result.stdout, "");
  assertEquals(result.stderr, "");
});
Deno.test("buildCombinedResult - preserves outputs object", () => {
  const outputs = { a: "1", b: "2" };
  const result = buildCombinedResult([], [], outputs, "success");
  assertEquals(result.outputs, { a: "1", b: "2" });
});
