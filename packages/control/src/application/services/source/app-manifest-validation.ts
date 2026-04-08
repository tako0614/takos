// ============================================================
// app-manifest-validation.ts
// ============================================================
//
// Shared validators for the flat-schema manifest parser (Phase 1).
//
// Phase 1 scope:
//   - Keep workflow YAML helpers used by deploy pipeline
//   - Keep primitive validators that new parsers reuse:
//       validateReadinessPath
//       validateVectorIndexMetric
//       validateInstanceType
//       validateServiceScaling
//       validateWorkflowScriptIsWorker
//
// `parseResources` and `validateResourceBindings` were removed
// when `storage` replaced Cloudflare-style `resources`. Phase 2
// refactors deploy pipeline callers accordingly.
// ============================================================

import {
  parseWorkflow,
  validateWorkflow,
  type Workflow,
} from "takos-actions-engine";
import type { AppCompute, AppStorage } from "./app-manifest-types.ts";
import { asOptionalInteger, filterWorkflowErrors } from "./app-manifest-utils.ts";

// ============================================================
// Workflow YAML helpers
// ============================================================

export function parseAndValidateWorkflowYaml(
  raw: string,
  workflowPath: string,
): Workflow {
  const { workflow, diagnostics } = parseWorkflow(raw);
  const parseErrors = filterWorkflowErrors(diagnostics);
  if (parseErrors.length > 0) {
    throw new Error(
      `Workflow parse error (${workflowPath}): ${
        parseErrors.map((entry) => entry.message).join(", ")
      }`,
    );
  }

  const validation = validateWorkflow(workflow);
  const validationErrors = filterWorkflowErrors(validation.diagnostics);
  if (validationErrors.length > 0) {
    throw new Error(
      `Workflow validation error (${workflowPath}): ${
        validationErrors.map((entry) => entry.message).join(", ")
      }`,
    );
  }

  return workflow;
}

export function validateDeployProducerJob(
  workflow: Workflow,
  workflowPath: string,
  jobKey: string,
): void {
  const job = workflow.jobs[jobKey];
  if (!job) {
    throw new Error(`Workflow job not found in ${workflowPath}: ${jobKey}`);
  }
  if (job.needs) {
    throw new Error(
      `Deploy producer job must not use needs (${workflowPath}#${jobKey})`,
    );
  }
  if (job.strategy) {
    throw new Error(
      `Deploy producer job must not use strategy.matrix (${workflowPath}#${jobKey})`,
    );
  }
  if (job.services) {
    throw new Error(
      `Deploy producer job must not use services (${workflowPath}#${jobKey})`,
    );
  }
}

// ============================================================
// Readiness path validator (compute.<name>.readiness)
// ============================================================

/**
 * Validate a worker readiness probe path.
 *
 * - undefined → undefined (caller may apply default `/`)
 * - must be a string
 * - must start with `/`
 * - absolute URLs (`http://`, `https://`, `//`) are rejected
 * - paths containing `..` segments are rejected
 */
export function validateReadinessPath(
  value: unknown,
  field = "readiness",
): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("//")
  ) {
    throw new Error(
      `${field} must be a relative path (got absolute URL: ${trimmed})`,
    );
  }
  if (!trimmed.startsWith("/")) {
    throw new Error(`${field} must start with '/' (got: ${trimmed})`);
  }
  const segments = trimmed.split("/");
  if (segments.includes("..")) {
    throw new Error(
      `${field} must not contain '..' segments (got: ${trimmed})`,
    );
  }
  return trimmed;
}

// ============================================================
// Workflow storage → compute cross-ref validator
// ============================================================

/**
 * Validate that every `workflow` storage entry references a worker
 * via its `script` field. Attached containers / services are rejected
 * because workflow scripts must run as Workers.
 *
 * Returns an array of error messages (empty when valid). The caller
 * decides whether to throw or aggregate.
 */
export function validateWorkflowScriptIsWorker(
  storage: Record<string, AppStorage>,
  compute: Record<string, AppCompute>,
): string[] {
  const errors: string[] = [];
  for (const [storageName, entry] of Object.entries(storage)) {
    if (entry.type !== "workflow") continue;
    const scriptRef = entry.workflow?.script;
    if (!scriptRef) continue;
    const target = compute[scriptRef];
    if (!target) {
      errors.push(
        `storage.${storageName}.workflow.script references unknown compute: ${scriptRef}`,
      );
      continue;
    }
    if (target.kind !== "worker") {
      errors.push(
        `storage.${storageName}.workflow.script must reference a worker (got ${target.kind}: ${scriptRef})`,
      );
    }
  }
  return errors;
}

// ============================================================
// Vectorize metric validator
// ============================================================

/**
 * Validate vectorize index metric.
 *
 * - undefined → default `'cosine'`
 * - allowed values: `cosine` | `euclidean` | `dot-product`
 */
export function validateVectorIndexMetric(
  value: unknown,
  field = "vectorIndex.metric",
): "cosine" | "euclidean" | "dot-product" {
  if (value == null) return "cosine";
  const metric = String(value).trim();
  if (!metric) return "cosine";
  if (
    metric !== "cosine" &&
    metric !== "euclidean" &&
    metric !== "dot-product"
  ) {
    throw new Error(
      `${field} must be one of cosine/euclidean/dot-product (got: ${metric})`,
    );
  }
  return metric;
}

// ============================================================
// Instance type validator
// ============================================================

const INSTANCE_TYPE_BY_PROVIDER: Record<string, readonly string[]> = {
  cloudflare: ["basic", "standard", "standard-2", "standard-4"],
  aws: ["t3.small", "t3.medium", "t3.large"],
  gcp: ["cpu-1", "cpu-2", "cpu-4"],
};

/**
 * Validate instance type string.
 *
 * - undefined → undefined
 * - must be a string
 * - if provider is known (cloudflare/aws/gcp) the value must be in the
 *   provider-specific enum.
 * - k8s / local providers skip enum check (any string allowed).
 * - unknown providers fall back to a string-only check.
 */
export function validateInstanceType(
  value: unknown,
  provider?: string,
  field = "instanceType",
): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (provider && provider !== "k8s" && provider !== "local") {
    const allowed = INSTANCE_TYPE_BY_PROVIDER[provider];
    if (allowed && !allowed.includes(trimmed)) {
      throw new Error(
        `${field} must be one of ${
          allowed.join("/")
        } for provider '${provider}' (got: ${trimmed})`,
      );
    }
  }
  return trimmed;
}

// ============================================================
// Service / attached-container scaling validator
// ============================================================

type ScalingShape = {
  minInstances?: number;
  maxInstances?: number;
};

/**
 * Validate service / attached compute scaling config.
 *
 * - undefined → undefined
 * - must be an object
 * - `minInstances` (optional, integer >= 0)
 * - `maxInstances` (optional, integer >= 1)
 * - `minInstances > maxInstances` is rejected
 */
export function validateServiceScaling(
  value: unknown,
  field = "scaling",
): ScalingShape | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const minInstances = asOptionalInteger(
    record.minInstances,
    `${field}.minInstances`,
    { min: 0 },
  );
  const maxInstances = asOptionalInteger(
    record.maxInstances,
    `${field}.maxInstances`,
    { min: 1 },
  );
  if (
    minInstances != null && maxInstances != null && minInstances > maxInstances
  ) {
    throw new Error(
      `${field}.minInstances (${minInstances}) must be <= ${field}.maxInstances (${maxInstances})`,
    );
  }
  const result: ScalingShape = {
    ...(minInstances != null ? { minInstances } : {}),
    ...(maxInstances != null ? { maxInstances } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}
