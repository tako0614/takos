import type { ConditionContext, ExpressionContext } from "./workflow-types.ts";
import { logWarn } from "../../shared/utils/logger.ts";

// ---------------------------------------------------------------------------
// Expression evaluation
// ---------------------------------------------------------------------------

// Simplified GitHub Actions expression evaluator. This implements only the
// subset of GH Actions expression syntax that the workflow runner needs:
//
//   - bare status functions: `always()`, `success()`, `failure()`, `cancelled()`
//   - simple `${{ ... }}` lookups for `steps.<id>.outputs.<key>`, `env.<key>`,
//     `inputs.<key>`, `github.event.inputs.<key>`
//
// Anything else (`contains()`, `startsWith()`, `==`, `&&`, `||`, ternary,
// arithmetic, composite expressions) is **NOT supported** and will quietly
// evaluate to `false` after a warning log. Workflow authors copy-pasting a
// real-world GH Actions workflow should expect non-trivial `if:` conditions to
// silently skip the step. See `packages/actions-engine/README.md` for the full
// compatibility table.
export function evaluateCondition(
  expression: string,
  context: ConditionContext,
): boolean {
  const expr = expression.trim();

  if (expr === "always()") return true;
  // `cancelled()` should be true when the parent run was cancelled. The
  // condition context exposes job.status which is set to 'cancelled' on the
  // terminal cancel transition, so we can implement this correctly.
  if (expr === "cancelled()") return context.job?.status === "cancelled";
  if (expr === "failure()") return context.job?.status === "failure";
  if (expr === "success()") return context.job?.status === "success";

  if (expr.startsWith("${{") && expr.endsWith("}}")) {
    const inner = expr.slice(3, -2).trim();

    const stepsMatch = inner.match(/^steps\.(\w+)\.outputs\.(\w+)$/);
    if (stepsMatch) {
      return Boolean(context.steps?.[stepsMatch[1]]?.[stepsMatch[2]]);
    }

    const envMatch = inner.match(/^env\.(\w+)$/);
    if (envMatch) {
      return Boolean(context.env?.[envMatch[1]]);
    }

    const inputsMatch = inner.match(/^inputs\.(\w+)$/);
    if (inputsMatch) {
      return Boolean(context.inputs?.[inputsMatch[1]]);
    }

    const githubInputsMatch = inner.match(/^github\.event\.inputs\.(\w+)$/);
    if (githubInputsMatch) {
      return Boolean(context.inputs?.[githubInputsMatch[1]]);
    }
  }

  // Unrecognized expression — log a warning so workflow authors notice that
  // their `if:` is being silently skipped instead of evaluated. (See the
  // README compatibility table for the supported subset.)
  logWarn(
    `Unrecognized workflow expression — evaluated as false. Only a subset of GitHub Actions expression syntax is supported.`,
    { module: "workflow-expressions", detail: { expression: expr } },
  );
  return false;
}

export function evaluateExpression(
  expression: string,
  context: ExpressionContext,
): string | null {
  if (!expression.startsWith("${{") || !expression.endsWith("}}")) {
    return expression;
  }

  const inner = expression.slice(3, -2).trim();

  const stepsMatch = inner.match(/^steps\.(\w+)\.outputs\.(\w+)$/);
  if (stepsMatch) {
    return context.steps?.[stepsMatch[1]]?.[stepsMatch[2]] || null;
  }

  const inputsMatch = inner.match(/^inputs\.(\w+)$/) ||
    inner.match(/^github\.event\.inputs\.(\w+)$/);
  if (inputsMatch) {
    const value = context.inputs?.[inputsMatch[1]];
    return value == null ? null : String(value);
  }

  return null;
}
