import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  type CandidateManifest,
  verifyCandidateManifest,
} from "./release-candidate-contract.ts";
import { main as activateRelease } from "./control/takosumi-release.mjs";

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const RUN_ID_RE = /^\d+$/;

type ActivationResult = Awaited<ReturnType<typeof activateRelease>>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  invariant(value, `${name} is required`);
  return value;
}

function gitValue(directory: string, args: string[]): string {
  const result = spawnSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  });
  invariant(result.status === 0, `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function metadata(candidateDir: string, name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(candidateDir, "evidence", "image-digests", `${name}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

export function buildStagingActivationEnv(input: {
  candidateDir: string;
  manifest: CandidateManifest;
  baseEnv?: Record<string, string | undefined>;
}): Record<string, string | undefined> {
  const candidateDir = resolve(input.candidateDir);
  const archive = input.manifest.releaseAssets.find(
    (asset) => asset.name === "takos-worker-release.tar.gz",
  );
  invariant(archive, "candidate Worker archive is missing");
  const runtime = metadata(candidateDir, "takos-worker-runtime");
  const executor = metadata(candidateDir, "takos-agent");
  invariant(
    typeof runtime.cloudflareRegistryRef === "string",
    "candidate runtime Cloudflare registry ref is missing",
  );
  invariant(
    typeof executor.cloudflareRegistryRef === "string",
    "candidate executor Cloudflare registry ref is missing",
  );
  return {
    ...input.baseEnv,
    TAKOS_RELEASE_WORKER_ARTIFACT_URL: undefined,
    TAKOS_RELEASE_WORKER_ARTIFACT_FILE: join(
      candidateDir,
      "assets",
      archive.name,
    ),
    TAKOS_RELEASE_WORKER_ARTIFACT_SHA256: archive.digest.slice(
      "sha256:".length,
    ),
    TAKOS_RELEASE_CONTAINER_IMAGES_JSON: JSON.stringify({
      runtime: runtime.cloudflareRegistryRef,
      executor: executor.cloudflareRegistryRef,
    }),
    TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES: "true",
    TAKOS_RELEASE_REQUIRE_WRANGLER_DEPLOYMENT_STATUS: "true",
  };
}

function digestJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function buildStagingEvidence(input: {
  releaseId: string;
  controllerCommit: string;
  manifest: CandidateManifest;
  manifestDigest: string;
  activation: ActivationResult;
  verifiedAt?: string;
}) {
  const { activation } = input;
  invariant(activation.status === "succeeded", "staging activation failed");
  invariant(
    activation.workerArtifact?.sha256 &&
      `sha256:${activation.workerArtifact.sha256}` ===
        input.manifest.releaseAssets.find(
          (asset) => asset.name === "takos-worker-release.tar.gz",
        )?.digest,
    "activated Worker archive digest drifted",
  );
  invariant(
    activation.activation.deployment?.skipped === false,
    "persistent staging deployment readback was skipped",
  );
  invariant(
    activation.activation.containers?.skipped === false &&
      activation.activation.containers.containers.length === 4,
    "persistent staging container readback was skipped or incomplete",
  );
  invariant(
    activation.activation.workerContent?.skipped !== true &&
      SHA256_RE.test(`sha256:${activation.activation.workerContent?.sha256}`),
    "persistent staging Worker content readback was skipped",
  );
  invariant(
    activation.activation.health?.skipped === false &&
      activation.activation.health.status >= 200 &&
      activation.activation.health.status < 300,
    "persistent staging health verification was skipped or failed",
  );
  const activationBinding = digestJson(activation);
  return {
    kind: "takos.release-staging-qualification@v1",
    status: "verified",
    releaseId: input.releaseId,
    environment: "staging",
    sourceCommit: input.manifest.sourceCommit,
    controllerCommit: input.controllerCommit,
    candidateRunId: input.manifest.workflowRunId,
    candidateManifestDigest: input.manifestDigest,
    artifactDigests: input.manifest.artifactDigests,
    activation,
    checks: [
      {
        name: "sealed candidate manifest and source",
        status: "passed",
        bindingDigest: input.manifestDigest,
      },
      {
        name: "exact Worker archive and OCI activation",
        status: "passed",
        bindingDigest: activationBinding,
      },
      {
        name: "persistent staging readback and health",
        status: "passed",
        bindingDigest: digestJson({
          workerContent: activation.activation.workerContent,
          health: activation.activation.health,
        }),
      },
    ],
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
  } as const;
}

export async function runStagingQualification(input: {
  releaseId: string;
  candidateDir: string;
  sourceDir: string;
  sourceCommit: string;
  version: string;
  candidateRunId: string;
  candidateManifestDigest: string;
  output: string;
  env?: Record<string, string | undefined>;
}) {
  invariant(COMMIT_RE.test(input.sourceCommit), "source commit is invalid");
  invariant(
    RUN_ID_RE.test(input.candidateRunId),
    "candidate run id is invalid",
  );
  invariant(
    SHA256_RE.test(input.candidateManifestDigest),
    "candidate manifest digest is invalid",
  );
  const sourceDir = resolve(input.sourceDir);
  invariant(
    gitValue(sourceDir, ["rev-parse", "HEAD"]) === input.sourceCommit,
    "candidate source checkout drifted",
  );
  invariant(
    gitValue(sourceDir, ["status", "--porcelain"]) === "",
    "candidate source checkout must be clean",
  );
  const workflow = readFileSync(
    join(sourceDir, ".github", "workflows", "release-artifacts.yml"),
    "utf8",
  );
  const takosumiSourceCommit = workflow.match(
    /^\s*TAKOSUMI_SOURCE_REF:\s*([0-9a-f]{40})\s*$/mu,
  )?.[1];
  invariant(takosumiSourceCommit, "candidate Takosumi source ref is missing");
  const candidateDir = resolve(input.candidateDir);
  const manifest = verifyCandidateManifest({
    candidateDir,
    repository: "https://github.com/tako0614/takos.git",
    sourceCommit: input.sourceCommit,
    version: input.version,
    takosumiSourceCommit,
    candidateRunId: input.candidateRunId,
    expectedManifestDigest: input.candidateManifestDigest,
    policyPath: join(
      sourceDir,
      ".github",
      "workflows",
      "release-artifacts.yml",
    ),
    toolchainPath: join(sourceDir, "bun.lock"),
  });
  const controllerDir = resolve(import.meta.dir, "..");
  const controllerCommit = gitValue(controllerDir, ["rev-parse", "HEAD"]);
  const previousCwd = process.cwd();
  let activation: ActivationResult;
  try {
    process.chdir(sourceDir);
    activation = await activateRelease(
      ["staging"],
      buildStagingActivationEnv({
        candidateDir,
        manifest,
        baseEnv: input.env ?? process.env,
      }),
    );
  } finally {
    process.chdir(previousCwd);
  }
  const evidence = buildStagingEvidence({
    releaseId: input.releaseId,
    controllerCommit,
    manifest,
    manifestDigest: input.candidateManifestDigest,
    activation,
  });
  const output = resolve(input.output);
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  chmodSync(dirname(output), 0o700);
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(output, 0o600);
  return evidence;
}

if (import.meta.main) {
  const evidence = await runStagingQualification({
    releaseId: requiredArgument("--release-id"),
    candidateDir: requiredArgument("--candidate-dir"),
    sourceDir: requiredArgument("--source-dir"),
    sourceCommit: requiredArgument("--source-commit"),
    version: requiredArgument("--version"),
    candidateRunId: requiredArgument("--candidate-run-id"),
    candidateManifestDigest: requiredArgument("--candidate-manifest-digest"),
    output: requiredArgument("--output"),
  });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
