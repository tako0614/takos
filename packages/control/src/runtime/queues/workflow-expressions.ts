import type { ConditionContext, ExpressionContext } from './workflow-types.ts';

// ---------------------------------------------------------------------------
// Expression evaluation
// ---------------------------------------------------------------------------

// Simplified GitHub Actions expression evaluator (not a full parser).
export function evaluateCondition(
  expression: string,
  context: ConditionContext
): boolean {
  const expr = expression.trim();

  if (expr === 'always()') return true;
  if (expr === 'cancelled()') return false;
  if (expr === 'failure()') return context.job?.status === 'failure';
  if (expr === 'success()') return context.job?.status === 'success';

  if (expr.startsWith('${{') && expr.endsWith('}}')) {
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

  return false;
}

export function evaluateExpression(
  expression: string,
  context: ExpressionContext
): string | null {
  if (!expression.startsWith('${{') || !expression.endsWith('}}')) {
    return expression;
  }

  const inner = expression.slice(3, -2).trim();

  const stepsMatch = inner.match(/^steps\.(\w+)\.outputs\.(\w+)$/);
  if (stepsMatch) {
    return context.steps?.[stepsMatch[1]]?.[stepsMatch[2]] || null;
  }

  const inputsMatch = inner.match(/^inputs\.(\w+)$/)
    || inner.match(/^github\.event\.inputs\.(\w+)$/);
  if (inputsMatch) {
    const value = context.inputs?.[inputsMatch[1]];
    return value == null ? null : String(value);
  }

  return null;
}
