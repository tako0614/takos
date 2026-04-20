import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { spy } from "jsr:@std/testing/mock";

import {
  createDeploymentBackend,
  createOciDeploymentBackend,
} from "../backend.ts";
import type { Deployment } from "../models.ts";

Deno.test("OCI deployment backend forwards runtime env vars and cleans up deployed artifacts", async () => {
  const fetchSpy = spy(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(_input).endsWith("/deploy")) {
        return new Response(
          JSON.stringify({
            resolved_endpoint: {
              kind: "http-url",
              base_url: "https://candidate.example.test",
            },
            logs_ref: "/var/log/takos/worker.log",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (
        init?.method === "POST" && String(_input).includes("/remove?space_id=")
      ) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${String(_input)}`);
    },
  );
  const fetchImpl = fetchSpy as unknown as typeof fetch;

  const backend = createOciDeploymentBackend(
    {
      backend_name: "oci",
      space_id: "space-1",
      target_json: JSON.stringify({
        route_ref: "worker",
        endpoint: {
          kind: "service-ref",
          ref: "worker",
        },
        artifact: {
          kind: "container-image",
          image_ref: "ghcr.io/takos/worker:latest",
          exposed_port: 8080,
          health_path: "/readyz",
          health_interval: 5,
          health_timeout: 30,
          health_unhealthy_threshold: 3,
        },
      }),
    },
    {
      orchestratorUrl: "https://oci.example.test",
      orchestratorToken: "secret-token",
      fetchImpl,
    },
  );

  const deployment = {
    id: "dep-1",
    space_id: "space-1",
  } as Deployment;

  const result = await backend.deploy({
    deployment,
    artifactRef: "worker-v1",
    wasmContent: null,
    runtime: {
      profile: "container-service",
      envVars: {
        DATABASE_URL: "postgres://db.internal/takos",
        API_TOKEN: "secret-value",
      },
      bindings: [],
      config: {
        compatibility_date: "2026-01-01",
        compatibility_flags: ["nodejs_compat"],
        limits: { cpu_ms: 50 },
      },
    },
  });

  assertEquals(result, {
    resolvedEndpoint: {
      kind: "http-url",
      base_url: "https://candidate.example.test",
    },
    logsRef: "/var/log/takos/worker.log",
  });

  const deployCall = fetchSpy.calls[0]!;
  assertEquals(deployCall.args[0], "https://oci.example.test/deploy");
  const deployRequest = deployCall.args[1] as RequestInit;
  const deployBody = JSON.parse(String(deployRequest.body)) as Record<
    string,
    unknown
  >;
  assertObjectMatch(deployBody, {
    deployment_id: "dep-1",
    space_id: "space-1",
    artifact_ref: "worker-v1",
  });
  assertObjectMatch(deployBody.runtime as Record<string, unknown>, {
    profile: "container-service",
    env_vars: {
      DATABASE_URL: "postgres://db.internal/takos",
      API_TOKEN: "secret-value",
    },
  });
  assertObjectMatch(deployBody.target as Record<string, unknown>, {
    route_ref: "worker",
  });

  await backend.cleanupDeploymentArtifact?.("worker-v1");
  const cleanupCall = fetchSpy.calls[1]!;
  assertEquals(
    cleanupCall.args[0],
    "https://oci.example.test/services/worker/remove?space_id=space-1",
  );
  assertEquals((cleanupCall.args[1] as RequestInit).method, "POST");
});

Deno.test("createDeploymentBackend treats legacy cloudflare deployment rows as workers-dispatch", () => {
  const backend = createDeploymentBackend(
    {
      backend_name: "cloudflare",
      space_id: "space-1",
      target_json: "{}",
    } as Deployment,
    {
      cloudflareEnv: {
        CF_ACCOUNT_ID: "acct-1",
        CF_API_TOKEN: "token-1",
        WFP_DISPATCH_NAMESPACE: "namespace-1",
      },
    },
  );

  assertEquals(backend.name, "workers-dispatch");
});
