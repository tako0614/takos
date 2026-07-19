import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AGENT_ENGINE_SOURCE_PATH,
  RELEASE_TAG_TRUST_PATH,
  validateAgentRuntimeReleaseContract,
} from "../../validate-agent-runtime-release.ts";

const repoRoot = resolve(import.meta.dir, "../../..");

async function actualInputs() {
  const [wranglerText, workflowText, engineSourceText, tagTrustText] =
    await Promise.all([
      readFile(resolve(repoRoot, "deploy/cloudflare/wrangler.toml"), "utf8"),
      readFile(
        resolve(repoRoot, ".github/workflows/release-artifacts.yml"),
        "utf8",
      ),
      readFile(resolve(repoRoot, AGENT_ENGINE_SOURCE_PATH), "utf8"),
      readFile(resolve(repoRoot, RELEASE_TAG_TRUST_PATH), "utf8"),
    ]);
  return {
    wranglerText,
    workflowText,
    engineSource: JSON.parse(engineSourceText) as unknown,
    tagTrust: JSON.parse(tagTrustText) as unknown,
  };
}

test("agent runtime release config keeps pool, queues, workflow, and engine pin aligned", async () => {
  expect(validateAgentRuntimeReleaseContract(await actualInputs())).toEqual([]);
});

test("agent runtime release validator catches executor capacity drift", async () => {
  const input = await actualInputs();
  input.wranglerText = input.wranglerText.replace(
    "instance_type = { vcpu = 1, memory_mib = 12288, disk_mb = 4000 }\nmax_instances = 1",
    "instance_type = { vcpu = 1, memory_mib = 12288, disk_mb = 4000 }\nmax_instances = 2",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    "deploy/cloudflare/wrangler.toml production ExecutorContainerTier3 max_instances must be 1",
  );
});

test("agent runtime release validator requires the binding-only egress entrypoint", async () => {
  const input = await actualInputs();
  input.wranglerText = input.wranglerText.replace(
    'entrypoint = "TakosEgressEntrypoint"',
    'entrypoint = "WrongEntrypoint"',
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    "deploy/cloudflare/wrangler.toml production TAKOS_EGRESS entrypoint must be TakosEgressEntrypoint",
  );
});

test("agent runtime release validator rejects a mutable engine ref", async () => {
  const input = await actualInputs();
  input.engineSource = {
    schemaVersion: 1,
    repository: "tako0614/takos-agent-engine",
    commit: "main",
  };
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    "containers/agent/engine-source.json commit must be an immutable 40-character Git SHA",
  );
});

test("agent runtime release validator rejects a tag trust fingerprint drift", async () => {
  const input = await actualInputs();
  input.tagTrust = {
    ...(input.tagTrust as Record<string, unknown>),
    keyId: `SHA256:${"A".repeat(43)}`,
  };
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    "release/trust/takos-release-tag-signing-key.json keyId does not match publicKey",
  );
});

test("agent runtime release validator requires the pinned engine checkout", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "ref: ${{ needs.validate.outputs.agent_engine_commit }}",
    "ref: main",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must checkout takos-agent-engine at the validated immutable pin",
  );
});

test("agent runtime release validator requires a pinned-engine compile gate", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "bun run validate:agent-engine-source",
    "cargo check",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must compile the agent wrapper against the clean pinned engine checkout",
  );
});

test("agent runtime release validator ignores comments that mimic the pinned checkout", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "ref: ${{ needs.validate.outputs.agent_engine_commit }}",
    [
      "ref: main",
      "          # ref: ${{ needs.validate.outputs.agent_engine_commit }}",
    ].join("\n"),
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must checkout takos-agent-engine at the validated immutable pin",
  );
});

test("agent runtime release validator requires a verified signed annotated tag", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    ".verification.verified == true",
    ".verification.verified == false",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must verify a signed annotated tag bound to the source commit",
  );
});

test("agent runtime release validator requires the private-envelope digest set", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "process.env.ARTIFACT_DIGESTS_B64",
    "process.env.REMOVED_ARTIFACT_DIGESTS",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml promotion must reverify the candidate and exact private-envelope bindings",
  );
});

test("agent runtime release validator requires the controller candidate artifact name", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "takos-release-candidate-${{ needs.validate.outputs.release_version }}-${{ needs.validate.outputs.source_commit_short }}",
    "takos-release-candidate-${{ needs.validate.outputs.release_version }}-${{ github.sha }}",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must retain the sealed candidate under the controller's exact 12-character source-prefix name",
  );
});

test("agent runtime release validator requires promotion to use the same candidate name", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "takos-release-candidate-${{ inputs.version }}-${{ needs.validate.outputs.source_commit_short }}",
    "takos-release-candidate-${{ inputs.version }}-${{ inputs.source_commit }}",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml promotion must download the controller's exact 12-character source-prefix candidate name",
  );
});

test("agent runtime release validator forbids stable tags during candidate build", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "type=raw,value=candidate-${{ github.run_id }}-${{ github.run_attempt }}",
    "type=raw,value=${{ inputs.version }}",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml candidate builds must publish only the unique run-attempt image tag",
  );
});

test("agent runtime release validator binds manifest tags to the candidate run", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    '            --candidate-run-id "${GITHUB_RUN_ID}" \\\n',
    "",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml release manifest must validate candidate-only image tags against the exact workflow run",
  );
});

test("agent runtime release validator forbids build actions in promotion", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "      - name: Login to GHCR for digest-only promotion",
    "      - uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf\n      - name: Login to GHCR for digest-only promotion",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml promotion must use sealed controller authorization without a protected environment or rebuilding",
  );
});

test("agent runtime release validator forbids protected promotion environments", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "    permissions:\n      actions: read\n      contents: write\n      packages: write",
    "    environment: production\n    permissions:\n      actions: read\n      contents: write\n      packages: write",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml promotion must use sealed controller authorization without a protected environment or rebuilding",
  );
});

test("agent runtime release validator derives OCI digest refs from the fixed controller schema", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    ".ociImages[] | [.versionRef, .digest] | @tsv",
    ".ociImages[] | [.versionRef, .digest, .digestRef] | @tsv",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must promote and read back exact OCI content digests",
  );
});

test("agent runtime release validator reads release assets from the fixed controller schema", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    ".releaseAssets[] | [.name, .digest] | @tsv",
    ".releaseAssets[] | [.name, .path, .digest] | @tsv",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must emit and independently read back the fixed-adapter result",
  );
});

test("agent runtime release validator rejects clobber publication", async () => {
  const input = await actualInputs();
  input.workflowText += "\n# forbidden mutation: --clobber\n";
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must create a new stable release from exact bytes without clobber",
  );
});

test("agent runtime release validator rejects a second Cloudflare runtime build", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "            cloudflare_container: true\n    steps:",
    [
      "            cloudflare_container: true",
      "            cloudflare_build_path: containers/runtime",
      "    steps:",
    ].join("\n"),
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must promote the attested takos-worker-runtime digest instead of rebuilding it for Cloudflare",
  );
});

test("local release gate reports clean source readiness instead of permissive artifact completeness", async () => {
  const releaseGateText = await readFile(
    resolve(repoRoot, "scripts/release-gate.ts"),
    "utf8",
  );
  expect(releaseGateText).toContain("release-manifest-source-readiness");
  expect(releaseGateText).toContain("release-manifest:check-clean");
  expect(releaseGateText).toContain(
    "published image digests and Cloudflare Container refs are enforced by release-artifacts CI",
  );
});
