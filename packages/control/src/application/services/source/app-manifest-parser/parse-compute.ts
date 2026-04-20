// ============================================================
// parse-compute.ts
// ============================================================
//
// Flat-schema compute parser.
//
// Walks `compute.<name>` entries in the top-level manifest and
// builds a `Record<string, AppCompute>`. The compute `kind`
// (worker / service / attached-container) is auto-detected from
// the presence of `build`, `image`, `dockerfile`, and `containers`
// fields.
//
// Unified walker for all compute entries.
// ============================================================

import type {
  AppCompute,
  AppConsume,
  AppTriggers,
  BuildConfig,
  ComputeKind,
  HealthCheck,
  ScheduleTrigger,
  VolumeMount,
} from "../app-manifest-types.ts";
import {
  asOptionalInteger,
  asRecord,
  asRequiredString,
  asString,
  asStringArray,
  asStringMap,
  normalizeRepoPath,
  normalizeRepoRelativePath,
} from "../app-manifest-utils.ts";
import {
  validateDigestPinnedImageRef,
  validateReadinessPath,
  validateServiceScaling,
} from "../app-manifest-validation.ts";

const COMPUTE_FIELDS = new Set([
  "build",
  "image",
  "port",
  "env",
  "readiness",
  "scaling",
  "volumes",
  "containers",
  "depends",
  "triggers",
  "healthCheck",
  "dockerfile",
  "consume",
]);
const INTERNAL_COMPUTE_FIELDS = new Set([...COMPUTE_FIELDS, "kind"]);

const BUILD_FIELDS = new Set(["fromWorkflow"]);
const FROM_WORKFLOW_FIELDS = new Set([
  "path",
  "job",
  "artifact",
  "artifactPath",
]);
const VOLUME_FIELDS = new Set(["source", "target", "persistent"]);
const HEALTH_CHECK_FIELDS = new Set([
  "path",
  "interval",
  "timeout",
  "unhealthyThreshold",
]);
const TRIGGER_FIELDS = new Set(["schedules"]);
const SCHEDULE_FIELDS = new Set(["cron"]);
const CONSUME_FIELDS = new Set(["publication", "env"]);

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

// ============================================================
// Build configuration
// ============================================================

function parseBuildConfig(
  prefix: string,
  raw: unknown,
): BuildConfig | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  assertAllowedFields(record, `${prefix}.build`, BUILD_FIELDS);
  const fromWorkflow = asRecord(record.fromWorkflow);
  assertAllowedFields(
    fromWorkflow,
    `${prefix}.build.fromWorkflow`,
    FROM_WORKFLOW_FIELDS,
  );
  if (Object.keys(fromWorkflow).length === 0) {
    throw new Error(`${prefix}.build.fromWorkflow is required`);
  }
  const workflowPath = normalizeRepoRelativePath(
    asRequiredString(
      fromWorkflow.path,
      `${prefix}.build.fromWorkflow.path`,
    ),
    `${prefix}.build.fromWorkflow.path`,
  );
  if (!workflowPath.startsWith(".takos/workflows/")) {
    throw new Error(
      `${prefix}.build.fromWorkflow.path must be under .takos/workflows/`,
    );
  }
  const artifactPath = asString(
    fromWorkflow.artifactPath,
    `${prefix}.build.fromWorkflow.artifactPath`,
  );
  return {
    fromWorkflow: {
      path: workflowPath,
      job: asRequiredString(
        fromWorkflow.job,
        `${prefix}.build.fromWorkflow.job`,
      ),
      artifact: asRequiredString(
        fromWorkflow.artifact,
        `${prefix}.build.fromWorkflow.artifact`,
      ),
      ...(artifactPath
        ? {
          artifactPath: normalizeRepoRelativePath(
            artifactPath,
            `${prefix}.build.fromWorkflow.artifactPath`,
          ),
        }
        : {}),
    },
  };
}

// ============================================================
// Volumes
// ============================================================

function parseVolumeMounts(
  prefix: string,
  raw: unknown,
): Record<string, VolumeMount> | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${prefix}.volumes must be an object`);
  }
  const result: Record<string, VolumeMount> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const mountRecord = asRecord(value);
    assertAllowedFields(
      mountRecord,
      `${prefix}.volumes.${name}`,
      VOLUME_FIELDS,
    );
    const source = asRequiredString(
      mountRecord.source,
      `${prefix}.volumes.${name}.source`,
    );
    const target = asRequiredString(
      mountRecord.target,
      `${prefix}.volumes.${name}.target`,
    );
    result[name] = {
      source,
      target,
      ...(mountRecord.persistent != null
        ? { persistent: Boolean(mountRecord.persistent) }
        : {}),
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ============================================================
// Health check (service / attached container)
// ============================================================

function parseHealthCheckFlat(
  prefix: string,
  raw: unknown,
): HealthCheck | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  assertAllowedFields(record, `${prefix}.healthCheck`, HEALTH_CHECK_FIELDS);
  const path = asString(record.path, `${prefix}.healthCheck.path`);
  const interval = asOptionalInteger(
    record.interval,
    `${prefix}.healthCheck.interval`,
    { min: 1 },
  );
  const timeout = asOptionalInteger(
    record.timeout,
    `${prefix}.healthCheck.timeout`,
    { min: 1 },
  );
  const unhealthyThreshold = asOptionalInteger(
    record.unhealthyThreshold,
    `${prefix}.healthCheck.unhealthyThreshold`,
    { min: 1 },
  );
  const result: HealthCheck = {
    ...(path ? { path } : {}),
    ...(interval != null ? { interval } : {}),
    ...(timeout != null ? { timeout } : {}),
    ...(unhealthyThreshold != null ? { unhealthyThreshold } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

// ============================================================
// Triggers (worker-only schedule / queue)
// ============================================================

function parseSchedules(
  prefix: string,
  raw: unknown,
): ScheduleTrigger[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${prefix}.triggers.schedules must be an array`);
  }
  return raw.map((entry, index) => {
    const record = asRecord(entry);
    assertAllowedFields(
      record,
      `${prefix}.triggers.schedules[${index}]`,
      SCHEDULE_FIELDS,
    );
    return {
      cron: asRequiredString(
        record.cron,
        `${prefix}.triggers.schedules[${index}].cron`,
      ),
    };
  });
}

function parseTriggers(
  prefix: string,
  raw: unknown,
): AppTriggers | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  assertAllowedFields(record, `${prefix}.triggers`, TRIGGER_FIELDS);
  const schedules = parseSchedules(prefix, record.schedules);
  const result: AppTriggers = {
    ...(schedules && schedules.length > 0 ? { schedules } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeConsumeEnvAliases(
  env: Record<string, string> | undefined,
  field: string,
): Record<string, string> | undefined {
  if (!env) return undefined;
  const normalized: Record<string, string> = {};
  for (const [outputName, envName] of Object.entries(env)) {
    const trimmed = envName.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      throw new Error(
        `${field}.${outputName} has invalid env name: ${envName}`,
      );
    }
    normalized[outputName] = trimmed.toUpperCase();
  }
  return normalized;
}

function parseConsume(
  prefix: string,
  raw: unknown,
): AppConsume[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${prefix}.consume must be an array`);
  }

  const result: AppConsume[] = raw.map((entry, index) => {
    const record = asRecord(entry);
    const consumePrefix = `${prefix}.consume[${index}]`;
    assertAllowedFields(record, consumePrefix, CONSUME_FIELDS);
    const env = normalizeConsumeEnvAliases(
      asStringMap(record.env, `${consumePrefix}.env`),
      `${consumePrefix}.env`,
    );
    return {
      publication: asRequiredString(
        record.publication,
        `${consumePrefix}.publication`,
      ),
      ...(env ? { env } : {}),
    };
  });

  const seen = new Set<string>();
  for (const entry of result) {
    const key = entry.publication.trim();
    if (seen.has(key)) {
      throw new Error(
        `${prefix}.consume contains duplicate publication reference: ${key}`,
      );
    }
    seen.add(key);
  }

  return result;
}

function describeComputeKind(kind: ComputeKind): string {
  switch (kind) {
    case "worker":
      return "worker compute";
    case "service":
      return "service compute";
    case "attached-container":
      return "attached container compute";
  }
}

// ============================================================
// Compute kind detection
// ============================================================

function detectComputeKind(
  prefix: string,
  record: Record<string, unknown>,
  parentKind: ComputeKind | null,
): ComputeKind {
  const hasBuild = record.build != null;
  const hasImage = record.image != null;
  const hasDockerfile = record.dockerfile != null;
  if (parentKind === "worker") {
    if (hasBuild) {
      throw new Error(
        `${prefix}.build is not supported for attached container compute; use digest-pinned image instead.`,
      );
    }
    if (hasDockerfile && !hasImage) {
      throw new Error(
        `${prefix}.dockerfile may only be used as metadata with a digest-pinned image`,
      );
    }
    if (hasImage) {
      // Nested entries under a worker's `containers` map are attached-containers.
      return "attached-container";
    }
    throw new Error(
      `${prefix} must define 'image' for attached container compute`,
    );
  }
  if (hasBuild && hasImage) {
    throw new Error(
      `${prefix} must not define both 'build' and 'image' (choose one)`,
    );
  }
  if (hasBuild) {
    return "worker";
  }
  if (hasImage) {
    return "service";
  }
  if (hasDockerfile) {
    throw new Error(
      `${prefix}.dockerfile may only be used as metadata with a digest-pinned image`,
    );
  }
  throw new Error(
    `${prefix} must define 'build' (worker) or 'image' (service)`,
  );
}

// ============================================================
// Compute entry parser
// ============================================================

function parseComputeEntry(
  prefix: string,
  raw: unknown,
  parentKind: ComputeKind | null,
  options: ParseComputeOptions,
): AppCompute {
  const record = asRecord(raw);
  assertAllowedFields(
    record,
    prefix,
    options.allowInternalKind ? INTERNAL_COMPUTE_FIELDS : COMPUTE_FIELDS,
  );
  const kind = detectComputeKind(prefix, record, parentKind);

  const build = parseBuildConfig(prefix, record.build);
  const image = validateDigestPinnedImageRef(
    asString(record.image, `${prefix}.image`),
    `${prefix}.image`,
  );
  const port = record.port != null
    ? (() => {
      const value = Number(record.port);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${prefix}.port must be a positive number`);
      }
      return value;
    })()
    : undefined;
  if (kind !== "worker" && port == null) {
    throw new Error(
      `${prefix}.port is required for ${describeComputeKind(kind)}`,
    );
  }
  const env = asStringMap(record.env, `${prefix}.env`);
  const readiness = record.readiness != null
    ? (() => {
      if (kind !== "worker") {
        throw new Error(
          `${prefix}.readiness is not supported for ${
            describeComputeKind(kind)
          }; readiness is worker-only`,
        );
      }
      return validateReadinessPath(
        record.readiness,
        `${prefix}.readiness`,
      );
    })()
    : undefined;
  const scaling = validateServiceScaling(record.scaling, `${prefix}.scaling`);
  const volumes = parseVolumeMounts(prefix, record.volumes);
  if (kind === "worker" && volumes) {
    throw new Error(
      `${prefix}.volumes is not supported for worker compute`,
    );
  }
  const depends = asStringArray(record.depends, `${prefix}.depends`);
  const triggers = parseTriggers(prefix, record.triggers);
  const dockerfile = asString(record.dockerfile, `${prefix}.dockerfile`);
  const consume = parseConsume(prefix, record.consume);

  // Health check only applies to service / attached compute
  let healthCheck: HealthCheck | undefined;
  if (kind !== "worker") {
    healthCheck = parseHealthCheckFlat(prefix, record.healthCheck);
  } else if (record.healthCheck != null) {
    throw new Error(
      `${prefix}.healthCheck is not supported for worker compute`,
    );
  }

  // Nested attached containers (worker-only)
  let nested: Record<string, AppCompute> | undefined;
  if (record.containers != null) {
    if (kind !== "worker") {
      throw new Error(
        `${prefix}.containers is only supported for worker compute`,
      );
    }
    const nestedRecord = asRecord(record.containers);
    const resolved: Record<string, AppCompute> = {};
    for (const [nestedName, nestedValue] of Object.entries(nestedRecord)) {
      resolved[nestedName] = parseComputeEntry(
        `${prefix}.containers.${nestedName}`,
        nestedValue,
        "worker",
        options,
      );
    }
    if (Object.keys(resolved).length > 0) {
      nested = resolved;
    }
  }

  // Triggers are only meaningful on workers (schedule/queue drive workers).
  if (kind !== "worker" && triggers) {
    throw new Error(
      `${prefix}.triggers is only supported for worker compute`,
    );
  }

  return {
    kind,
    ...(build ? { build } : {}),
    ...(image ? { image } : {}),
    ...(port != null ? { port } : {}),
    ...(env ? { env } : {}),
    ...(readiness ? { readiness } : {}),
    ...(scaling ? { scaling } : {}),
    ...(volumes ? { volumes } : {}),
    ...(nested ? { containers: nested } : {}),
    ...(depends ? { depends } : {}),
    ...(triggers ? { triggers } : {}),
    ...(healthCheck ? { healthCheck } : {}),
    ...(dockerfile ? { dockerfile: normalizeRepoPath(dockerfile) } : {}),
    ...(consume ? { consume } : {}),
  };
}

// ============================================================
// Top-level compute walker
// ============================================================

export type ParseComputeOptions = {
  allowInternalKind?: boolean;
};

export function parseCompute(
  topLevel: Record<string, unknown>,
  options: ParseComputeOptions = {},
): Record<string, AppCompute> {
  if (topLevel.compute == null) {
    return {};
  }
  const computeRecord = asRecord(topLevel.compute);
  const result: Record<string, AppCompute> = {};
  for (const [name, value] of Object.entries(computeRecord)) {
    result[name] = parseComputeEntry(`compute.${name}`, value, null, options);
  }
  return result;
}
