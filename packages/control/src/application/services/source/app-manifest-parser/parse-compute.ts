// ============================================================
// parse-compute.ts
// ============================================================
//
// Flat-schema compute parser (Phase 1).
//
// Walks `compute.<name>` entries in the top-level manifest and
// builds a `Record<string, AppCompute>`. The compute `kind`
// (worker / service / attached-container) is auto-detected from
// the presence of `build`, `image`, and `containers` fields.
//
// Previous files (parse-workers.ts / parse-services.ts /
// parse-containers.ts) are retired in favor of this unified walker.
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
} from "../app-manifest-utils.ts";
import {
  validateInstanceType,
  validateReadinessPath,
  validateServiceScaling,
} from "../app-manifest-validation.ts";

// ============================================================
// Build configuration
// ============================================================

function parseBuildConfig(
  prefix: string,
  raw: unknown,
): BuildConfig | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  const fromWorkflow = asRecord(record.fromWorkflow);
  if (Object.keys(fromWorkflow).length === 0) {
    throw new Error(`${prefix}.build.fromWorkflow is required`);
  }
  const workflowPath = normalizeRepoPath(
    asRequiredString(
      fromWorkflow.path,
      `${prefix}.build.fromWorkflow.path`,
    ),
  );
  if (!workflowPath.startsWith(".takos/workflows/")) {
    throw new Error(
      `${prefix}.build.fromWorkflow.path must be under .takos/workflows/`,
    );
  }
  const artifactPathRaw = asString(
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
      ...(artifactPathRaw
        ? { artifactPath: normalizeRepoPath(artifactPathRaw) }
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
  const schedules = parseSchedules(prefix, record.schedules);
  if (record.queues != null) {
    throw new Error(
      `${prefix}.triggers.queues is retired. Publish a queue provider and consume its outputs instead.`,
    );
  }
  const result: AppTriggers = {
    ...(schedules && schedules.length > 0 ? { schedules } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
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
    const env = asStringMap(record.env, `${prefix}.consume[${index}].env`);
    return {
      publication: asRequiredString(
        record.publication,
        `${prefix}.consume[${index}].publication`,
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
  if (hasBuild && hasImage) {
    throw new Error(
      `${prefix} must not define both 'build' and 'image' (choose one)`,
    );
  }
  if (parentKind === "worker") {
    // Nested entries under a worker's `containers` map are attached-containers.
    return "attached-container";
  }
  if (hasBuild) {
    return "worker";
  }
  if (hasImage) {
    return "service";
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
): AppCompute {
  const record = asRecord(raw);
  const kind = detectComputeKind(prefix, record, parentKind);

  const build = parseBuildConfig(prefix, record.build);
  const image = asString(record.image, `${prefix}.image`);
  const port = record.port != null
    ? (() => {
      const value = Number(record.port);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${prefix}.port must be a positive number`);
      }
      return value;
    })()
    : undefined;
  const env = asStringMap(record.env, `${prefix}.env`);
  const readiness = validateReadinessPath(
    record.readiness,
    `${prefix}.readiness`,
  );
  const scaling = validateServiceScaling(record.scaling, `${prefix}.scaling`);
  const instanceType = validateInstanceType(
    record.instanceType,
    undefined,
    `${prefix}.instanceType`,
  );
  const volumes = parseVolumeMounts(prefix, record.volumes);
  const depends = asStringArray(record.depends, `${prefix}.depends`);
  const triggers = parseTriggers(prefix, record.triggers);
  const dockerfile = asString(record.dockerfile, `${prefix}.dockerfile`);
  const consume = parseConsume(prefix, record.consume);
  const maxInstances = asOptionalInteger(
    record.maxInstances,
    `${prefix}.maxInstances`,
    { min: 1 },
  );
  if (record.capabilities != null) {
    throw new Error(
      `${prefix}.capabilities is retired. Use top-level publish + ${prefix}.consume instead.`,
    );
  }

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
    ...(instanceType ? { instanceType } : {}),
    ...(volumes ? { volumes } : {}),
    ...(nested ? { containers: nested } : {}),
    ...(depends ? { depends } : {}),
    ...(triggers ? { triggers } : {}),
    ...(healthCheck ? { healthCheck } : {}),
    ...(dockerfile ? { dockerfile: normalizeRepoPath(dockerfile) } : {}),
    ...(consume ? { consume } : {}),
    ...(maxInstances != null ? { maxInstances } : {}),
  };
}

// ============================================================
// Top-level compute walker
// ============================================================

export function parseCompute(
  topLevel: Record<string, unknown>,
): Record<string, AppCompute> {
  if (topLevel.compute == null) {
    return {};
  }
  const computeRecord = asRecord(topLevel.compute);
  const result: Record<string, AppCompute> = {};
  for (const [name, value] of Object.entries(computeRecord)) {
    result[name] = parseComputeEntry(`compute.${name}`, value, null);
  }
  return result;
}
