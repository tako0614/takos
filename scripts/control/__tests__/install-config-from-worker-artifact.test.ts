import { expect, test } from "bun:test";

import {
  installConfigFromWorkerArtifact,
  parseArgs,
} from "../install-config-from-worker-artifact.mjs";

const artifact = {
  kind: "takosumi.worker-artifact@v1",
  app: "takos",
  releaseTag: "v0.10.34",
  artifact: {
    url: "https://github.com/tako0614/takos/releases/download/v0.10.34/takos-worker-release.tar.gz",
    sha256: "b".repeat(64),
  },
  containerImages: {
    runtime: "registry.cloudflare.com/account/takos-worker-runtime:v0.10.34",
    executor: "registry.cloudflare.com/account/takos-agent:v0.10.34",
  },
};

test("builds a complete first-party service-side InstallConfig patch", () => {
  const patch = installConfigFromWorkerArtifact(artifact, {
    environment: "production",
    executor: "operator",
    rollout: "immediate",
  });

  expect(patch.kind).toBe("takosumi.install-config-patch@v1");
  expect(patch.variableMapping).toEqual({ target: "cloudflare" });
  expect(
    patch.variablePresentation.find(
      (input) => input.name === "public_subdomain",
    ),
  ).toEqual(
    expect.objectContaining({
      required: true,
      defaultValue: { source: "capsule_name" },
    }),
  );
  expect(patch.outputAllowlist.launch_url).toEqual({
    from: "launch_url",
    type: "url",
    required: true,
  });
  expect(Object.keys(patch.outputAllowlist).sort()).toEqual(
    [
      "cloudflare_account_id",
      "executor_capacity",
      "key_value_stores",
      "launch_url",
      "object_buckets",
      "queues",
      "service_runtime_name",
      "sql_databases",
      "vector_indexes",
      "worker_env",
    ].sort(),
  );
  expect(patch.interfaceBlueprints).toEqual([
    expect.objectContaining({
      key: "takos.launcher",
      spec: expect.objectContaining({
        type: "interface.ui.surface",
        version: "1",
        inputs: {
          url: { source: "capsule_output", outputName: "launch_url" },
        },
      }),
      bindings: [
        expect.objectContaining({
          permissions: ["ui.open"],
          delivery: { type: "none" },
        }),
      ],
    }),
  ]);
  expect(patch.lifecycleActions).toHaveLength(2);
  expect(patch.lifecycleActionPolicy).toEqual({
    allowedExecutors: ["operator"],
    allowedRunnerCapabilities: ["capsule.lifecycle.command.v1"],
  });
  expect(JSON.stringify(patch)).not.toContain("takosumi_release");
  expect(JSON.stringify(patch)).not.toContain("app_deployment");
  expect(JSON.stringify(patch)).not.toContain("service_exports");
});

test("parses first-party InstallConfig generation options", () => {
  expect(
    parseArgs([
      "takosumi-artifact.json",
      "--output",
      "install-config-patch.json",
      "--environment",
      "staging",
      "--executor",
      "runner",
      "--rollout",
      "none",
    ]),
  ).toEqual({
    manifestPath: "takosumi-artifact.json",
    output: "install-config-patch.json",
    environment: "staging",
    executor: "runner",
    rollout: "none",
  });
});
