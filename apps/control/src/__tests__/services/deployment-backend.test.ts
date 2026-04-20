import {
  createDeploymentBackend,
  createOciDeploymentBackend,
  createRuntimeHostDeploymentBackend,
  createWorkersDispatchDeploymentBackend,
  parseDeploymentBackendConfig,
  serializeDeploymentBackendTarget,
} from "@/services/deployment/backend";

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

Deno.test("deployment backend helpers - serializes and parses an OCI deployment target", () => {
  const serialized = serializeDeploymentBackendTarget({
    backend: { name: "oci" },
    target: {
      route_ref: "takos-worker",
      endpoint: {
        kind: "http-url",
        base_url: "https://worker.example.test",
      },
      artifact: {
        image_ref: "ghcr.io/takos/worker:latest",
        exposed_port: 8080,
        health_path: "/ready",
        health_interval: 15,
        health_timeout: 3,
        health_unhealthy_threshold: 2,
      },
    },
  });

  assertEquals(serialized.backendName, "oci");
  assertEquals(
    parseDeploymentBackendConfig({
      backend_name: "oci",
      target_json: serialized.targetJson,
    }),
    {
      route_ref: "takos-worker",
      endpoint: {
        kind: "http-url",
        base_url: "https://worker.example.test",
      },
      artifact: {
        image_ref: "ghcr.io/takos/worker:latest",
        exposed_port: 8080,
        health_path: "/ready",
        health_interval: 15,
        health_timeout: 3,
        health_unhealthy_threshold: 2,
      },
    },
  );
});
Deno.test("deployment backend helpers - returns a cloudflare default backend when config is absent", () => {
  assertEquals(serializeDeploymentBackendTarget(undefined), {
    backendName: "workers-dispatch",
    targetJson: "{}",
    backendStateJson: "{}",
  });
  assertEquals(
    parseDeploymentBackendConfig({
      backend_name: "workers-dispatch",
      target_json: "{}",
    }),
    {},
  );
});
Deno.test("deployment backend helpers - delegates cloudflare deploys to WFP", async () => {
  const wfp = {
    workers: {
      createWorker: spy(async () => undefined),
      createWorkerWithWasm: spy(async () => undefined),
      workerExists: spy(async () => true),
    },
  };
  const backend = createWorkersDispatchDeploymentBackend(wfp as never);

  await backend.deploy({
    deployment: {} as never,
    artifactRef: "artifact-ref",
    bundleContent: "export default {}",
    wasmContent: null,
    runtime: {
      profile: "workers",
      bindings: [],
      config: {
        compatibility_date: "2026-03-22",
        compatibility_flags: [],
      },
    },
  });

  const workerCall = (wfp.workers.createWorker as any).calls[0]
    .args[0] as Record<
      string,
      unknown
    >;
  assertEquals(workerCall.workerName, "artifact-ref");
  assertEquals(workerCall.workerScript, "export default {}");
  assertEquals(workerCall.bindings, []);
  assertEquals(workerCall.compatibility_date, "2026-03-22");
  assertEquals(workerCall.compatibility_flags, []);
  await assertEquals(
    await backend.assertRollbackTarget("artifact-ref"),
    undefined,
  );
});
Deno.test("deployment backend helpers - accepts runtime-host worker deploys without a remote backend call", async () => {
  const backend = createRuntimeHostDeploymentBackend();

  await assertEquals(
    await backend.deploy({
      deployment: {} as never,
      artifactRef: "artifact-ref",
      bundleContent: "export default {}",
      wasmContent: null,
      runtime: {
        profile: "workers",
        bindings: [],
        config: {
          compatibility_date: "2026-03-22",
          compatibility_flags: [],
        },
      },
    }),
    undefined,
  );

  await assertEquals(
    await backend.assertRollbackTarget("artifact-ref"),
    undefined,
  );
});
Deno.test("deployment backend helpers - resolves backend config from the attached registry before falling back to env config", async () => {
  const fetchImpl = spy(async () => new Response(null, { status: 202 }));
  const backend = createDeploymentBackend({
    backend_name: "oci",
    space_id: "space-1",
    target_json: JSON.stringify({
      route_ref: "takos-worker",
      artifact: {
        image_ref: "ghcr.io/takos/worker:latest",
      },
    }),
  }, {
    backendRegistry: {
      get(name) {
        if (name !== "oci") return undefined;
        return {
          name: "oci",
          config: {
            orchestratorUrl: "https://orchestrator.example.test",
            orchestratorToken: "registry-token",
          },
        };
      },
    },
    orchestratorUrl: "https://ignored.example.test/deploy",
    fetchImpl,
  });

  await assertEquals(
    await backend.deploy({
      deployment: { id: "dep-1", space_id: "space-1" } as never,
      artifactRef: "artifact-ref",
      bundleContent: "export default {}",
      wasmContent: null,
      runtime: {
        profile: "workers",
        bindings: [],
        config: {
          compatibility_date: "2026-03-22",
          compatibility_flags: [],
        },
      },
    }),
    undefined,
  );
  const registryCall = (fetchImpl as any).calls[0] as {
    args: [string, RequestInit];
  };
  assertEquals(
    registryCall.args[0],
    "https://orchestrator.example.test/deploy",
  );
  const init = registryCall.args[1];
  assertEquals(init.method, "POST");
  assertEquals(
    (init.headers as Record<string, string>).Authorization,
    "Bearer registry-token",
  );
  assertEquals(JSON.parse(String(init.body)), {
    deployment_id: "dep-1",
    space_id: "space-1",
    artifact_ref: "artifact-ref",
    target: {
      route_ref: "takos-worker",
      endpoint: {
        kind: "service-ref",
        ref: "takos-worker",
      },
      artifact: {
        image_ref: "ghcr.io/takos/worker:latest",
        health_path: "/health",
      },
    },
    runtime: {
      profile: "workers",
      compatibility_date: "2026-03-22",
      compatibility_flags: [],
      env_vars: {},
      limits: null,
    },
  });
});
const ociBackendCases: Array<[
  backendName: "ecs" | "cloud-run" | "k8s",
  orchestratorUrl: string,
  orchestratorToken: string,
  backendConfig: Record<string, unknown>,
]> = [
  [
    "ecs",
    "https://ecs-orchestrator.example.test",
    "ecs-token",
    {
      region: "us-east-1",
      clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/takos",
      taskDefinitionFamily: "takos-worker",
    },
  ],
  [
    "cloud-run",
    "https://cloud-run-orchestrator.example.test",
    "cloud-run-token",
    {
      projectId: "takos-project",
      region: "us-central1",
      serviceId: "takos-worker",
    },
  ],
  [
    "k8s",
    "https://k8s-orchestrator.example.test",
    "k8s-token",
    {
      namespace: "takos",
      deploymentName: "takos-worker",
    },
  ],
];

for (
  const [
    backendName,
    orchestratorUrl,
    orchestratorToken,
    backendConfig,
  ] of ociBackendCases
) {
  Deno.test(
    `treats ${backendName} as an OCI-backed deployment backend and forwards backend config`,
    async () => {
      const fetchImpl = spy(async () => new Response(null, { status: 202 }));
      const backend = createDeploymentBackend({
        backend_name: backendName,
        space_id: "space-1",
        target_json: JSON.stringify({
          route_ref: "takos-worker",
          endpoint: {
            kind: "service-ref",
            ref: "takos-worker",
          },
          artifact: {
            image_ref: "ghcr.io/takos/worker:latest",
            exposed_port: 8080,
            health_path: "/ready",
            health_interval: 15,
            health_timeout: 3,
            health_unhealthy_threshold: 2,
          },
        }),
      }, {
        backendRegistry: {
          get(name) {
            if (name !== backendName) return undefined;
            return {
              name: backendName,
              config: {
                orchestratorUrl,
                orchestratorToken,
                ...backendConfig,
              },
            };
          },
        },
        orchestratorUrl: "https://ignored.example.test",
        orchestratorToken: "ignored-token",
        fetchImpl,
      });

      await backend.deploy({
        deployment: { id: "dep-1", space_id: "space-1" } as never,
        artifactRef: "artifact-ref",
        bundleContent: "export default {}",
        wasmContent: null,
        runtime: {
          profile: "workers",
          bindings: [],
          config: {
            compatibility_date: "2026-03-22",
            compatibility_flags: ["nodejs_compat"],
          },
        },
      });

      const orchestratorCall = (fetchImpl as any).calls[0] as {
        args: [string, RequestInit];
      };
      assertEquals(orchestratorCall.args[0], `${orchestratorUrl}/deploy`);
      const init = orchestratorCall.args[1];
      assertEquals(init.method, "POST");
      assertEquals(
        (init.headers as Record<string, string>).Authorization,
        `Bearer ${orchestratorToken}`,
      );
      const body = JSON.parse(String(init.body));
      assertEquals(body, {
        deployment_id: "dep-1",
        space_id: "space-1",
        artifact_ref: "artifact-ref",
        backend: {
          name: backendName,
          config: backendConfig,
        },
        target: {
          route_ref: "takos-worker",
          endpoint: {
            kind: "service-ref",
            ref: "takos-worker",
          },
          artifact: {
            image_ref: "ghcr.io/takos/worker:latest",
            exposed_port: 8080,
            health_path: "/ready",
            health_interval: 15,
            health_timeout: 3,
            health_unhealthy_threshold: 2,
          },
        },
        runtime: {
          profile: "workers",
          compatibility_date: "2026-03-22",
          compatibility_flags: ["nodejs_compat"],
          env_vars: {},
          limits: null,
        },
      });
    },
  );
}

Deno.test("deployment backend helpers - validates OCI deployment target configuration", async () => {
  const backend = createOciDeploymentBackend({
    backend_name: "oci",
    space_id: "space-1",
    target_json: JSON.stringify({
      route_ref: "takos-worker",
      artifact: {
        exposed_port: 0,
      },
    }),
  });

  await assertRejects(async () => {
    await backend.deploy({
      deployment: {} as never,
      artifactRef: "artifact-ref",
      bundleContent: "export default {}",
      wasmContent: null,
      runtime: {
        profile: "workers",
        bindings: [],
        config: {
          compatibility_date: "2026-03-22",
          compatibility_flags: [],
        },
      },
    });
  }, "OCI deployment target exposed_port must be a positive integer");
});
Deno.test("deployment backend helpers - posts OCI image targets to the configured orchestrator endpoint", async () => {
  const fetchImpl = spy(async () => new Response(null, { status: 202 }));
  const backend = createOciDeploymentBackend({
    backend_name: "oci",
    space_id: "space-1",
    target_json: JSON.stringify({
      route_ref: "takos-worker",
      endpoint: {
        kind: "http-url",
        base_url: "https://worker.example.test",
      },
      artifact: {
        image_ref: "ghcr.io/takos/worker:latest",
        exposed_port: 8080,
        health_path: "/ready",
        health_interval: 15,
        health_timeout: 3,
        health_unhealthy_threshold: 2,
      },
    }),
  }, {
    orchestratorUrl: "https://orchestrator.example.test",
    orchestratorToken: "secret-token",
    fetchImpl,
  });

  await backend.deploy({
    deployment: { id: "dep-1", space_id: "space-1" } as never,
    artifactRef: "artifact-ref",
    bundleContent: "export default {}",
    wasmContent: null,
    runtime: {
      profile: "workers",
      bindings: [],
      config: {
        compatibility_date: "2026-03-22",
        compatibility_flags: ["nodejs_compat"],
        limits: { cpu_ms: 50 },
      },
    },
  });

  const ociCall = (fetchImpl as any).calls[0] as {
    args: [string, RequestInit];
  };
  assertEquals(ociCall.args[0], "https://orchestrator.example.test/deploy");
  const init = ociCall.args[1];
  assertEquals(init.method, "POST");
  assertEquals(
    (init.headers as Record<string, string>).Authorization,
    "Bearer secret-token",
  );
  const body = JSON.parse(String(init.body));
  assertEquals(body, {
    deployment_id: "dep-1",
    space_id: "space-1",
    artifact_ref: "artifact-ref",
    target: {
      route_ref: "takos-worker",
      endpoint: {
        kind: "http-url",
        base_url: "https://worker.example.test",
      },
      artifact: {
        image_ref: "ghcr.io/takos/worker:latest",
        exposed_port: 8080,
        health_path: "/ready",
        health_interval: 15,
        health_timeout: 3,
        health_unhealthy_threshold: 2,
      },
    },
    runtime: {
      profile: "workers",
      compatibility_date: "2026-03-22",
      compatibility_flags: ["nodejs_compat"],
      env_vars: {},
      limits: { cpu_ms: 50 },
    },
  });
});
Deno.test("deployment backend helpers - does not call the OCI orchestrator for routing-only public targets", async () => {
  const fetchImpl = spy(async () => new Response(null, { status: 202 }));
  const backend = createOciDeploymentBackend({
    backend_name: "oci",
    space_id: "space-1",
    target_json: JSON.stringify({
      endpoint: {
        kind: "http-url",
        base_url: "https://worker.example.test",
      },
    }),
  }, {
    orchestratorUrl: "https://orchestrator.example.test",
    fetchImpl,
  });

  await backend.deploy({
    deployment: { id: "dep-1" } as never,
    artifactRef: "artifact-ref",
    bundleContent: "export default {}",
    wasmContent: null,
    runtime: {
      profile: "workers",
      bindings: [],
      config: {
        compatibility_date: "2026-03-22",
        compatibility_flags: [],
      },
    },
  });

  assertSpyCalls(fetchImpl, 0);
});
Deno.test("deployment backend helpers - requires an orchestrator URL for OCI image deployments", async () => {
  const backend = createOciDeploymentBackend({
    backend_name: "oci",
    space_id: "space-1",
    target_json: JSON.stringify({
      route_ref: "takos-worker",
      endpoint: {
        kind: "service-ref",
        ref: "takos-worker",
      },
      artifact: {
        image_ref: "ghcr.io/takos/worker:latest",
      },
    }),
  });

  await assertRejects(async () => {
    await backend.deploy({
      deployment: { id: "dep-1", space_id: "space-1" } as never,
      artifactRef: "artifact-ref",
      bundleContent: "export default {}",
      wasmContent: null,
      runtime: {
        profile: "workers",
        bindings: [],
        config: {
          compatibility_date: "2026-03-22",
          compatibility_flags: [],
        },
      },
    });
  }, "OCI deployment target requires OCI_ORCHESTRATOR_URL");
});
