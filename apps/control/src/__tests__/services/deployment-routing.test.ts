import { buildRoutingTarget } from "@/services/deployment/routing";

import { assertEquals, assertThrows } from "jsr:@std/assert";

const serviceRouteRecord = {
  id: "worker-1",
  hostname: "tenant.example.test",
  activeDeploymentId: "dep-current",
  customDomains: [],
};

Deno.test("deployment routing - builds an http-endpoint-set for generic http-url targets", () => {
  const result = buildRoutingTarget({
    deploymentId: "dep-oci",
    deploymentVersion: 2,
    deployArtifactRef: "artifact-oci",
    deploymentTarget: {
      route_ref: "takos-worker",
      endpoint: {
        kind: "http-url",
        base_url: "https://worker.example.test/base/",
      },
    },
    serviceRouteRecord,
    desiredRoutingStatus: "active",
    desiredRoutingWeight: 100,
    activeDeployment: null,
  }, ["tenant.example.test"]);

  assertEquals(result.target, {
    type: "http-endpoint-set",
    endpoints: [
      {
        name: "takos-worker",
        routes: [],
        target: {
          kind: "http-url",
          baseUrl: "https://worker.example.test/base/",
        },
      },
    ],
  });
});
Deno.test("deployment routing - uses route_ref for service-ref deployment routing", () => {
  const result = buildRoutingTarget({
    deploymentId: "dep-oci",
    deploymentVersion: 2,
    deployArtifactRef: "artifact-oci",
    deploymentTarget: {
      route_ref: "takos-worker",
      endpoint: {
        kind: "service-ref",
        ref: "takos-worker",
      },
    },
    serviceRouteRecord,
    desiredRoutingStatus: "active",
    desiredRoutingWeight: 100,
    activeDeployment: null,
  }, ["tenant.example.test"]);

  assertEquals(result.target, {
    type: "deployments",
    deployments: [
      {
        routeRef: "takos-worker",
        weight: 100,
        deploymentId: "dep-oci",
        status: "active",
      },
    ],
  });
});
Deno.test("deployment routing - uses artifact_ref for WFP worker-bundle routing", () => {
  const result = buildRoutingTarget({
    deploymentId: "dep-worker",
    deploymentVersion: 2,
    deployArtifactRef: "takos-worker-v2",
    deploymentTarget: {
      route_ref: "takos-worker",
      endpoint: {
        kind: "service-ref",
        ref: "takos-worker",
      },
      artifact: {
        kind: "worker-bundle",
      },
    },
    serviceRouteRecord,
    desiredRoutingStatus: "active",
    desiredRoutingWeight: 100,
    activeDeployment: null,
  }, ["tenant.example.test"]);

  assertEquals(result.target, {
    type: "deployments",
    deployments: [
      {
        routeRef: "takos-worker-v2",
        weight: 100,
        deploymentId: "dep-worker",
        status: "active",
      },
    ],
  });
});
Deno.test("deployment routing - uses rollback status for generic service-ref rollback routing", () => {
  const result = buildRoutingTarget({
    deploymentId: "dep-oci",
    deploymentVersion: 2,
    deployArtifactRef: "artifact-oci",
    deploymentTarget: {
      route_ref: "takos-worker",
      endpoint: {
        kind: "service-ref",
        ref: "takos-worker",
      },
    },
    serviceRouteRecord,
    desiredRoutingStatus: "rollback",
    desiredRoutingWeight: 100,
    activeDeployment: null,
  }, ["tenant.example.test"]);

  assertEquals(result.target, {
    type: "deployments",
    deployments: [
      {
        routeRef: "takos-worker",
        weight: 100,
        deploymentId: "dep-oci",
        status: "rollback",
      },
    ],
  });
  assertEquals(result.auditDetails.mode, "rollback");
});
Deno.test("deployment routing - keeps http-url rollback routing on http-endpoint-set", () => {
  const result = buildRoutingTarget({
    deploymentId: "dep-oci",
    deploymentVersion: 2,
    deployArtifactRef: "artifact-oci",
    deploymentTarget: {
      route_ref: "takos-worker",
      endpoint: {
        kind: "http-url",
        base_url: "https://worker.example.test/base/",
      },
    },
    serviceRouteRecord,
    desiredRoutingStatus: "rollback",
    desiredRoutingWeight: 100,
    activeDeployment: null,
  }, ["tenant.example.test"]);

  assertEquals(result.target, {
    type: "http-endpoint-set",
    endpoints: [
      {
        name: "takos-worker",
        routes: [],
        target: {
          kind: "http-url",
          baseUrl: "https://worker.example.test/base/",
        },
      },
    ],
  });
  assertEquals(result.auditDetails.mode, "http-url");
});
Deno.test("deployment routing - rejects canary routing for http-url targets", () => {
  assertThrows(
    () =>
      buildRoutingTarget({
        deploymentId: "dep-oci",
        deploymentVersion: 2,
        deployArtifactRef: "artifact-oci",
        deploymentTarget: {
          endpoint: {
            kind: "http-url",
            base_url: "https://worker.example.test/base/",
          },
        },
        serviceRouteRecord,
        desiredRoutingStatus: "canary",
        desiredRoutingWeight: 10,
        activeDeployment: {
          id: "dep-current",
          artifactRef: "worker-current",
          targetJson: JSON.stringify({
            route_ref: "worker-current",
            endpoint: {
              kind: "service-ref",
              ref: "worker-current",
            },
          }),
          routingStatus: "active",
        },
      }, ["tenant.example.test"]),
    Error,
    "http-url deployment targets do not support canary routing",
  );
});
