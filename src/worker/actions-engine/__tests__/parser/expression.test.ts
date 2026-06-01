import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionContext } from "../../workflow-models.ts";
import {
  evaluateCondition,
  evaluateExpression,
  ExpressionError,
  interpolateString,
} from "../../parser/expression.ts";

import { assertEquals, assertThrows } from "@takos/test/assert";
import process from "node:process";

function createContext(): ExecutionContext {
  return {
    github: { actor: "tester", workspace: process.cwd() },
    env: {},
    vars: {},
    secrets: {},
    runner: {},
    job: { status: "success" },
    steps: {},
    needs: {},
  } as ExecutionContext;
}

test("expression resource limits - throws ExpressionError when expression size exceeds 64KiB", () => {
  const context = createContext();
  const oversized = "a".repeat(64 * 1024 + 1);
  const expr = `\${{ ${oversized} }}`;

  assertThrows(() => evaluateExpression(expr, context), ExpressionError);
  assertThrows(
    () => evaluateExpression(expr, context),
    Error,
    "Expression size limit exceeded",
  );
});
test("expression resource limits - throws ExpressionError when evaluate call count exceeds 10000", () => {
  const context = createContext();
  const manyArgs = ",1".repeat(10_000);
  const expr = `\${{ format('x'${manyArgs}) }}`;

  assertThrows(() => evaluateExpression(expr, context), ExpressionError);
  assertThrows(
    () => evaluateExpression(expr, context),
    Error,
    "Expression evaluate call limit exceeded",
  );
});
test("expression resource limits - throws ExpressionError when parseAccess depth exceeds 128", () => {
  const context = createContext();
  const deepAccess = "github" + ".a".repeat(129);
  const expr = `\${{ ${deepAccess} }}`;

  assertThrows(() => evaluateExpression(expr, context), ExpressionError);
  assertThrows(
    () => evaluateExpression(expr, context),
    Error,
    "Expression access depth limit exceeded",
  );
});

test("expression property hardening - blocks dangerous prototype-chain keys", () => {
  const context = createContext();
  const blockedKeys = ["__proto__", "constructor", "prototype"];

  for (const key of blockedKeys) {
    const expr = `\${{ github.${key} }}`;
    expect(evaluateExpression(expr, context)).toEqual(undefined);
  }
});

test("expression function behavior - returns empty string when format template is null", () => {
  const context = createContext();
  const expr = "${{ format(null, 'x') }}";

  expect(evaluateExpression(expr, context)).toEqual("");
});
test("expression function behavior - returns empty string when format template is undefined", () => {
  const context = createContext();
  const expr = "${{ format(env.NOT_EXISTS, 'x') }}";

  expect(evaluateExpression(expr, context)).toEqual("");
});
test("expression function behavior - returns SHA-256 hash for a matched file via hashFiles", () => {
  const workspace = mkdtempSync(join(tmpdir(), "actions-engine-hash-"));
  const content = "hello hash files\n";
  writeFileSync(join(workspace, "a.txt"), content);

  try {
    const context = createContext();
    context.github.workspace = workspace;

    const expr = "${{ hashFiles('a.txt') }}";
    const expected = createHash("sha256").update(content).digest("hex");

    expect(evaluateExpression(expr, context)).toEqual(expected);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
test("expression function behavior - supports contains for strings and arrays", () => {
  const context = createContext();

  expect(evaluateExpression("${{ contains('Release/Main', 'main') }}", context)).toEqual(true);
  expect(evaluateExpression("${{ contains('Release/Main', 'dev') }}", context)).toEqual(false);
  expect(evaluateExpression(
      "${{ contains(fromJSON('[\"push\",\"pull_request\"]'), 'push') }}",
      context,
    )).toEqual(true);
  expect(evaluateExpression(
      "${{ contains(fromJSON('[\"push\",\"pull_request\"]'), 'workflow_dispatch') }}",
      context,
    )).toEqual(false);
  expect(evaluateCondition("${{ contains('abc', 'b') }}", context)).toEqual(true);
});

test("expression function behavior - supports startsWith and endsWith", () => {
  const context = createContext();

  expect(evaluateExpression(
      "${{ startsWith('Refs/Heads/Main', 'refs/heads') }}",
      context,
    )).toEqual(true);
  expect(evaluateExpression("${{ startsWith('Refs/Heads/Main', 'tags') }}", context)).toEqual(false);
  expect(evaluateExpression("${{ endsWith('package.TGZ', '.tgz') }}", context)).toEqual(true);
  expect(evaluateExpression("${{ endsWith('package.TGZ', '.zip') }}", context)).toEqual(false);
  expect(evaluateCondition("${{ startsWith(github.actor, 'test') }}", context)).toEqual(true);
});

test("expression function behavior - rejects unsupported operators", () => {
  const context = createContext();
  const unsupportedExpressions = [
    "${{ env.BRANCH == 'main' }}",
    "${{ true && false }}",
    "${{ true || false }}",
  ];

  for (const expr of unsupportedExpressions) {
    assertThrows(() => evaluateExpression(expr, context), ExpressionError);
    expect(evaluateCondition(expr, context)).toEqual(false);
  }
});

test("interpolateString - fails closed (throws) on evaluation error instead of blanking", () => {
  const context = createContext();
  // An unsupported operator must NOT be silently substituted with "" inside a
  // command/credential string; it propagates so the caller fails the step.
  assertThrows(
    () =>
      interpolateString(
        "Authorization: Bearer ${{ secrets.X == 'y' }}",
        context,
      ),
    ExpressionError,
  );
});

test("interpolateString - still blanks genuinely-undefined context lookups", () => {
  const context = createContext();
  // Undefined lookups (not errors) keep GitHub Actions parity: collapse to "".
  expect(interpolateString("v=${{ env.MISSING }}", context)).toEqual("v=");
});

test("expression function behavior - supports multiple patterns and exclusions in hashFiles", () => {
  const workspace = mkdtempSync(join(tmpdir(), "actions-engine-hash-"));
  writeFileSync(join(workspace, "one.txt"), "one");
  writeFileSync(join(workspace, "two.txt"), "two");
  writeFileSync(join(workspace, "skip.txt"), "skip");

  try {
    const context = createContext();
    context.github.workspace = workspace;

    const expr = "${{ hashFiles('*.txt', '!skip.txt') }}";
    const oneHash = createHash("sha256").update("one").digest("hex");
    const twoHash = createHash("sha256").update("two").digest("hex");
    const expected = createHash("sha256")
      .update(oneHash)
      .update(twoHash)
      .digest("hex");

    expect(evaluateExpression(expr, context)).toEqual(expected);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("expression multiline wrapper support - evaluates expressions wrapped with ${{ }} across multiple lines", () => {
  const context = createContext();
  const expr = `\${{
      format('{0}-ok', github.actor)
    }}`;

  expect(evaluateExpression(expr, context)).toEqual("tester-ok");
});
test("expression multiline wrapper support - interpolates multiline expression blocks in template strings", () => {
  const context = createContext();
  const template = `actor=\${{
      github.actor
    }}`;

  expect(interpolateString(template, context)).toEqual("actor=tester");
});
