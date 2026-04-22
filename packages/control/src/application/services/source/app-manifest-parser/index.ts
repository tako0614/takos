// ============================================================
// app-manifest-parser/index.ts
// ============================================================
//
// Flat-schema manifest parser entry point.
//
// Reads a YAML string, parses the top-level flat schema, and
// returns an `AppManifest`.
//
// Top-level fields:
//   - name       (required)
//   - version    (optional — semver if present)
//   - compute    (required shape)
//   - resources  (optional managed resource declarations)
//   - routes     (optional)
//   - publish    (optional)
//   - env        (optional — flat Record<string, string>)
//   - overrides  (optional)
//
// This file owns orchestration only — individual sections are
// implemented in parse-compute.ts, parse-publish.ts, and parse-routes.ts.
// ============================================================

import YAML from "yaml";
import type {
  AppCompute,
  AppManifest,
  AppManifestOverride,
  AppPublication,
} from "../app-manifest-types.ts";
import {
  asOptionalBoolean,
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
import { validateSemver } from "./parse-common.ts";
import { parseCompute } from "./parse-compute.ts";
import { parsePublish } from "./parse-publish.ts";
import { parseResources } from "./parse-resources.ts";
import { parseRoutes } from "./parse-routes.ts";

const TOP_LEVEL_FIELDS = new Set([
  "name",
  "version",
  "compute",
  "resources",
  "routes",
  "publish",
  "publications",
  "env",
  "overrides",
]);

function requireRecord(
  raw: unknown,
  field: string,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${field} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function assertAllowedFields(
  record: Record<string, unknown>,
  prefix: string,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        `${prefix}.${key} is not supported by the override contract`,
      );
    }
  }
}

function assertAllowedTopLevelFields(record: Record<string, unknown>): void {
  const envelopeFields = ["apiVersion", "kind", "metadata", "spec"];
  const hasEnvelopeField = envelopeFields.some((field) =>
    Object.hasOwn(record, field)
  );
  if (hasEnvelopeField) {
    throw new Error(
      "Takos app manifests use the flat contract; remove apiVersion/kind/metadata/spec and put name, compute, routes, publish, env, and overrides at the top level",
    );
  }

  for (const key of Object.keys(record)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      throw new Error(`${key} is not supported by the app manifest contract`);
    }
  }
}

const OVERRIDE_COMPUTE_FIELDS = new Set([
  "kind",
  "icon",
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
  "cloudflare",
]);

const OVERRIDE_BUILD_FIELDS = new Set(["fromWorkflow"]);

const OVERRIDE_FROM_WORKFLOW_FIELDS = new Set([
  "path",
  "job",
  "artifact",
  "artifactPath",
]);

const OVERRIDE_VOLUME_FIELDS = new Set(["source", "target", "persistent"]);

const OVERRIDE_TRIGGER_FIELDS = new Set(["schedules", "queues"]);
const OVERRIDE_SCHEDULE_FIELDS = new Set(["cron"]);
const OVERRIDE_QUEUE_TRIGGER_FIELDS = new Set([
  "binding",
  "queue",
  "deadLetterQueue",
  "maxBatchSize",
  "maxConcurrency",
  "maxRetries",
  "maxWaitTimeMs",
  "retryDelaySeconds",
]);
const OVERRIDE_CONSUME_FIELDS = new Set([
  "publication",
  "as",
  "request",
  "inject",
  "env",
]);
const OVERRIDE_CONSUME_INJECT_FIELDS = new Set(["env", "defaults"]);
const OVERRIDE_PUBLISH_FIELDS = new Set([
  "name",
  "publisher",
  "spec",
  "display",
  "auth",
  "type",
  "outputs",
  "title",
]);
const OVERRIDE_OUTPUT_FIELDS = new Set(["kind", "routeRef", "route"]);
const OVERRIDE_DISPLAY_FIELDS = new Set([
  "title",
  "description",
  "icon",
  "category",
  "sortOrder",
]);
const OVERRIDE_AUTH_FIELDS = new Set(["bearer"]);
const OVERRIDE_AUTH_BEARER_FIELDS = new Set(["secretRef"]);

const OVERRIDE_RESOURCE_FIELDS = new Set([
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

const OVERRIDE_HEALTH_CHECK_FIELDS = new Set([
  "path",
  "interval",
  "timeout",
  "unhealthyThreshold",
]);
const OVERRIDE_CLOUDFLARE_FIELDS = new Set(["container"]);
const OVERRIDE_CLOUDFLARE_CONTAINER_FIELDS = new Set([
  "binding",
  "className",
  "instanceType",
  "maxInstances",
  "name",
  "imageBuildContext",
  "imageVars",
  "rolloutActiveGracePeriod",
  "rolloutStepPercentage",
  "migrationTag",
  "sqlite",
]);

function parseOverrideBuild(
  prefix: string,
  raw: unknown,
): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  const record = requireRecord(raw, prefix);
  assertAllowedFields(record, prefix, OVERRIDE_BUILD_FIELDS);
  const result: Record<string, unknown> = {};

  if (record.fromWorkflow != null) {
    const fromWorkflowRecord = requireRecord(
      record.fromWorkflow,
      `${prefix}.fromWorkflow`,
    );
    assertAllowedFields(
      fromWorkflowRecord,
      `${prefix}.fromWorkflow`,
      OVERRIDE_FROM_WORKFLOW_FIELDS,
    );
    const fromWorkflow: Record<string, unknown> = {};
    const workflowPath = asString(
      fromWorkflowRecord.path,
      `${prefix}.fromWorkflow.path`,
    );
    if (workflowPath) {
      fromWorkflow.path = normalizeRepoRelativePath(
        workflowPath,
        `${prefix}.fromWorkflow.path`,
      );
    }
    const job = asString(fromWorkflowRecord.job, `${prefix}.fromWorkflow.job`);
    if (job) fromWorkflow.job = job;
    const artifact = asString(
      fromWorkflowRecord.artifact,
      `${prefix}.fromWorkflow.artifact`,
    );
    if (artifact) fromWorkflow.artifact = artifact;
    const artifactPath = asString(
      fromWorkflowRecord.artifactPath,
      `${prefix}.fromWorkflow.artifactPath`,
    );
    if (artifactPath) {
      fromWorkflow.artifactPath = normalizeRepoRelativePath(
        artifactPath,
        `${prefix}.fromWorkflow.artifactPath`,
      );
    }
    result.fromWorkflow = fromWorkflow;
  }

  return result;
}

function parseOverrideVolumes(
  prefix: string,
  raw: unknown,
): Record<string, Record<string, unknown>> | undefined {
  if (raw == null) return undefined;
  const record = requireRecord(raw, prefix);
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, value] of Object.entries(record)) {
    const mountRecord = requireRecord(value, `${prefix}.${name}`);
    assertAllowedFields(
      mountRecord,
      `${prefix}.${name}`,
      OVERRIDE_VOLUME_FIELDS,
    );
    const mount: Record<string, unknown> = {};
    const source = asString(mountRecord.source, `${prefix}.${name}.source`);
    if (source) mount.source = source;
    const target = asString(mountRecord.target, `${prefix}.${name}.target`);
    if (target) mount.target = target;
    if (mountRecord.persistent != null) {
      mount.persistent = asOptionalBoolean(
        mountRecord.persistent,
        `${prefix}.${name}.persistent`,
      );
    }
    result[name] = mount;
  }
  return result;
}

function parseOverrideSchedules(
  prefix: string,
  raw: unknown,
): Record<string, unknown>[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${prefix} must be an array`);
  }
  return raw.map((entry, index) => {
    const record = requireRecord(entry, `${prefix}[${index}]`);
    assertAllowedFields(
      record,
      `${prefix}[${index}]`,
      OVERRIDE_SCHEDULE_FIELDS,
    );
    const cron = asRequiredString(record.cron, `${prefix}[${index}].cron`);
    return { cron };
  });
}

function parseOverrideQueueBindingName(
  raw: unknown,
  field: string,
): string | undefined {
  const value = asString(raw, field);
  if (!value) return undefined;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${field} must be a valid worker binding name`);
  }
  return value.toUpperCase();
}

function parseOverrideQueues(
  prefix: string,
  raw: unknown,
): Record<string, unknown>[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${prefix} must be an array`);
  }
  return raw.map((entry, index) => {
    const queuePrefix = `${prefix}[${index}]`;
    const record = requireRecord(entry, queuePrefix);
    assertAllowedFields(
      record,
      queuePrefix,
      OVERRIDE_QUEUE_TRIGGER_FIELDS,
    );
    const binding = parseOverrideQueueBindingName(
      record.binding,
      `${queuePrefix}.binding`,
    );
    const queue = asString(record.queue, `${queuePrefix}.queue`);
    if (binding && queue) {
      throw new Error(
        `${queuePrefix} must specify either binding or queue, not both`,
      );
    }
    if (!binding && !queue) {
      throw new Error(`${queuePrefix} requires binding or queue`);
    }
    const deadLetterQueue = asString(
      record.deadLetterQueue,
      `${queuePrefix}.deadLetterQueue`,
    );
    const maxBatchSize = asOptionalInteger(
      record.maxBatchSize,
      `${queuePrefix}.maxBatchSize`,
      { min: 1 },
    );
    const maxConcurrency = asOptionalInteger(
      record.maxConcurrency,
      `${queuePrefix}.maxConcurrency`,
      { min: 1 },
    );
    const maxRetries = asOptionalInteger(
      record.maxRetries,
      `${queuePrefix}.maxRetries`,
      { min: 0 },
    );
    const maxWaitTimeMs = asOptionalInteger(
      record.maxWaitTimeMs,
      `${queuePrefix}.maxWaitTimeMs`,
      { min: 0 },
    );
    const retryDelaySeconds = asOptionalInteger(
      record.retryDelaySeconds,
      `${queuePrefix}.retryDelaySeconds`,
      { min: 0 },
    );
    return {
      ...(binding ? { binding } : {}),
      ...(queue ? { queue } : {}),
      ...(deadLetterQueue ? { deadLetterQueue } : {}),
      ...(maxBatchSize != null ? { maxBatchSize } : {}),
      ...(maxConcurrency != null ? { maxConcurrency } : {}),
      ...(maxRetries != null ? { maxRetries } : {}),
      ...(maxWaitTimeMs != null ? { maxWaitTimeMs } : {}),
      ...(retryDelaySeconds != null ? { retryDelaySeconds } : {}),
    };
  });
}

function parseOverrideTriggers(
  prefix: string,
  raw: unknown,
): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  const record = requireRecord(raw, prefix);
  assertAllowedFields(record, prefix, OVERRIDE_TRIGGER_FIELDS);
  const schedules = parseOverrideSchedules(
    `${prefix}.schedules`,
    record.schedules,
  );
  const queues = parseOverrideQueues(`${prefix}.queues`, record.queues);
  const result: Record<string, unknown> = {};
  if (schedules) result.schedules = schedules;
  if (queues) result.queues = queues;
  return result;
}

function parseOverrideHealthCheck(
  prefix: string,
  raw: unknown,
): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  const record = requireRecord(raw, prefix);
  assertAllowedFields(record, prefix, OVERRIDE_HEALTH_CHECK_FIELDS);
  const result: Record<string, unknown> = {};
  const path = asString(record.path, `${prefix}.path`);
  if (path) result.path = path;
  const interval = asOptionalInteger(record.interval, `${prefix}.interval`, {
    min: 1,
  });
  if (interval != null) result.interval = interval;
  const timeout = asOptionalInteger(record.timeout, `${prefix}.timeout`, {
    min: 1,
  });
  if (timeout != null) result.timeout = timeout;
  const unhealthyThreshold = asOptionalInteger(
    record.unhealthyThreshold,
    `${prefix}.unhealthyThreshold`,
    { min: 1 },
  );
  if (unhealthyThreshold != null) {
    result.unhealthyThreshold = unhealthyThreshold;
  }
  return result;
}

function parseOverrideConsumes(
  prefix: string,
  raw: unknown,
): Record<string, unknown>[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${prefix} must be an array`);
  }
  return raw.map((entry, index) => {
    const record = requireRecord(entry, `${prefix}[${index}]`);
    assertAllowedFields(record, `${prefix}[${index}]`, OVERRIDE_CONSUME_FIELDS);
    const publication = asRequiredString(
      record.publication,
      `${prefix}[${index}].publication`,
    );
    const result: Record<string, unknown> = { publication };
    const alias = asString(record.as, `${prefix}[${index}].as`);
    if (alias) result.as = alias;
    if (record.request != null) {
      result.request = requireRecord(
        record.request,
        `${prefix}[${index}].request`,
      );
    }
    if (record.env != null && record.inject != null) {
      throw new Error(`${prefix}[${index}] must not combine env and inject`);
    }
    if (record.inject != null) {
      const injectRecord = requireRecord(
        record.inject,
        `${prefix}[${index}].inject`,
      );
      assertAllowedFields(
        injectRecord,
        `${prefix}[${index}].inject`,
        OVERRIDE_CONSUME_INJECT_FIELDS,
      );
      const inject: Record<string, unknown> = {};
      if (injectRecord.env != null) {
        inject.env = asStringMap(
          injectRecord.env,
          `${prefix}[${index}].inject.env`,
        );
      }
      if (injectRecord.defaults != null) {
        inject.defaults = asOptionalBoolean(
          injectRecord.defaults,
          `${prefix}[${index}].inject.defaults`,
        );
      }
      result.inject = inject;
    }
    if (record.env != null) {
      result.inject = {
        env: asStringMap(
          record.env,
          `${prefix}[${index}].env`,
        ),
      };
    }
    return result;
  });
}

function parseOverrideCloudflare(
  prefix: string,
  raw: unknown,
): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  const record = requireRecord(raw, prefix);
  assertAllowedFields(record, prefix, OVERRIDE_CLOUDFLARE_FIELDS);
  const result: Record<string, unknown> = {};

  if (record.container != null) {
    const container = requireRecord(record.container, `${prefix}.container`);
    assertAllowedFields(
      container,
      `${prefix}.container`,
      OVERRIDE_CLOUDFLARE_CONTAINER_FIELDS,
    );
    result.container = { ...container };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseOverrideComputeEntry(
  prefix: string,
  raw: unknown,
): Record<string, unknown> {
  const record = requireRecord(raw, prefix);
  assertAllowedFields(record, prefix, OVERRIDE_COMPUTE_FIELDS);

  const result: Record<string, unknown> = {};
  const icon = asString(record.icon, `${prefix}.icon`);
  if (icon) result.icon = icon;

  const build = parseOverrideBuild(`${prefix}.build`, record.build);
  if (build !== undefined) result.build = build;

  const image = validateDigestPinnedImageRef(
    asString(record.image, `${prefix}.image`),
    `${prefix}.image`,
  );
  if (image) result.image = image;

  const port = asOptionalInteger(record.port, `${prefix}.port`, { min: 1 });
  if (port != null) result.port = port;

  const env = asStringMap(record.env, `${prefix}.env`);
  if (env) result.env = env;

  const readiness = asString(record.readiness, `${prefix}.readiness`);
  if (readiness) {
    result.readiness = validateReadinessPath(
      readiness,
      `${prefix}.readiness`,
    );
  }

  const scaling = validateServiceScaling(record.scaling, `${prefix}.scaling`);
  if (scaling) result.scaling = scaling;

  const volumes = parseOverrideVolumes(`${prefix}.volumes`, record.volumes);
  if (volumes) result.volumes = volumes;

  const depends = record.depends == null
    ? undefined
    : asStringArray(record.depends, `${prefix}.depends`);
  if (depends) result.depends = depends;

  const triggers = parseOverrideTriggers(`${prefix}.triggers`, record.triggers);
  if (triggers) result.triggers = triggers;

  const dockerfile = asString(record.dockerfile, `${prefix}.dockerfile`);
  if (dockerfile) result.dockerfile = normalizeRepoPath(dockerfile);

  const consume = parseOverrideConsumes(`${prefix}.consume`, record.consume);
  if (consume) result.consume = consume;

  const cloudflare = parseOverrideCloudflare(
    `${prefix}.cloudflare`,
    record.cloudflare,
  );
  if (cloudflare) result.cloudflare = cloudflare;

  const healthCheck = parseOverrideHealthCheck(
    `${prefix}.healthCheck`,
    record.healthCheck,
  );
  if (healthCheck) result.healthCheck = healthCheck;

  if (record.containers != null) {
    const nestedRecord = requireRecord(
      record.containers,
      `${prefix}.containers`,
    );
    const nested: Record<string, Record<string, unknown>> = {};
    for (const [nestedName, nestedValue] of Object.entries(nestedRecord)) {
      nested[nestedName] = parseOverrideComputeEntry(
        `${prefix}.containers.${nestedName}`,
        nestedValue,
      );
    }
    result.containers = nested;
  }

  return result;
}

function parseOverrideCompute(
  raw: unknown,
): Record<string, AppCompute> | undefined {
  if (raw == null) return undefined;
  const record = requireRecord(raw, "overrides.compute");
  const result: Record<string, AppCompute> = {};
  for (const [computeName, computeOverride] of Object.entries(record)) {
    result[computeName] = parseOverrideComputeEntry(
      `overrides.compute.${computeName}`,
      computeOverride,
    ) as AppCompute;
  }
  return result;
}

function parseOverridePublishEntry(
  index: number,
  raw: unknown,
): Record<string, unknown> {
  const prefix = `overrides.publish[${index}]`;
  const record = requireRecord(raw, prefix);
  assertAllowedFields(record, prefix, OVERRIDE_PUBLISH_FIELDS);

  const result: Record<string, unknown> = {};
  const name = asRequiredString(record.name, `${prefix}.name`);
  result.name = name;
  const publisher = asString(record.publisher, `${prefix}.publisher`);
  if (publisher) result.publisher = publisher;
  const spec = record.spec;
  if (spec != null) result.spec = requireRecord(spec, `${prefix}.spec`);
  if (record.display != null) {
    const display = requireRecord(record.display, `${prefix}.display`);
    assertAllowedFields(display, `${prefix}.display`, OVERRIDE_DISPLAY_FIELDS);
    const parsedDisplay: Record<string, unknown> = {};
    for (const key of ["title", "description", "icon", "category"]) {
      const value = asString(display[key], `${prefix}.display.${key}`);
      if (value) parsedDisplay[key] = value;
    }
    if (display.sortOrder != null) {
      parsedDisplay.sortOrder = asOptionalInteger(
        display.sortOrder,
        `${prefix}.display.sortOrder`,
      );
    }
    result.display = parsedDisplay;
  }
  if (record.auth != null) {
    const auth = requireRecord(record.auth, `${prefix}.auth`);
    assertAllowedFields(auth, `${prefix}.auth`, OVERRIDE_AUTH_FIELDS);
    const parsedAuth: Record<string, unknown> = {};
    if (auth.bearer != null) {
      const bearer = requireRecord(auth.bearer, `${prefix}.auth.bearer`);
      assertAllowedFields(
        bearer,
        `${prefix}.auth.bearer`,
        OVERRIDE_AUTH_BEARER_FIELDS,
      );
      parsedAuth.bearer = {
        secretRef: asRequiredString(
          bearer.secretRef,
          `${prefix}.auth.bearer.secretRef`,
        ),
      };
    }
    result.auth = parsedAuth;
  }
  const type = asString(record.type, `${prefix}.type`);
  if (type) result.type = type;
  if (record.outputs != null) {
    const outputs = requireRecord(record.outputs, `${prefix}.outputs`);
    const parsedOutputs: Record<string, unknown> = {};
    for (const [outputName, outputRaw] of Object.entries(outputs)) {
      const output = requireRecord(
        outputRaw,
        `${prefix}.outputs.${outputName}`,
      );
      assertAllowedFields(
        output,
        `${prefix}.outputs.${outputName}`,
        OVERRIDE_OUTPUT_FIELDS,
      );
      const kind = asString(
        output.kind,
        `${prefix}.outputs.${outputName}.kind`,
      );
      const routeRef = asString(
        output.routeRef,
        `${prefix}.outputs.${outputName}.routeRef`,
      );
      const route = asString(
        output.route,
        `${prefix}.outputs.${outputName}.route`,
      );
      const parsedOutput: Record<string, unknown> = {};
      if (kind) parsedOutput.kind = kind;
      if (routeRef) parsedOutput.routeRef = routeRef;
      if (route) {
        if (!route.startsWith("/")) {
          throw new Error(
            `${prefix}.outputs.${outputName}.route must start with '/' (got: ${route})`,
          );
        }
        parsedOutput.route = route;
      }
      parsedOutputs[outputName] = parsedOutput;
    }
    result.outputs = parsedOutputs;
  }
  const title = asString(record.title, `${prefix}.title`);
  if (title) result.title = title;

  return result;
}

function parseOverridePublish(
  raw: unknown,
): AppPublication[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error("overrides.publish must be an array");
  }
  return raw.map((entry, index) =>
    parseOverridePublishEntry(index, entry) as AppPublication
  );
}

function parseOverrideResources(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  const record = requireRecord(raw, "overrides.resources");
  const result: Record<string, unknown> = {};
  for (const [resourceName, value] of Object.entries(record)) {
    const prefix = `overrides.resources.${resourceName}`;
    const resourceRecord = requireRecord(value, prefix);
    assertAllowedFields(resourceRecord, prefix, OVERRIDE_RESOURCE_FIELDS);
    result[resourceName] = resourceRecord;
  }
  return result;
}

function parseOverrides(
  raw: unknown,
): Record<string, AppManifestOverride> | undefined {
  if (raw == null) return undefined;
  const record = requireRecord(raw, "overrides");
  const result: Record<string, AppManifestOverride> = {};
  for (const [envName, envOverrides] of Object.entries(record)) {
    const envRecord = requireRecord(envOverrides, `overrides.${envName}`);
    assertAllowedFields(
      envRecord,
      `overrides.${envName}`,
      new Set([
        "compute",
        "routes",
        "publish",
        "publications",
        "env",
        "resources",
      ]),
    );
    if (envRecord.publish != null && envRecord.publications != null) {
      throw new Error(
        `overrides.${envName}.publish and overrides.${envName}.publications cannot be used together`,
      );
    }
    const entry: AppManifestOverride = {};
    if (envRecord.compute != null) {
      entry.compute = parseOverrideCompute(envRecord.compute) as Record<
        string,
        AppCompute
      >;
    }
    if (envRecord.routes != null) {
      // Routes in overrides still defer compute target resolution until
      // apply time, but the parser can safely validate their shape and
      // intra-list uniqueness now.
      entry.routes = parseRoutes(
        { routes: envRecord.routes },
        {},
        { validateTargets: false },
      );
    }
    const publishOverride = envRecord.publications ?? envRecord.publish;
    if (publishOverride != null) {
      entry.publish = parseOverridePublish(
        publishOverride,
      ) as AppPublication[];
    }
    if (envRecord.env != null) {
      const envMap = asStringMap(envRecord.env, `overrides.${envName}.env`);
      if (envMap) entry.env = envMap;
    }
    if (envRecord.resources != null) {
      entry.resources = parseOverrideResources(envRecord.resources) as never;
    }
    if (Object.keys(entry).length > 0) {
      result[envName] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function parseAppManifestYaml(raw: string): AppManifest {
  const parsed = YAML.parse(raw);
  const record = asRecord(parsed);

  assertAllowedTopLevelFields(record);

  // --- Top-level scalars ---
  const name = asRequiredString(record.name, "name");
  const version = asString(record.version, "version");
  if (version) {
    validateSemver(version);
  }

  // --- Major sections ---
  const compute = parseCompute(record);
  const resources = parseResources(record, compute);
  const routes = parseRoutes(record, compute);
  const publish = parsePublish(record);

  // --- Env (flat Record<string, string>) ---
  const env = asStringMap(record.env, "env") ?? {};

  // --- Overrides ---
  const overrides = parseOverrides(record.overrides);

  // --- depends cross-ref validation ---
  const computeNames = new Set(Object.keys(compute));
  for (const [name, entry] of Object.entries(compute)) {
    if (!entry.depends) continue;
    for (const dep of entry.depends) {
      if (!computeNames.has(dep)) {
        throw new Error(
          `compute.${name}.depends references unknown compute: ${dep}`,
        );
      }
    }
  }

  return {
    name,
    ...(version ? { version } : {}),
    compute,
    resources,
    routes,
    publish,
    env,
    ...(overrides ? { overrides } : {}),
  };
}

export const parseAppManifestText = parseAppManifestYaml;

// Re-export parsers for any consumers that import them directly
export { parseCompute } from "./parse-compute.ts";
export { parsePublish } from "./parse-publish.ts";
export { parseRoutes } from "./parse-routes.ts";
