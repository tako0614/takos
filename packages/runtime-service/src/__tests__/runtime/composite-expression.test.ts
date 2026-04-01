import { assertEquals } from "jsr:@std/assert";

import {
  evaluateCondition,
  interpolateString,
  type InterpolationContext,
  normalizeInputValue,
  resolveCompositeOutputs,
  resolveEnv,
  resolveExpressionValue,
  resolveWith,
} from "../../runtime/actions/composite-expression.ts";

function makeContext(
  overrides: Partial<InterpolationContext> = {},
): InterpolationContext {
  return {
    inputs: { name: "world", debug: "true" },
    env: {
      CI: "true",
      GITHUB_WORKSPACE: "/home/runner/work",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: "abc123",
    },
    steps: {
      build: { output: "built", status: "success" },
    },
    jobStatus: "success",
    ...overrides,
  };
}

Deno.test('resolveExpressionValue - resolves "true" literal', () => {
  assertEquals(resolveExpressionValue("true", makeContext()), "true");
});

Deno.test('resolveExpressionValue - resolves "false" literal', () => {
  assertEquals(resolveExpressionValue("false", makeContext()), "false");
});

Deno.test("resolveExpressionValue - resolves inputs", () => {
  assertEquals(resolveExpressionValue("inputs.name", makeContext()), "world");
});

Deno.test("resolveExpressionValue - returns empty string for missing input", () => {
  assertEquals(resolveExpressionValue("inputs.missing", makeContext()), "");
});

Deno.test("resolveExpressionValue - resolves env values", () => {
  assertEquals(resolveExpressionValue("env.CI", makeContext()), "true");
});

Deno.test("resolveExpressionValue - returns empty string for missing env", () => {
  assertEquals(resolveExpressionValue("env.MISSING", makeContext()), "");
});

Deno.test("resolveExpressionValue - resolves step outputs", () => {
  assertEquals(
    resolveExpressionValue("steps.build.outputs.output", makeContext()),
    "built",
  );
});

Deno.test("resolveExpressionValue - returns empty string for missing step", () => {
  assertEquals(
    resolveExpressionValue("steps.missing.outputs.x", makeContext()),
    "",
  );
});

Deno.test("resolveExpressionValue - resolves github.workspace", () => {
  assertEquals(
    resolveExpressionValue("github.workspace", makeContext()),
    "/home/runner/work",
  );
});

Deno.test("resolveExpressionValue - resolves github.ref", () => {
  assertEquals(
    resolveExpressionValue("github.ref", makeContext()),
    "refs/heads/main",
  );
});

Deno.test("resolveExpressionValue - resolves github.sha", () => {
  assertEquals(resolveExpressionValue("github.sha", makeContext()), "abc123");
});

Deno.test("resolveExpressionValue - returns undefined for unknown github context key", () => {
  assertEquals(
    resolveExpressionValue("github.unknown", makeContext()),
    undefined,
  );
});

Deno.test("resolveExpressionValue - returns undefined for unknown expression prefix", () => {
  assertEquals(
    resolveExpressionValue("unknown.value", makeContext()),
    undefined,
  );
});

Deno.test("interpolateString - interpolates input references", () => {
  assertEquals(
    interpolateString("Hello ${{ inputs.name }}!", makeContext()),
    "Hello world!",
  );
});

Deno.test("interpolateString - interpolates env references", () => {
  assertEquals(interpolateString("CI=${{ env.CI }}", makeContext()), "CI=true");
});

Deno.test("interpolateString - replaces unknown expressions with empty string", () => {
  assertEquals(interpolateString("${{ unknown.ref }}", makeContext()), "");
});

Deno.test("interpolateString - handles multiple expressions", () => {
  assertEquals(
    interpolateString("${{ inputs.name }} on ${{ github.ref }}", makeContext()),
    "world on refs/heads/main",
  );
});

Deno.test("interpolateString - returns original string with no expressions", () => {
  assertEquals(
    interpolateString("no expressions here", makeContext()),
    "no expressions here",
  );
});

Deno.test("interpolateString - handles whitespace in expressions", () => {
  assertEquals(
    interpolateString("${{  inputs.name  }}", makeContext()),
    "world",
  );
});

Deno.test("interpolateString - handles step output references", () => {
  assertEquals(
    interpolateString(
      "result=${{ steps.build.outputs.output }}",
      makeContext(),
    ),
    "result=built",
  );
});

Deno.test("evaluateCondition - returns true for empty condition", () => {
  assertEquals(evaluateCondition("", makeContext()), true);
});

Deno.test("evaluateCondition - evaluates always() as true", () => {
  assertEquals(evaluateCondition("always()", makeContext()), true);
});

Deno.test("evaluateCondition - evaluates cancelled() as false", () => {
  assertEquals(evaluateCondition("cancelled()", makeContext()), false);
});

Deno.test("evaluateCondition - evaluates success() based on jobStatus", () => {
  assertEquals(
    evaluateCondition("success()", makeContext({ jobStatus: "success" })),
    true,
  );
  assertEquals(
    evaluateCondition("success()", makeContext({ jobStatus: "failure" })),
    false,
  );
});

Deno.test("evaluateCondition - evaluates failure() based on jobStatus", () => {
  assertEquals(
    evaluateCondition("failure()", makeContext({ jobStatus: "failure" })),
    true,
  );
  assertEquals(
    evaluateCondition("failure()", makeContext({ jobStatus: "success" })),
    false,
  );
});

Deno.test("evaluateCondition - evaluates negation", () => {
  assertEquals(
    evaluateCondition("!failure()", makeContext({ jobStatus: "success" })),
    true,
  );
  assertEquals(
    evaluateCondition("!failure()", makeContext({ jobStatus: "failure" })),
    false,
  );
});

Deno.test("evaluateCondition - evaluates equality comparison", () => {
  assertEquals(
    evaluateCondition("inputs.debug == 'true'", makeContext()),
    true,
  );
  assertEquals(
    evaluateCondition("inputs.debug == 'false'", makeContext()),
    false,
  );
});

Deno.test("evaluateCondition - evaluates inequality comparison", () => {
  assertEquals(
    evaluateCondition("inputs.debug != 'false'", makeContext()),
    true,
  );
  assertEquals(
    evaluateCondition("inputs.debug != 'true'", makeContext()),
    false,
  );
});

Deno.test("evaluateCondition - strips ${{ }} wrapper from condition", () => {
  assertEquals(evaluateCondition("${{ always() }}", makeContext()), true);
});

Deno.test("evaluateCondition - evaluates truthy expression value", () => {
  assertEquals(evaluateCondition("inputs.name", makeContext()), true);
});

Deno.test("evaluateCondition - evaluates falsy expression value", () => {
  assertEquals(evaluateCondition("inputs.missing", makeContext()), false);
});

Deno.test("evaluateCondition - handles comparison with double quotes", () => {
  assertEquals(
    evaluateCondition('inputs.name == "world"', makeContext()),
    true,
  );
});

Deno.test("normalizeInputValue - converts null to empty string", () => {
  assertEquals(normalizeInputValue(null), "");
});

Deno.test("normalizeInputValue - converts undefined to empty string", () => {
  assertEquals(normalizeInputValue(undefined), "");
});

Deno.test('normalizeInputValue - converts true to "true"', () => {
  assertEquals(normalizeInputValue(true), "true");
});

Deno.test('normalizeInputValue - converts false to "false"', () => {
  assertEquals(normalizeInputValue(false), "false");
});

Deno.test("normalizeInputValue - converts number to string", () => {
  assertEquals(normalizeInputValue(42), "42");
});

Deno.test("normalizeInputValue - passes string through", () => {
  assertEquals(normalizeInputValue("hello"), "hello");
});

Deno.test("resolveEnv - returns empty object for undefined env", () => {
  assertEquals(resolveEnv(undefined, makeContext()), {});
});

Deno.test("resolveEnv - interpolates string values", () => {
  assertEquals(resolveEnv({ MY_VAR: "${{ inputs.name }}" }, makeContext()), {
    MY_VAR: "world",
  });
});

Deno.test("resolveEnv - passes non-expression strings through", () => {
  assertEquals(resolveEnv({ STATIC: "value" }, makeContext()), {
    STATIC: "value",
  });
});

Deno.test("resolveWith - returns empty object for undefined input", () => {
  assertEquals(resolveWith(undefined, makeContext()), {});
});

Deno.test("resolveWith - interpolates string values", () => {
  assertEquals(resolveWith({ name: "${{ inputs.name }}" }, makeContext()), {
    name: "world",
  });
});

Deno.test("resolveWith - passes non-string values through", () => {
  assertEquals(resolveWith({ count: 42 }, makeContext()), { count: 42 });
});

Deno.test("resolveCompositeOutputs - returns empty object for undefined outputs", () => {
  assertEquals(resolveCompositeOutputs(undefined, makeContext()), {});
});

Deno.test("resolveCompositeOutputs - interpolates output values", () => {
  const outputs = {
    result: { value: "${{ steps.build.outputs.output }}" },
  };
  assertEquals(resolveCompositeOutputs(outputs, makeContext()), {
    result: "built",
  });
});

Deno.test("resolveCompositeOutputs - skips outputs without value", () => {
  const outputs = {
    noValue: { description: "No value set" },
  };
  assertEquals(resolveCompositeOutputs(outputs, makeContext()), {});
});

Deno.test("resolveCompositeOutputs - handles multiple outputs", () => {
  const outputs = {
    a: { value: "${{ inputs.name }}" },
    b: { value: "static" },
  };
  assertEquals(resolveCompositeOutputs(outputs, makeContext()), {
    a: "world",
    b: "static",
  });
});
