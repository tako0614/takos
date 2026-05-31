import type {
  AppCompute,
  AppResource,
  AppResourceBinding,
  AppResourceType,
} from "../app-manifest-types.ts";
import {
  asOptionalBoolean,
  asOptionalInteger,
  asRecord,
  asRequiredString,
  asString,
  asStringArray,
} from "../app-manifest-utils.ts";

const RESOURCE_TYPES = new Set<AppResourceType>([
  "sql",
  "object-store",
  "key-value",
  "queue",
  "vector-index",
  "secret",
  "analytics-engine",
  "workflow",
  "durable-object",
]);

const RESOURCE_FIELDS = new Set([
  "type",
  "bind",
  "to",
  "bindings",
  "migrations",
  "queue",
  "vectorIndex",
  "generate",
  "analyticsEngine",
  "workflow",
  "durableObject",
]);

const RESOURCE_BINDING_FIELDS = new Set([
  "target",
  "binding",
  "name",
]);

const QUEUE_FIELDS = new Set([
  "deliveryDelaySeconds",
  "maxRetries",
  "deadLetterQueue",
]);

const VECTOR_INDEX_FIELDS = new Set(["dimensions", "metric"]);
const ANALYTICS_ENGINE_FIELDS = new Set(["dataset"]);
const WORKFLOW_FIELDS = new Set([
  "service",
  "export",
  "timeoutMs",
  "maxRetries",
]);
const DURABLE_OBJECT_FIELDS = new Set(["className", "scriptName"]);

function assertAllowedFields(
  record: Record<string, unknown>,
  prefix: string,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        `${prefix}.${key} is not supported by the app manifest contract`,
      );
    }
  }
}

function parseBindingName(raw: unknown, field: string): string {
  const value = asRequiredString(raw, field).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${field} must be a valid worker binding name`);
  }
  return value.toUpperCase();
}

function parseResourceType(raw: unknown, field: string): AppResourceType {
  const type = asRequiredString(raw, field) as AppResourceType;
  if (!RESOURCE_TYPES.has(type)) {
    throw new Error(
      `${field} must be one of ${Array.from(RESOURCE_TYPES).join(", ")}`,
    );
  }
  return type;
}

function parseBindingTargets(raw: unknown, field: string): string[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  const targets = asStringArray(raw, field);
  if (targets && targets.length > 0) return targets;
  return [];
}

function parseBindingsMap(
  raw: unknown,
  prefix: string,
): AppResourceBinding[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((entry, index) => {
      const record = asRecord(entry);
      assertAllowedFields(
        record,
        `${prefix}[${index}]`,
        RESOURCE_BINDING_FIELDS,
      );
      return {
        target: asRequiredString(record.target, `${prefix}[${index}].target`),
        binding: parseBindingName(
          record.binding ?? record.name,
          `${prefix}[${index}].binding`,
        ),
      };
    });
  }
  const record = asRecord(raw);
  return Object.entries(record).map(([target, binding]) => ({
    target,
    binding: parseBindingName(binding, `${prefix}.${target}`),
  }));
}

function parseQueue(
  raw: unknown,
  prefix: string,
): AppResource["queue"] | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  assertAllowedFields(record, prefix, QUEUE_FIELDS);
  const deliveryDelaySeconds = asOptionalInteger(
    record.deliveryDelaySeconds,
    `${prefix}.deliveryDelaySeconds`,
    { min: 0 },
  );
  const maxRetries = asOptionalInteger(
    record.maxRetries,
    `${prefix}.maxRetries`,
    {
      min: 0,
    },
  );
  const deadLetterQueue = asString(
    record.deadLetterQueue,
    `${prefix}.deadLetterQueue`,
  );
  return {
    ...(deliveryDelaySeconds != null ? { deliveryDelaySeconds } : {}),
    ...(maxRetries != null ? { maxRetries } : {}),
    ...(deadLetterQueue ? { deadLetterQueue } : {}),
  };
}

function parseVectorIndex(
  raw: unknown,
  prefix: string,
): AppResource["vectorIndex"] | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  assertAllowedFields(record, prefix, VECTOR_INDEX_FIELDS);
  const dimensions = asOptionalInteger(
    record.dimensions,
    `${prefix}.dimensions`,
    {
      min: 1,
    },
  );
  const metric = asString(record.metric, `${prefix}.metric`);
  if (metric && !["cosine", "euclidean", "dot-product"].includes(metric)) {
    throw new Error(
      `${prefix}.metric must be one of cosine, euclidean, dot-product`,
    );
  }
  return {
    ...(dimensions != null ? { dimensions } : {}),
    ...(metric
      ? { metric: metric as "cosine" | "euclidean" | "dot-product" }
      : {}),
  };
}

function parseAnalyticsEngine(
  raw: unknown,
  prefix: string,
): AppResource["analyticsEngine"] | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  assertAllowedFields(record, prefix, ANALYTICS_ENGINE_FIELDS);
  const dataset = asString(record.dataset, `${prefix}.dataset`);
  return dataset ? { dataset } : {};
}

function parseWorkflow(
  raw: unknown,
  prefix: string,
): AppResource["workflow"] | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  assertAllowedFields(record, prefix, WORKFLOW_FIELDS);
  const service = asString(record.service, `${prefix}.service`);
  const exportName = asString(record.export, `${prefix}.export`);
  const timeoutMs = asOptionalInteger(record.timeoutMs, `${prefix}.timeoutMs`, {
    min: 1,
  });
  const maxRetries = asOptionalInteger(
    record.maxRetries,
    `${prefix}.maxRetries`,
    {
      min: 0,
    },
  );
  return {
    ...(service ? { service } : {}),
    ...(exportName ? { export: exportName } : {}),
    ...(timeoutMs != null ? { timeoutMs } : {}),
    ...(maxRetries != null ? { maxRetries } : {}),
  };
}

function parseDurableObject(
  raw: unknown,
  prefix: string,
): AppResource["durableObject"] | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  assertAllowedFields(record, prefix, DURABLE_OBJECT_FIELDS);
  const className = asString(record.className, `${prefix}.className`);
  const scriptName = asString(record.scriptName, `${prefix}.scriptName`);
  return {
    ...(className ? { className } : {}),
    ...(scriptName ? { scriptName } : {}),
  };
}

function assertResourceBindingTargets(
  resourceName: string,
  bindings: AppResourceBinding[],
  compute: Record<string, AppCompute>,
): void {
  for (const binding of bindings) {
    if (!compute[binding.target]) {
      throw new Error(
        `resources.${resourceName}.bindings references unknown compute: ${binding.target}`,
      );
    }
  }
}

export function parseResources(
  topLevel: Record<string, unknown>,
  compute: Record<string, AppCompute>,
): Record<string, AppResource> {
  if (topLevel.resources == null) return {};
  const resources = asRecord(topLevel.resources);
  const result: Record<string, AppResource> = {};

  for (const [name, value] of Object.entries(resources)) {
    const prefix = `resources.${name}`;
    const record = asRecord(value);
    assertAllowedFields(record, prefix, RESOURCE_FIELDS);
    const type = parseResourceType(record.type, `${prefix}.type`);
    const bind = record.bind != null
      ? parseBindingName(record.bind, `${prefix}.bind`)
      : undefined;
    const to = parseBindingTargets(record.to, `${prefix}.to`);
    const explicitBindings = parseBindingsMap(
      record.bindings,
      `${prefix}.bindings`,
    );
    const shorthandBindings = bind
      ? to.map((target) => ({ target, binding: bind }))
      : [];
    if (bind && to.length === 0) {
      throw new Error(`${prefix}.bind requires ${prefix}.to`);
    }
    const bindings = [...explicitBindings, ...shorthandBindings];
    assertResourceBindingTargets(name, bindings, compute);

    result[name] = {
      type,
      ...(bind ? { bind } : {}),
      ...(to.length > 0 ? { to } : {}),
      ...(bindings.length > 0 ? { bindings } : {}),
      ...(record.migrations != null
        ? { migrations: asString(record.migrations, `${prefix}.migrations`) }
        : {}),
      ...(record.generate != null
        ? { generate: asOptionalBoolean(record.generate, `${prefix}.generate`) }
        : {}),
      ...(parseQueue(record.queue, `${prefix}.queue`)
        ? { queue: parseQueue(record.queue, `${prefix}.queue`) }
        : {}),
      ...(parseVectorIndex(record.vectorIndex, `${prefix}.vectorIndex`)
        ? {
          vectorIndex: parseVectorIndex(
            record.vectorIndex,
            `${prefix}.vectorIndex`,
          ),
        }
        : {}),
      ...(parseAnalyticsEngine(
          record.analyticsEngine,
          `${prefix}.analyticsEngine`,
        )
        ? {
          analyticsEngine: parseAnalyticsEngine(
            record.analyticsEngine,
            `${prefix}.analyticsEngine`,
          ),
        }
        : {}),
      ...(parseWorkflow(record.workflow, `${prefix}.workflow`)
        ? { workflow: parseWorkflow(record.workflow, `${prefix}.workflow`) }
        : {}),
      ...(parseDurableObject(record.durableObject, `${prefix}.durableObject`)
        ? {
          durableObject: parseDurableObject(
            record.durableObject,
            `${prefix}.durableObject`,
          ),
        }
        : {}),
    };
  }

  return result;
}
