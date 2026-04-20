// ---------------------------------------------------------------------------
// Expression interpolation and condition evaluation for composite actions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape needed by resolveCompositeOutputs (avoids circular import). */
export interface ActionOutputDefinition {
  description?: string;
  value?: string;
}

export interface InterpolationContext {
  inputs: Record<string, string>;
  env: Record<string, string>;
  steps: Record<string, Record<string, string>>;
  jobStatus?: "success" | "failure";
}

// ---------------------------------------------------------------------------
// String interpolation
// ---------------------------------------------------------------------------

const GITHUB_CONTEXT_MAP: Record<string, string> = {
  workspace: "GITHUB_WORKSPACE",
  repository: "GITHUB_REPOSITORY",
  ref: "GITHUB_REF",
  sha: "GITHUB_SHA",
  action_path: "GITHUB_ACTION_PATH",
  action_repository: "GITHUB_ACTION_REPOSITORY",
  action_ref: "GITHUB_ACTION_REF",
};

function resolveGithubContext(
  key: string,
  context: InterpolationContext,
): string | undefined {
  const envKey = GITHUB_CONTEXT_MAP[key];
  return envKey ? context.env[envKey] : undefined;
}

export function resolveExpressionValue(
  expression: string,
  context: InterpolationContext,
): string | undefined {
  if (expression === "true") return "true";
  if (expression === "false") return "false";

  if (expression.startsWith("inputs.")) {
    return context.inputs[expression.slice(7)] ?? "";
  }

  if (expression.startsWith("env.")) {
    return context.env[expression.slice(4)] ?? "";
  }

  if (expression.startsWith("steps.")) {
    const match = expression.match(/^steps\.([^.]+)\.outputs\.([^.]+)$/);
    if (match) {
      return context.steps?.[match[1]]?.[match[2]] ?? "";
    }
  }

  if (expression.startsWith("github.")) {
    return resolveGithubContext(expression.slice(7), context);
  }

  return undefined;
}

export function interpolateString(
  value: string,
  context: InterpolationContext,
): string {
  return value.replace(/\$\{\{\s*([^}]+)\s*\}\}/g, (_, expr: string) => {
    const resolved = resolveExpressionValue(expr.trim(), context);
    return resolved ?? "";
  });
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

const CONDITION_FUNCTIONS: Record<
  string,
  (status: string | undefined) => boolean
> = {
  "always()": () => true,
  "cancelled()": () => false,
  "failure()": (status) => status === "failure",
  "success()": (status) => status !== "failure",
};

function stripQuotes(value: string): string {
  const first = value[0];
  if ((first === '"' || first === "'") && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

export function evaluateCondition(
  expression: string,
  context: InterpolationContext,
): boolean {
  const trimmed = expression.trim();
  if (!trimmed) return true;

  const expr = trimmed.startsWith("${{") && trimmed.endsWith("}}")
    ? trimmed.slice(3, -2).trim()
    : trimmed;

  const conditionFn = CONDITION_FUNCTIONS[expr];
  if (conditionFn) return conditionFn(context.jobStatus);

  if (expr.startsWith("!")) {
    return !evaluateCondition(expr.slice(1), context);
  }

  const comparison = expr.match(/^(.+?)\s*([!=]=)\s*(.+)$/);
  if (comparison) {
    const leftRaw = comparison[1].trim();
    const rightRaw = comparison[3].trim();
    const operator = comparison[2];

    const leftValue = resolveExpressionValue(leftRaw, context) ?? "";
    const rightValue = stripQuotes(rightRaw);

    return operator === "=="
      ? leftValue === rightValue
      : leftValue !== rightValue;
  }

  const resolved = resolveExpressionValue(expr, context);
  return Boolean(resolved);
}

// ---------------------------------------------------------------------------
// Env / input resolution helpers
// ---------------------------------------------------------------------------

export function normalizeInputValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function resolveEnv(
  env: Record<string, string> | undefined,
  context: InterpolationContext,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!env) return resolved;

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      resolved[key] = interpolateString(value, context);
    } else {
      resolved[key] = normalizeInputValue(value);
    }
  }

  return resolved;
}

export function resolveWith(
  withInput: Record<string, unknown> | undefined,
  context: InterpolationContext,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  if (!withInput) return resolved;

  for (const [key, value] of Object.entries(withInput)) {
    if (typeof value === "string") {
      resolved[key] = interpolateString(value, context);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

export function resolveCompositeOutputs(
  outputs: Record<string, ActionOutputDefinition> | undefined,
  context: InterpolationContext,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!outputs) return resolved;

  for (const [key, output] of Object.entries(outputs)) {
    if (typeof output?.value === "string") {
      resolved[key] = interpolateString(output.value, context);
    }
  }

  return resolved;
}
