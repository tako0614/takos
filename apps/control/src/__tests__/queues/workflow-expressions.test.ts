import {
  evaluateCondition,
  evaluateExpression,
} from "@/queues/workflow-expressions";
import type {
  ConditionContext,
  ExpressionContext,
} from "@/queues/workflow-types";

// ---------------------------------------------------------------------------
// evaluateCondition
// ---------------------------------------------------------------------------

import { assertEquals } from "jsr:@std/assert";

Deno.test("evaluateCondition - expression functions - always() returns true regardless of context", () => {
  assertEquals(evaluateCondition("always()", {}), true);
  assertEquals(
    evaluateCondition("always()", { job: { status: "failure" } }),
    true,
  );
});
Deno.test("evaluateCondition - expression functions - cancelled() reflects job.status", () => {
  // No job context → not cancelled.
  assertEquals(evaluateCondition("cancelled()", {}), false);
  // Cancelled job → cancelled() returns true so finalize/cleanup steps run.
  assertEquals(
    evaluateCondition("cancelled()", { job: { status: "cancelled" } }),
    true,
  );
  // Other terminal statuses → cancelled() returns false.
  assertEquals(
    evaluateCondition("cancelled()", { job: { status: "failure" } }),
    false,
  );
  assertEquals(
    evaluateCondition("cancelled()", { job: { status: "success" } }),
    false,
  );
});
Deno.test("evaluateCondition - expression functions - failure() returns true when job status is failure", () => {
  assertEquals(
    evaluateCondition("failure()", { job: { status: "failure" } }),
    true,
  );
});
Deno.test("evaluateCondition - expression functions - failure() returns false when job status is not failure", () => {
  assertEquals(
    evaluateCondition("failure()", { job: { status: "success" } }),
    false,
  );
  assertEquals(evaluateCondition("failure()", {}), false);
});
Deno.test("evaluateCondition - expression functions - success() returns true when job status is success", () => {
  assertEquals(
    evaluateCondition("success()", { job: { status: "success" } }),
    true,
  );
});
Deno.test("evaluateCondition - expression functions - success() returns false when job status is not success", () => {
  assertEquals(
    evaluateCondition("success()", { job: { status: "failure" } }),
    false,
  );
  assertEquals(evaluateCondition("success()", {}), false);
});

Deno.test("evaluateCondition - expression interpolation ${{ ... }} - evaluates steps.X.outputs.Y truthy", () => {
  const ctx: ConditionContext = {
    steps: { build: { result: "ok" } },
  };
  assertEquals(
    evaluateCondition("${{ steps.build.outputs.result }}", ctx),
    true,
  );
});
Deno.test("evaluateCondition - expression interpolation ${{ ... }} - evaluates steps.X.outputs.Y falsy when missing", () => {
  const ctx: ConditionContext = {
    steps: {},
  };
  assertEquals(
    evaluateCondition("${{ steps.build.outputs.result }}", ctx),
    false,
  );
});
Deno.test("evaluateCondition - expression interpolation ${{ ... }} - evaluates steps.X.outputs.Y falsy when step missing", () => {
  assertEquals(
    evaluateCondition("${{ steps.build.outputs.result }}", {}),
    false,
  );
});
Deno.test("evaluateCondition - expression interpolation ${{ ... }} - evaluates env.VAR truthy when set", () => {
  const ctx: ConditionContext = {
    env: { CI: "true" },
  };
  assertEquals(evaluateCondition("${{ env.CI }}", ctx), true);
});
Deno.test("evaluateCondition - expression interpolation ${{ ... }} - evaluates env.VAR falsy when not set", () => {
  const ctx: ConditionContext = {
    env: {},
  };
  assertEquals(evaluateCondition("${{ env.MISSING }}", ctx), false);
});
Deno.test("evaluateCondition - expression interpolation ${{ ... }} - evaluates env.VAR falsy when env is undefined", () => {
  assertEquals(evaluateCondition("${{ env.CI }}", {}), false);
});
Deno.test("evaluateCondition - expression interpolation ${{ ... }} - evaluates inputs.X truthy when set", () => {
  const ctx: ConditionContext = {
    inputs: { deploy: true },
  };
  assertEquals(evaluateCondition("${{ inputs.deploy }}", ctx), true);
});
Deno.test("evaluateCondition - expression interpolation ${{ ... }} - evaluates inputs.X falsy when not set", () => {
  assertEquals(
    evaluateCondition("${{ inputs.deploy }}", { inputs: {} }),
    false,
  );
});
Deno.test("evaluateCondition - expression interpolation ${{ ... }} - evaluates github.event.inputs.X truthy when set", () => {
  const ctx: ConditionContext = {
    inputs: { version: "1.0.0" },
  };
  assertEquals(
    evaluateCondition("${{ github.event.inputs.version }}", ctx),
    true,
  );
});
Deno.test("evaluateCondition - expression interpolation ${{ ... }} - evaluates github.event.inputs.X falsy when not set", () => {
  assertEquals(
    evaluateCondition("${{ github.event.inputs.version }}", {}),
    false,
  );
});

Deno.test("evaluateCondition - edge cases - returns false for unrecognized expressions", () => {
  assertEquals(evaluateCondition("${{ unknown.property }}", {}), false);
});
Deno.test("evaluateCondition - edge cases - returns false for non-expression strings", () => {
  assertEquals(evaluateCondition("some random string", {}), false);
});
Deno.test("evaluateCondition - edge cases - trims whitespace from expression", () => {
  assertEquals(evaluateCondition("  always()  ", {}), true);
});
Deno.test("evaluateCondition - edge cases - handles whitespace inside ${{ }}", () => {
  const ctx: ConditionContext = { env: { CI: "true" } };
  assertEquals(evaluateCondition("${{  env.CI  }}", ctx), true);
});
Deno.test("evaluateCondition - edge cases - evaluates env.VAR as falsy when value is empty string", () => {
  const ctx: ConditionContext = {
    env: { EMPTY: "" },
  };
  assertEquals(evaluateCondition("${{ env.EMPTY }}", ctx), false);
});
Deno.test("evaluateCondition - edge cases - evaluates inputs.X as falsy when value is 0", () => {
  const ctx: ConditionContext = {
    inputs: { count: 0 },
  };
  assertEquals(evaluateCondition("${{ inputs.count }}", ctx), false);
});
Deno.test("evaluateCondition - edge cases - evaluates inputs.X as falsy when value is false", () => {
  const ctx: ConditionContext = {
    inputs: { enabled: false },
  };
  assertEquals(evaluateCondition("${{ inputs.enabled }}", ctx), false);
});
// ---------------------------------------------------------------------------
// evaluateExpression
// ---------------------------------------------------------------------------

Deno.test("evaluateExpression - returns plain string unchanged when not an expression", () => {
  assertEquals(evaluateExpression("hello world", {}), "hello world");
});
Deno.test("evaluateExpression - resolves steps.X.outputs.Y", () => {
  const ctx: ExpressionContext = {
    steps: { build: { artifact: "/path/to/file" } },
  };
  assertEquals(
    evaluateExpression("${{ steps.build.outputs.artifact }}", ctx),
    "/path/to/file",
  );
});
Deno.test("evaluateExpression - returns null for missing step output", () => {
  const ctx: ExpressionContext = { steps: {} };
  assertEquals(
    evaluateExpression("${{ steps.build.outputs.artifact }}", ctx),
    null,
  );
});
Deno.test("evaluateExpression - returns null when steps context is undefined", () => {
  assertEquals(
    evaluateExpression("${{ steps.build.outputs.artifact }}", {}),
    null,
  );
});
Deno.test("evaluateExpression - resolves inputs.X", () => {
  const ctx: ExpressionContext = { inputs: { version: "2.0" } };
  assertEquals(evaluateExpression("${{ inputs.version }}", ctx), "2.0");
});
Deno.test("evaluateExpression - converts non-string inputs to string", () => {
  const ctx: ExpressionContext = { inputs: { count: 42 } };
  assertEquals(evaluateExpression("${{ inputs.count }}", ctx), "42");
});
Deno.test("evaluateExpression - returns null for undefined inputs", () => {
  const ctx: ExpressionContext = { inputs: {} };
  assertEquals(evaluateExpression("${{ inputs.missing }}", ctx), null);
});
Deno.test("evaluateExpression - resolves github.event.inputs.X", () => {
  const ctx: ExpressionContext = { inputs: { environment: "staging" } };
  assertEquals(
    evaluateExpression("${{ github.event.inputs.environment }}", ctx),
    "staging",
  );
});
Deno.test("evaluateExpression - returns null for unrecognized expression", () => {
  assertEquals(evaluateExpression("${{ unknown.thing }}", {}), null);
});
Deno.test("evaluateExpression - returns null for null input value", () => {
  const ctx: ExpressionContext = { inputs: { val: null } };
  assertEquals(evaluateExpression("${{ inputs.val }}", ctx), null);
});
Deno.test("evaluateExpression - returns null for undefined input value", () => {
  const ctx: ExpressionContext = { inputs: { val: undefined } };
  assertEquals(evaluateExpression("${{ inputs.val }}", ctx), null);
});
Deno.test("evaluateExpression - converts boolean input to string", () => {
  const ctx: ExpressionContext = { inputs: { flag: true } };
  assertEquals(evaluateExpression("${{ inputs.flag }}", ctx), "true");
});
Deno.test("evaluateExpression - returns empty string step output as falsy-ish but still string", () => {
  const ctx: ExpressionContext = {
    steps: { build: { result: "" } },
  };
  // Empty string returns null because of || null
  assertEquals(
    evaluateExpression("${{ steps.build.outputs.result }}", ctx),
    null,
  );
});
