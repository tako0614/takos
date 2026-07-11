const MAX_TOOL_ARGUMENT_BYTES = 256 * 1024;
const MAX_VALIDATION_DEPTH = 32;
const MAX_VALIDATION_STEPS = 20_000;

type JsonSchema = boolean | Record<string, unknown>;

class ArgumentValidationFailure extends Error {}

type ValidationState = {
  root: JsonSchema;
  steps: number;
};

function fail(path: string, expectation: string): never {
  throw new ArgumentValidationFailure(
    `Invalid tool arguments at ${path}: ${expectation}`,
  );
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveLocalRef(root: JsonSchema, ref: string): JsonSchema {
  if (!ref.startsWith("#/")) {
    fail("$", "only local JSON Schema references are supported");
  }
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      fail("$", `unresolvable schema reference ${ref}`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (
    typeof current !== "boolean" &&
    (!current || typeof current !== "object" || Array.isArray(current))
  ) {
    fail("$", `unresolvable schema reference ${ref}`);
  }
  return current as JsonSchema;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    default:
      return false;
  }
}

function validateBranch(
  value: unknown,
  schema: JsonSchema,
  path: string,
  state: ValidationState,
  depth: number,
): boolean {
  try {
    validateValue(value, schema, path, state, depth);
    return true;
  } catch (error) {
    if (error instanceof ArgumentValidationFailure) return false;
    throw error;
  }
}

function validateValue(
  value: unknown,
  schema: JsonSchema,
  path: string,
  state: ValidationState,
  depth: number,
): void {
  state.steps++;
  if (state.steps > MAX_VALIDATION_STEPS) {
    fail(path, "schema validation complexity limit exceeded");
  }
  if (depth > MAX_VALIDATION_DEPTH) {
    fail(path, "nesting depth limit exceeded");
  }
  if (schema === true) return;
  if (schema === false) fail(path, "value is forbidden by the schema");

  const ref = typeof schema.$ref === "string" ? schema.$ref : null;
  if (ref) {
    validateValue(
      value,
      resolveLocalRef(state.root, ref),
      path,
      state,
      depth + 1,
    );
    return;
  }

  if (Object.hasOwn(schema, "const") && !jsonEqual(value, schema.const)) {
    fail(path, "value does not match const");
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => jsonEqual(value, candidate))
  ) {
    fail(path, "value is not in the allowed enum");
  }

  for (const keyword of ["allOf"] as const) {
    const branches = schema[keyword];
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        validateValue(value, branch as JsonSchema, path, state, depth + 1);
      }
    }
  }
  if (
    Array.isArray(schema.anyOf) &&
    !schema.anyOf.some((branch) =>
      validateBranch(value, branch as JsonSchema, path, state, depth + 1),
    )
  ) {
    fail(path, "value does not match any allowed schema");
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((branch) =>
      validateBranch(value, branch as JsonSchema, path, state, depth + 1),
    ).length;
    if (matches !== 1) fail(path, "value must match exactly one schema");
  }

  const declaredTypes =
    typeof schema.type === "string"
      ? [schema.type]
      : Array.isArray(schema.type)
        ? schema.type.filter((item): item is string => typeof item === "string")
        : [];
  if (
    declaredTypes.length > 0 &&
    !declaredTypes.some((type) => matchesType(value, type))
  ) {
    fail(path, `expected ${declaredTypes.join(" or ")}`);
  }

  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      fail(path, `expected at least ${schema.minLength} characters`);
    }
    if (
      typeof schema.maxLength === "number" &&
      value.length > schema.maxLength
    ) {
      fail(path, `expected at most ${schema.maxLength} characters`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      fail(path, `expected a value >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      fail(path, `expected a value <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      fail(path, `expected at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      fail(path, `expected at most ${schema.maxItems} items`);
    }
    if (schema.items !== undefined) {
      for (let index = 0; index < value.length; index++) {
        validateValue(
          value[index],
          schema.items as JsonSchema,
          `${path}[${index}]`,
          state,
          depth + 1,
        );
      }
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties =
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, JsonSchema>)
        : {};
    if (Array.isArray(schema.required)) {
      for (const required of schema.required) {
        if (typeof required === "string" && !Object.hasOwn(record, required)) {
          fail(path, `missing required property ${required}`);
        }
      }
    }
    for (const [key, item] of Object.entries(record)) {
      if (Object.hasOwn(properties, key)) {
        validateValue(
          item,
          properties[key],
          `${path}.${key}`,
          state,
          depth + 1,
        );
      } else if (schema.additionalProperties === false) {
        fail(path, `unexpected property ${key}`);
      } else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      ) {
        validateValue(
          item,
          schema.additionalProperties as JsonSchema,
          `${path}.${key}`,
          state,
          depth + 1,
        );
      }
    }
  }
}

export function assertValidToolArguments(
  argumentsValue: unknown,
  schemaValue: unknown,
): asserts argumentsValue is Record<string, unknown> {
  let serialized: string;
  try {
    serialized = JSON.stringify(argumentsValue);
  } catch {
    throw new Error(
      "Invalid tool arguments: arguments must be JSON serializable",
    );
  }
  if (
    new TextEncoder().encode(serialized).byteLength > MAX_TOOL_ARGUMENT_BYTES
  ) {
    throw new Error(
      `Invalid tool arguments: payload exceeds ${MAX_TOOL_ARGUMENT_BYTES} bytes`,
    );
  }
  if (
    !argumentsValue ||
    typeof argumentsValue !== "object" ||
    Array.isArray(argumentsValue)
  ) {
    throw new Error("Invalid tool arguments: expected an object");
  }
  const schema =
    typeof schemaValue === "boolean" ||
    (schemaValue &&
      typeof schemaValue === "object" &&
      !Array.isArray(schemaValue))
      ? (schemaValue as JsonSchema)
      : true;
  try {
    validateValue(argumentsValue, schema, "$", { root: schema, steps: 0 }, 0);
  } catch (error) {
    if (error instanceof ArgumentValidationFailure)
      throw new Error(error.message);
    throw error;
  }
}
