#!/usr/bin/env -S bun
import { createHash } from "node:crypto";
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
export const RELEASE_TAG_TRUST_PATH =
  "release/trust/takos-release-tag-signing-key.json";
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
  tagTrust: unknown;
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

export function validateReleaseTagTrust(value: unknown): string[] {
  const record = asRecord(value);
  if (!record) return [`${RELEASE_TAG_TRUST_PATH} must be a JSON object`];
  const errors: string[] = [];
  const exactKeys = new Set([
    "kind",
    "keyId",
    "algorithm",
    "principal",
    "publicKey",
    "githubAccount",
    "usage",
    "createdAt",
  ]);
  for (const key of Object.keys(record)) {
    if (!exactKeys.has(key)) {
      errors.push(
        `${RELEASE_TAG_TRUST_PATH} contains unsupported field ${key}`,
      );
    }
  }
  if (record.kind !== "takos.release-tag-signing-key@v1") {
    errors.push(`${RELEASE_TAG_TRUST_PATH} kind is invalid`);
  }
  if (record.algorithm !== "ssh-ed25519") {
    errors.push(`${RELEASE_TAG_TRUST_PATH} algorithm must be ssh-ed25519`);
  }
  if (record.githubAccount !== "tako0614") {
    errors.push(`${RELEASE_TAG_TRUST_PATH} githubAccount must be tako0614`);
  }
  if (
    typeof record.principal !== "string" ||
    !/^[^\s@]+@[^\s@]+$/u.test(record.principal)
  ) {
    errors.push(
      `${RELEASE_TAG_TRUST_PATH} principal must be an email identity`,
    );
  }
  if (
    !Array.isArray(record.usage) ||
    record.usage.length !== 1 ||
    record.usage[0] !== "git-tag-signing"
  ) {
    errors.push(`${RELEASE_TAG_TRUST_PATH} usage must be git-tag-signing only`);
  }
  if (
    typeof record.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(record.createdAt)
  ) {
    errors.push(
      `${RELEASE_TAG_TRUST_PATH} createdAt must be an exact UTC timestamp`,
    );
  }
  if (
    typeof record.publicKey !== "string" ||
    !/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: [^\r\n]+)?$/u.test(record.publicKey)
  ) {
    errors.push(
      `${RELEASE_TAG_TRUST_PATH} publicKey must be one SSH Ed25519 key`,
    );
  } else {
    const encoded = record.publicKey.split(" ")[1];
    const fingerprint = createHash("sha256")
      .update(Buffer.from(encoded, "base64"))
      .digest("base64")
      .replace(/=+$/u, "");
    if (record.keyId !== `SHA256:${fingerprint}`) {
      errors.push(`${RELEASE_TAG_TRUST_PATH} keyId does not match publicKey`);
    }
  }
  return errors;
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
  errors.push(...validateReleaseTagTrust(input.tagTrust));
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
    allSteps.some((step) =>
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
    sourceEnv?.REQUESTED_VERSION !== "${{ inputs.version }}" ||
    sourceEnv?.RELEASE_PHASE !== "${{ inputs.phase }}" ||
    !sourceRun.includes('"${REQUESTED_VERSION}" != "${release_version}"') ||
    !sourceRun.includes('"${GITHUB_RUN_ATTEMPT}" != "1"') ||
    !sourceRun.includes('source_commit_short="${source_commit:0:12}"') ||
    asRecord(validateJob?.outputs)?.source_commit_short !==
      "${{ steps.source.outputs.source_commit_short }}"
  ) {
    errors.push(
      `${WORKFLOW_PATH} must treat workflow version as an assertion, forbid rerun mutation, and expose the exact 12-character source prefix`,
    );
  }
  const workflowEnv = asRecord(workflow.env);
  const bunSetupSteps = allSteps.filter((step) =>
    stringValue(step.uses).includes("oven-sh/setup-bun@"),
  );
  const nodeSetupSteps = allSteps.filter((step) =>
    stringValue(step.uses).includes("actions/setup-node@"),
  );
  const buildxSetupSteps = allSteps.filter((step) =>
    stringValue(step.uses).includes("docker/setup-buildx-action@"),
  );
  if (
    workflowEnv?.RELEASE_BUN_VERSION !== "1.3.14" ||
    workflowEnv?.RELEASE_NODE_VERSION !== "24.18.0" ||
    workflowEnv?.RELEASE_BUILDX_VERSION !== "v0.35.0" ||
    workflowEnv?.RELEASE_RUNNER_IMAGE !== "ubuntu-24.04" ||
    (jobs &&
      Object.values(jobs).some(
        (job) => asRecord(job)?.["runs-on"] !== "ubuntu-24.04",
      )) ||
    bunSetupSteps.length === 0 ||
    bunSetupSteps.some(
      (step) =>
        asRecord(step.with)?.["bun-version"] !==
        "${{ env.RELEASE_BUN_VERSION }}",
    ) ||
    nodeSetupSteps.length === 0 ||
    nodeSetupSteps.some(
      (step) =>
        asRecord(step.with)?.["node-version"] !==
        "${{ env.RELEASE_NODE_VERSION }}",
    ) ||
    buildxSetupSteps.length === 0 ||
    buildxSetupSteps.some(
      (step) =>
        asRecord(step.with)?.version !== "${{ env.RELEASE_BUILDX_VERSION }}",
    )
  ) {
    errors.push(
      `${WORKFLOW_PATH} must pin the release Bun, Node, Buildx, and runner toolchain`,
    );
  }
  if (
    typeof workflowEnv?.TAKOSUMI_SOURCE_REF !== "string" ||
    !/^[0-9a-f]{40}$/u.test(workflowEnv.TAKOSUMI_SOURCE_REF)
  ) {
    errors.push(
      `${WORKFLOW_PATH} must pin Takosumi to an immutable full Git SHA`,
    );
  }
  if (
    typeof workflowEnv?.RELEASE_SAFETY_CONTROLLER_COMMIT !== "string" ||
    !/^[0-9a-f]{40}$/u.test(workflowEnv.RELEASE_SAFETY_CONTROLLER_COMMIT) ||
    typeof workflowEnv?.RELEASE_SAFETY_ADAPTER_DIGEST !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(workflowEnv.RELEASE_SAFETY_ADAPTER_DIGEST)
  ) {
    errors.push(
      `${WORKFLOW_PATH} must pin the release-safety controller and fixed adapter`,
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
  const imageMetadataStep = ociSteps.find(
    (step) => step.name === "Extract image metadata",
  );
  if (
    stringValue(asRecord(imageMetadataStep?.with)?.tags).trim() !==
    "type=raw,value=candidate-${{ github.run_id }}-${{ github.run_attempt }}"
  ) {
    errors.push(
      `${WORKFLOW_PATH} candidate builds must publish only the unique run-attempt image tag`,
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

  const candidateJob = asRecord(jobs?.["release-candidate"]);
  const candidateSteps = workflowSteps(candidateJob);
  const buildManifestStep = candidateSteps.find(
    (step) => step.name === "Build release manifest",
  );
  if (
    !shellCode(buildManifestStep?.run).includes(
      '--candidate-run-id "${GITHUB_RUN_ID}"',
    )
  ) {
    errors.push(
      `${WORKFLOW_PATH} release manifest must validate candidate-only image tags against the exact workflow run`,
    );
  }
  const sealStep = candidateSteps.find(
    (step) => step.name === "Seal candidate manifest and exact release bytes",
  );
  if (
    !shellCode(sealStep?.run).includes(
      "scripts/release-candidate-contract.ts build",
    ) ||
    !shellCode(sealStep?.run).includes("--candidate-run-id")
  ) {
    errors.push(
      `${WORKFLOW_PATH} must seal one candidate manifest from the build run`,
    );
  }
  const candidateUpload = candidateSteps.find(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.includes("actions/upload-artifact@"),
  );
  if (
    stringValue(asRecord(candidateUpload?.with)?.name) !==
    "takos-release-candidate-${{ needs.validate.outputs.release_version }}-${{ needs.validate.outputs.source_commit_short }}"
  ) {
    errors.push(
      `${WORKFLOW_PATH} must retain the sealed candidate under the controller's exact 12-character source-prefix name`,
    );
  }

  const promoteJob = asRecord(jobs?.promote);
  const promoteSteps = workflowSteps(promoteJob);
  const candidateDownload = promoteSteps.find(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.includes("actions/download-artifact@"),
  );
  if (
    stringValue(asRecord(candidateDownload?.with)?.name) !==
    "takos-release-candidate-${{ inputs.version }}-${{ needs.validate.outputs.source_commit_short }}"
  ) {
    errors.push(
      `${WORKFLOW_PATH} promotion must download the controller's exact 12-character source-prefix candidate name`,
    );
  }
  if (
    promoteJob?.environment !== undefined ||
    promoteSteps.some(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.includes("docker/build-push-action@"),
    )
  ) {
    errors.push(
      `${WORKFLOW_PATH} promotion must use sealed controller authorization without a protected environment or rebuilding`,
    );
  }
  const verifyCandidateStep = promoteSteps.find(
    (step) => step.name === "Verify envelope bindings and every candidate byte",
  );
  const verifyCandidateRun = shellCode(verifyCandidateStep?.run);
  if (
    !verifyCandidateRun.includes(
      "scripts/release-candidate-contract.ts verify",
    ) ||
    !verifyCandidateRun.includes("CANDIDATE_MANIFEST_DIGEST") ||
    !verifyCandidateRun.includes("ARTIFACT_DIGESTS_B64") ||
    !verifyCandidateRun.includes("HEALTH_CHECKS_B64")
  ) {
    errors.push(
      `${WORKFLOW_PATH} promotion must reverify the candidate and exact private-envelope bindings`,
    );
  }
  const signedTagStep = promoteSteps.find(
    (step) => step.name === "Verify signed annotated release tag",
  );
  const signedTagRun = shellCode(signedTagStep?.run);
  if (
    !signedTagRun.includes('.object.type == "tag"') ||
    !signedTagRun.includes(".verification.verified == true") ||
    !signedTagRun.includes(".object.sha == $source") ||
    !signedTagRun.includes(RELEASE_TAG_TRUST_PATH) ||
    !signedTagRun.includes("gpg.ssh.allowedSignersFile") ||
    !signedTagRun.includes('verify-tag "${RELEASE_TAG}"')
  ) {
    errors.push(
      `${WORKFLOW_PATH} must verify a signed annotated tag bound to the source commit`,
    );
  }
  const promoteOciStep = promoteSteps.find(
    (step) =>
      step.name === "Promote versioned OCI tags from exact content digests",
  );
  const promoteOciRun = shellCode(promoteOciStep?.run);
  if (
    !promoteOciRun.includes("docker buildx imagetools create") ||
    !promoteOciRun.includes('"${digest_ref}"') ||
    !promoteOciRun.includes('image="${version_ref%:*}"') ||
    !promoteOciRun.includes('digest_ref="${image}@${digest}"') ||
    promoteOciRun.includes(".digestRef") ||
    !promoteOciRun.includes(
      'docker buildx imagetools inspect "${version_ref}"',
    ) ||
    !promoteOciRun.includes("sed -n 's/^Digest:") ||
    promoteOciRun.includes("--raw")
  ) {
    errors.push(
      `${WORKFLOW_PATH} must promote and read back exact OCI content digests`,
    );
  }
  const latestReadbackStep = promoteSteps.find(
    (step) =>
      step.name === "Advance latest OCI tags and read back all stable digests",
  );
  const latestReadbackRun = shellCode(latestReadbackStep?.run);
  if (
    !latestReadbackRun.includes("docker buildx imagetools create") ||
    !latestReadbackRun.includes('"${version_ref}" "${latest_ref}"') ||
    !latestReadbackRun.includes('image="${version_ref%:*}"') ||
    !latestReadbackRun.includes('digest_ref="${image}@${digest}"') ||
    latestReadbackRun.includes(".digestRef") ||
    !latestReadbackRun.includes(
      'docker buildx imagetools inspect "${promoted_ref}"',
    ) ||
    !latestReadbackRun.includes("sed -n 's/^Digest:") ||
    latestReadbackRun.includes("--raw")
  ) {
    errors.push(
      `${WORKFLOW_PATH} must advance latest only after release creation and read back every stable OCI tag`,
    );
  }
  const publishStep = promoteSteps.find(
    (step) =>
      step.name === "Create draft GitHub release with exact candidate bytes",
  );
  const publishRun = shellCode(publishStep?.run);
  const publishAssets = [
    "release-manifest.json",
    "install-config-patch.json",
    "takos-worker-release.tar.gz",
    "takos-worker-release.tar.gz.sha256",
    "takosumi-artifact.json",
  ];
  if (
    !publishRun.includes("gh release create") ||
    !publishRun.includes("--verify-tag") ||
    !publishRun.includes("--draft") ||
    publishRun.includes("--latest") ||
    publishStep?.["working-directory"] !== "takos" ||
    publishAssets.some(
      (asset) => !publishRun.includes(`../candidate/assets/${asset}`),
    ) ||
    text.includes("--clobber")
  ) {
    errors.push(
      `${WORKFLOW_PATH} must create a new draft release from the checked-out Takos repository and exact candidate bytes without clobber`,
    );
  }
  if (
    !latestReadbackStep ||
    !publishStep ||
    promoteSteps.indexOf(latestReadbackStep) <=
      promoteSteps.indexOf(publishStep)
  ) {
    errors.push(
      `${WORKFLOW_PATH} must advance latest only after the stable release is created`,
    );
  }
  const preflightStep = promoteSteps.find(
    (step) => step.name === "Preflight immutable stable targets",
  );
  const preflightRun = shellCode(preflightStep?.run);
  if (
    !preflightRun.includes("immutable-releases") ||
    !preflightRun.includes(".enabled == true") ||
    !preflightRun.includes("already exists") ||
    !preflightRun.includes("TARGET_FINGERPRINT") ||
    !preflightRun.includes('.versionRef | sub(":" + $version + "$"; "")') ||
    preflightRun.includes(".image, .digest")
  ) {
    errors.push(
      `${WORKFLOW_PATH} must fail closed on reused versions and bind the stable target fingerprint`,
    );
  }
  const readbackStep = promoteSteps.find(
    (step) =>
      step.name === "Read back stable authority and write adapter result",
  );
  const readbackRun = shellCode(readbackStep?.run);
  if (
    !readbackRun.includes("takos.release-safety-adapter-result@v1") ||
    !readbackRun.includes("release-safety-readback.json") ||
    !readbackRun.includes("gh release upload") ||
    !readbackRun.includes(
      'gh release edit "${RELEASE_TAG}" --draft=false --latest',
    ) ||
    !readbackRun.includes(".isImmutable == true") ||
    !readbackRun.includes('gh release verify "${RELEASE_TAG}"') ||
    !readbackRun.includes("immutable_verified") ||
    !readbackRun.includes("expected_final_assets") ||
    !readbackRun.includes('gh release download "${RELEASE_TAG}"') ||
    !readbackRun.includes(".releaseAssets[] | [.name, .digest]") ||
    readbackRun.includes(".name, .path, .digest")
  ) {
    errors.push(
      `${WORKFLOW_PATH} must emit and independently read back the fixed-adapter result`,
    );
  }
  if (
    !publishStep ||
    !latestReadbackStep ||
    !readbackStep ||
    promoteSteps.indexOf(publishStep) >=
      promoteSteps.indexOf(latestReadbackStep) ||
    promoteSteps.indexOf(latestReadbackStep) >=
      promoteSteps.indexOf(readbackStep)
  ) {
    errors.push(
      `${WORKFLOW_PATH} must create the draft before latest OCI promotion and seal it immutable only after final readback`,
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
  const [wranglerText, workflowText, engineSourceText, tagTrustText] =
    await Promise.all([
      runtime.readTextFile(WRANGLER_PATH),
      runtime.readTextFile(WORKFLOW_PATH),
      runtime.readTextFile(AGENT_ENGINE_SOURCE_PATH),
      runtime.readTextFile(RELEASE_TAG_TRUST_PATH),
    ]);
  const errors = validateAgentRuntimeReleaseContract({
    wranglerText,
    workflowText,
    engineSource: JSON.parse(engineSourceText) as unknown,
    tagTrust: JSON.parse(tagTrustText) as unknown,
  });
  if (errors.length > 0) {
    console.error("Agent runtime release validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    runtime.exit(1);
  }
  console.log("Agent runtime release validation passed.");
}

if (import.meta.main) await main();
