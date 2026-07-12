import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AGENT_ENGINE_SOURCE_PATH,
  validateAgentRuntimeReleaseContract,
} from "../../validate-agent-runtime-release.ts";

const repoRoot = resolve(import.meta.dir, "../../..");

async function actualInputs() {
  const [wranglerText, workflowText, engineSourceText] = await Promise.all([
    readFile(resolve(repoRoot, "deploy/cloudflare/wrangler.toml"), "utf8"),
    readFile(
      resolve(repoRoot, ".github/workflows/release-artifacts.yml"),
      "utf8",
    ),
    readFile(resolve(repoRoot, AGENT_ENGINE_SOURCE_PATH), "utf8"),
  ]);
  return {
    wranglerText,
    workflowText,
    engineSource: JSON.parse(engineSourceText) as unknown,
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

test("agent runtime release validator requires publish-time tag identity guards", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    "              --verify-tag \\",
    "              # --verify-tag",
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must require an existing Git tag when creating a release",
  );
});

test("agent runtime release validator ignores commented-out tag identity checks", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    '          remote_tag_lines="$(git ls-remote --tags origin "refs/tags/${release_tag}" "refs/tags/${release_tag}^{}")"',
    '          # remote_tag_lines="$(git ls-remote --tags origin "refs/tags/${release_tag}" "refs/tags/${release_tag}^{}")"',
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml validate job must resolve an existing release tag before publishing",
  );
});

test("agent runtime release validator requires the manual publish path to verify the tag", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    '"${REQUESTED_PUBLISH}" == "true"',
    '"${REQUESTED_PUBLISH}" == "never"',
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml validate job must resolve an existing release tag before publishing",
  );
});

test("agent runtime release validator requires existing asset commit checks", async () => {
  const input = await actualInputs();
  input.workflowText = input.workflowText.replace(
    '              if [[ "${existing_commit}" != "${GITHUB_SHA}" ]]; then',
    '              if [[ -z "${existing_commit}" ]]; then',
  );
  expect(validateAgentRuntimeReleaseContract(input)).toContain(
    ".github/workflows/release-artifacts.yml must refuse to clobber release assets from another commit",
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
