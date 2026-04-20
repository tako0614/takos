// ============================================================
// app-manifest-validation.ts
// ============================================================
//
// Shared validators for the flat-schema manifest parser.
//
// Scope:
//   - Keep workflow YAML helpers used by deploy pipeline
//   - Keep shared field validators that new parsers reuse:
//       validateReadinessPath
//       validateVectorIndexMetric
//       validateServiceScaling
//
// ============================================================

import {
  parseWorkflow,
  validateWorkflow,
  type Workflow,
} from "takos-actions-engine";
import {
  asOptionalInteger,
  filterWorkflowErrors,
} from "./app-manifest-utils.ts";

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
// Digest-pinned image ref validator
// ============================================================

export function validateDigestPinnedImageRef(
  value: string | undefined,
  field = "image",
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/@sha256:[a-f0-9]{64}$/i.test(trimmed)) {
    throw new Error(
      `${field} must be a digest-pinned image ref (@sha256:<64 hex digest>)`,
    );
  }
  return trimmed;
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
  for (const key of Object.keys(record)) {
    if (key !== "minInstances" && key !== "maxInstances") {
      throw new Error(
        `${field}.${key} is not supported by the app manifest contract`,
      );
    }
  }
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
