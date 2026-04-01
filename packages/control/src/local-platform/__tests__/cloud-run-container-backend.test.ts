import { CloudRunContainerBackend } from "../cloud-run-container-backend.ts";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCallArgs, spy } from "jsr:@std/testing/mock";

Deno.test("CloudRunContainerBackend - deploys a service, returns the service URL, reads logs, and deletes the service", async () => {
  let callIndex = 0;
  const responses = [
    {
      exitCode: 0,
      stdout: JSON.stringify({
        status: {
          url: "https://takos-worker-uc.a.run.app",
        },
      }),
      stderr: "",
    },
    {
      exitCode: 0,
      stdout: "line-1\nline-2\n",
      stderr: "",
    },
    {
      exitCode: 0,
      stdout: "",
      stderr: "",
    },
  ];
  const commandRunner = spy(async () => responses[callIndex++]!);

  const backend = new CloudRunContainerBackend({
    projectId: "takos-project",
    region: "us-central1",
    serviceAccount: "takos-runtime@takos-project.iam.gserviceaccount.com",
    ingress: "internal-and-cloud-load-balancing",
    allowUnauthenticated: false,
    commandRunner,
  });

  const result = await backend.createAndStart({
    imageRef: "us-central1-docker.pkg.dev/takos-project/services/web:latest",
    name: "Takos_Service",
    exposedPort: 8080,
    healthPath: "/readyz",
    envVars: {
      NODE_ENV: "production",
    },
  });

  assertEquals(result, {
    containerId: "takos-service",
    resolvedEndpoint: {
      kind: "http-url",
      base_url: "https://takos-worker-uc.a.run.app",
    },
    healthCheckUrl: "https://takos-worker-uc.a.run.app/readyz",
  });

  await assertEquals(
    await backend.getLogs("takos-service", 25),
    "line-1\nline-2\n",
  );
  await assertEquals(await backend.remove("takos-service"), undefined);

  const deployArgs = commandRunner.calls[0]!.args as unknown as [string, string[]];
  assertEquals(deployArgs[0], "gcloud");
  assertEquals(deployArgs[1].slice(0, 7), [
    "run",
    "deploy",
    "takos-service",
    "--image",
    "us-central1-docker.pkg.dev/takos-project/services/web:latest",
    "--region",
    "us-central1",
  ]);
  assertEquals(deployArgs[1].includes("--service-account"), true);
  assertEquals(deployArgs[1].includes("--ingress"), true);
  assertEquals(deployArgs[1].includes("--no-allow-unauthenticated"), true);
  assertEquals(deployArgs[1].includes("--project"), true);
  const logArgs = commandRunner.calls[1]!.args as unknown as [string, string[]];
  assertEquals(logArgs[0], "gcloud");
  assertEquals(logArgs[1].slice(0, 3), [
    "logging",
    "read",
    'resource.type="cloud_run_revision" AND resource.labels.service_name="takos-service"',
  ]);
  assertEquals(logArgs[1].includes("--project"), true);
  assertSpyCallArgs(commandRunner, 2, ["gcloud", [
    "run",
    "services",
    "delete",
    "takos-service",
    "--region",
    "us-central1",
    "--quiet",
    "--project",
    "takos-project",
  ]]);
});
