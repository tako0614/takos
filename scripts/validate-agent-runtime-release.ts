#!/usr/bin/env -S bun
import { parse as parseYaml } from "yaml";
import * as runtime from "./runtime.ts";
import {
  CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD_SECONDS,
  DEFAULT_EXECUTOR_POOL_CAPACITY,
  DEFAULT_EXECUTOR_TIER2_MAX_INSTANCES,
  DEFAULT_RUNTIME_CONTAINER_MAX_INSTANCES,
} from "../src/worker/runtime/container-hosts/executor-capacity.ts";
import { QUEUE_CONSUMERS } from "./control/queue-consumer-config.ts";

const WRANGLER_PATH = "deploy/cloudflare/wrangler.toml";
const WORKFLOW_PATH = ".github/workflows/release-artifacts.yml";
export const AGENT_ENGINE_SOURCE_PATH = "containers/agent/engine-source.json";
const EGRESS_ENTRYPOINT = "TakosEgressEntrypoint";

const QUEUE_NAMES = {
  production: {
    runs: "takos-runs",
    runs_dlq: "takos-runs-dlq",
    index_jobs: "takos-index-jobs",
    index_jobs_dlq: "takos-index-jobs-dlq",
    workflow: "takos-workflow-jobs",
    workflow_dlq: "takos-workflow-jobs-dlq",
    deployment: "takos-deployment-jobs",
    deployment_dlq: "takos-deployment-jobs-dlq",
    notification_push: "takos-notification-push",
    notification_push_dlq: "takos-notification-push-dlq",
  },
  staging: {
    runs: "takos-runs-staging",
    runs_dlq: "takos-runs-dlq-staging",
    index_jobs: "takos-index-jobs-staging",
    index_jobs_dlq: "takos-index-jobs-dlq-staging",
    workflow: "takos-workflow-jobs-staging",
    workflow_dlq: "takos-workflow-jobs-dlq-staging",
    deployment: "takos-deployment-jobs-staging",
    deployment_dlq: "takos-deployment-jobs-dlq-staging",
    notification_push: "takos-notification-push-staging",
    notification_push_dlq: "takos-notification-push-dlq-staging",
  },
} as const;

type JsonRecord = Record<string, unknown>;

export type AgentEngineSource = {
  schemaVersion: number;
  repository: string;
  commit: string;
};

export type AgentRuntimeReleaseValidationInput = {
  wranglerText: string;
  workflowText: string;
  engineSource: unknown;
};

export function validateAgentEngineSource(value: unknown): {
  source: AgentEngineSource | null;
  errors: string[];
} {
  const record = asRecord(value);
  const errors: string[] = [];
  if (!record) {
    return {
      source: null,
      errors: [`${AGENT_ENGINE_SOURCE_PATH} must be a JSON object`],
    };
  }

  if (record.schemaVersion !== 1) {
    errors.push(`${AGENT_ENGINE_SOURCE_PATH} schemaVersion must be 1`);
  }
  if (record.repository !== "tako0614/takos-agent-engine") {
    errors.push(
      `${AGENT_ENGINE_SOURCE_PATH} repository must be tako0614/takos-agent-engine`,
    );
  }
  if (
    typeof record.commit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(record.commit)
  ) {
    errors.push(
      `${AGENT_ENGINE_SOURCE_PATH} commit must be an immutable 40-character Git SHA`,
    );
  }

  return {
    source:
      errors.length === 0
        ? {
            schemaVersion: 1,
            repository: record.repository as string,
            commit: record.commit as string,
          }
        : null,
    errors,
  };
}

export function validateAgentRuntimeReleaseContract(
  input: AgentRuntimeReleaseValidationInput,
): string[] {
  const errors: string[] = [];
  let config: JsonRecord;
  try {
    config = Bun.TOML.parse(input.wranglerText) as JsonRecord;
  } catch (error) {
    return [
      `${WRANGLER_PATH} must parse as TOML: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }

  validateContainerConfig("production", recordArray(config.containers), errors);
  const staging = asRecord(asRecord(config.env)?.staging);
  validateContainerConfig("staging", recordArray(staging?.containers), errors);

  validateQueueConfig(
    "production",
    recordArray(asRecord(config.queues)?.consumers),
    errors,
  );
  validateEgressBinding(
    "production",
    recordArray(config.services),
    "takos",
    errors,
  );
  validateEgressBinding(
    "staging",
    recordArray(staging?.services),
    "takos-staging",
    errors,
  );
  validateQueueConfig(
    "staging",
    recordArray(asRecord(staging?.queues)?.consumers),
    errors,
  );

  errors.push(...validateAgentEngineSource(input.engineSource).errors);
  validateReleaseWorkflow(input.workflowText, errors);
  return errors;
}

function validateEgressBinding(
  environment: "production" | "staging",
  services: JsonRecord[],
  expectedService: string,
  errors: string[],
): void {
  const binding = services.find(
    (candidate) => candidate.binding === "TAKOS_EGRESS",
  );
  const label = `${WRANGLER_PATH} ${environment} TAKOS_EGRESS`;
  if (!binding) {
    errors.push(`${label} service binding is missing`);
    return;
  }
  if (binding.service !== expectedService) {
    errors.push(`${label} service must be ${expectedService}`);
  }
  if (binding.entrypoint !== EGRESS_ENTRYPOINT) {
    errors.push(`${label} entrypoint must be ${EGRESS_ENTRYPOINT}`);
  }
}

function validateContainerConfig(
  environment: "production" | "staging",
  containers: JsonRecord[],
  errors: string[],
): void {
  const expected = new Map<string, number>([
    ["TakosRuntimeContainer", DEFAULT_RUNTIME_CONTAINER_MAX_INSTANCES],
    [
      "ExecutorContainerTier1",
      DEFAULT_EXECUTOR_POOL_CAPACITY.tier1WarmPoolSize,
    ],
    ["ExecutorContainerTier2", DEFAULT_EXECUTOR_TIER2_MAX_INSTANCES],
    ["ExecutorContainerTier3", DEFAULT_EXECUTOR_POOL_CAPACITY.tier3PoolSize],
  ]);

  for (const [className, maxInstances] of expected) {
    const container = containers.find(
      (candidate) => candidate.class_name === className,
    );
    const label = `${WRANGLER_PATH} ${environment} ${className}`;
    if (!container) {
      errors.push(`${label} is missing`);
      continue;
    }
    if (container.max_instances !== maxInstances) {
      errors.push(`${label} max_instances must be ${maxInstances}`);
    }
    if (
      container.rollout_active_grace_period !==
      CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD_SECONDS
    ) {
      errors.push(
        `${label} rollout_active_grace_period must be ${CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD_SECONDS}`,
      );
    }
  }
}

function validateQueueConfig(
  environment: keyof typeof QUEUE_NAMES,
  consumers: JsonRecord[],
  errors: string[],
): void {
  const names = QUEUE_NAMES[environment];
  for (const desired of QUEUE_CONSUMERS) {
    const queue = names[desired.queueKey as keyof typeof names];
    const consumer = consumers.find((candidate) => candidate.queue === queue);
    const label = `${WRANGLER_PATH} ${environment} queue ${queue}`;
    if (!consumer) {
      errors.push(`${label} consumer is missing`);
      continue;
    }
    expectNumber(consumer, "max_batch_size", desired.batchSize, label, errors);
    expectNumber(
      consumer,
      "max_batch_timeout",
      desired.batchTimeout,
      label,
      errors,
    );
    expectOptionalNumber(
      consumer,
      "max_retries",
      desired.messageRetries,
      label,
      errors,
    );
    expectOptionalNumber(
      consumer,
      "max_concurrency",
      desired.maxConcurrency,
      label,
      errors,
    );
    expectOptionalNumber(
      consumer,
      "retry_delay",
      desired.retryDelaySeconds,
      label,
      errors,
    );
    const expectedDlq = desired.deadLetterQueueKey
      ? names[desired.deadLetterQueueKey as keyof typeof names]
      : undefined;
    if (consumer.dead_letter_queue !== expectedDlq) {
      errors.push(
        `${label} dead_letter_queue must be ${expectedDlq ?? "unset"}`,
      );
    }
  }
}

function validateReleaseWorkflow(text: string, errors: string[]): void {
  let workflow: JsonRecord;
  try {
    const parsed = asRecord(parseYaml(text));
    if (!parsed) throw new Error("workflow root must be a mapping");
    workflow = parsed;
  } catch (error) {
    errors.push(
      `${WORKFLOW_PATH} must parse as YAML: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  const jobs = asRecord(workflow.jobs);
  const validateJob = asRecord(jobs?.validate);
  const allSteps = jobs
    ? Object.values(jobs).flatMap((job) => workflowSteps(asRecord(job)))
    : [];
  const sourceStep = workflowSteps(validateJob).find(
    (step) => step.id === "source",
  );
  const sourceRun = shellCode(sourceStep?.run);
  const sourceEnv = asRecord(sourceStep?.env);
  if (
    allSteps.some(
      (step) =>
        asRecord(step.env)?.RELEASE_VERSION === "${{ inputs.version }}" ||
        stringValue(asRecord(step.with)?.tags).includes(
          "type=raw,value=${{ inputs.version }}",
        ),
    )
  ) {
    errors.push(
      `${WORKFLOW_PATH} must not use workflow input as the release version source`,
    );
  }
  if (!sourceRun.includes(".takosRelease.version // .version")) {
    errors.push(
      `${WORKFLOW_PATH} must use package.json takosRelease.version as the release version source`,
    );
  }

  if (
    sourceEnv?.REQUESTED_PUBLISH !== "${{ inputs.publish }}" ||
    !sourceRun.includes('"${REQUESTED_PUBLISH}" == "true"') ||
    !sourceRun.includes("git ls-remote --tags origin") ||
    !sourceRun.includes("release_tag_commit")
  ) {
    errors.push(
      `${WORKFLOW_PATH} validate job must resolve an existing release tag before publishing`,
    );
  }
  if (!sourceRun.includes('"${release_tag_commit}" != "${GITHUB_SHA}"')) {
    errors.push(
      `${WORKFLOW_PATH} validate job must bind the release tag to GITHUB_SHA`,
    );
  }

  const ociJob = asRecord(jobs?.["oci-images"]);
  const ociSteps = workflowSteps(ociJob);
  const engineCheckout = ociSteps.find(
    (step) => asRecord(step.with)?.path === "takos-agent-engine",
  );
  const engineCheckoutWith = asRecord(engineCheckout?.with);
  if (
    engineCheckoutWith?.repository !==
      "${{ needs.validate.outputs.agent_engine_repository }}" ||
    engineCheckoutWith.ref !==
      "${{ needs.validate.outputs.agent_engine_commit }}"
  ) {
    errors.push(
      `${WORKFLOW_PATH} must checkout takos-agent-engine at the validated immutable pin`,
    );
  }
  const engineCompileStep = ociSteps.find(
    (step) => step.name === "Compile agent wrapper against pinned engine",
  );
  if (
    engineCompileStep?.if !== "matrix.image == 'takos-agent'" ||
    asRecord(engineCompileStep?.env)?.TAKOS_AGENT_ENGINE_CHECKOUT !==
      "${{ github.workspace }}/takos-agent-engine" ||
    !shellCode(engineCompileStep?.run).includes(
      "bun run validate:agent-engine-source",
    )
  ) {
    errors.push(
      `${WORKFLOW_PATH} must compile the agent wrapper against the clean pinned engine checkout`,
    );
  }

  const digestMetadataStep = ociSteps.find(
    (step) => step.name === "Record image digest metadata",
  );
  if (!shellCode(digestMetadataStep?.run).includes("agentEngineCommit")) {
    errors.push(
      `${WORKFLOW_PATH} must record agentEngineCommit in image provenance metadata`,
    );
  }

  const matrix = asRecord(asRecord(ociJob?.strategy)?.matrix);
  const runtimeImage = recordArray(matrix?.include).find(
    (entry) => entry.image === "takos-worker-runtime",
  );
  if (!runtimeImage || "cloudflare_build_path" in runtimeImage) {
    errors.push(
      `${WORKFLOW_PATH} must promote the attested takos-worker-runtime digest instead of rebuilding it for Cloudflare`,
    );
  }
  const cloudflarePublishStep = ociSteps.find(
    (step) => step.name === "Build and publish Cloudflare Container image",
  );
  const cloudflarePublishRun = shellCode(cloudflarePublishStep?.run);
  if (
    !cloudflarePublishRun.includes(
      'source_ref="${GHCR_IMAGE}@${IMAGE_DIGEST}"',
    ) ||
    !cloudflarePublishRun.includes('docker pull "${source_ref}"') ||
    !cloudflarePublishRun.includes("wrangler containers push") ||
    cloudflarePublishRun.includes("wrangler containers build")
  ) {
    errors.push(
      `${WORKFLOW_PATH} Cloudflare Container publish must promote the GHCR digest without a second build`,
    );
  }

  const releaseJob = asRecord(jobs?.["release-manifest"]);
  const publishStep = workflowSteps(releaseJob).find(
    (step) => step.name === "Publish GitHub release assets",
  );
  const publishRun = shellCode(publishStep?.run);
  const validateOutputs = asRecord(validateJob?.outputs);
  const publishEnv = asRecord(publishStep?.env);
  if (
    validateOutputs?.release_tag_commit !==
      "${{ steps.source.outputs.release_tag_commit }}" ||
    publishEnv?.EXPECTED_RELEASE_COMMIT !==
      "${{ needs.validate.outputs.release_tag_commit }}" ||
    !publishRun.includes("git ls-remote --tags origin") ||
    !publishRun.includes("EXPECTED_RELEASE_COMMIT") ||
    !publishRun.includes('"${current_tag_commit}" != "${GITHUB_SHA}"')
  ) {
    errors.push(
      `${WORKFLOW_PATH} publish step must revalidate the release tag against GITHUB_SHA`,
    );
  }
  if (!publishRun.includes("--verify-tag")) {
    errors.push(
      `${WORKFLOW_PATH} must require an existing Git tag when creating a release`,
    );
  }
  if (
    !publishRun.includes("existing_commit") ||
    !publishRun.includes(".git.commit") ||
    !publishRun.includes('"${existing_commit}" != "${GITHUB_SHA}"') ||
    !publishRun.includes("refusing to clobber")
  ) {
    errors.push(
      `${WORKFLOW_PATH} must refuse to clobber release assets from another commit`,
    );
  }
}

function workflowSteps(job: JsonRecord | null): JsonRecord[] {
  return recordArray(job?.steps);
}

function shellCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function expectNumber(
  record: JsonRecord,
  key: string,
  expected: number,
  label: string,
  errors: string[],
): void {
  if (record[key] !== expected) {
    errors.push(`${label} ${key} must be ${expected}`);
  }
}

function expectOptionalNumber(
  record: JsonRecord,
  key: string,
  expected: number | undefined,
  label: string,
  errors: string[],
): void {
  if (expected === undefined) {
    if (record[key] !== undefined) errors.push(`${label} ${key} must be unset`);
    return;
  }
  expectNumber(record, key, expected, label, errors);
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((value): value is JsonRecord => value !== null)
    : [];
}

async function main(): Promise<void> {
  const [wranglerText, workflowText, engineSourceText] = await Promise.all([
    runtime.readTextFile(WRANGLER_PATH),
    runtime.readTextFile(WORKFLOW_PATH),
    runtime.readTextFile(AGENT_ENGINE_SOURCE_PATH),
  ]);
  const errors = validateAgentRuntimeReleaseContract({
    wranglerText,
    workflowText,
    engineSource: JSON.parse(engineSourceText) as unknown,
  });
  if (errors.length > 0) {
    console.error("Agent runtime release validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    runtime.exit(1);
  }
  console.log("Agent runtime release validation passed.");
}

if (import.meta.main) await main();
