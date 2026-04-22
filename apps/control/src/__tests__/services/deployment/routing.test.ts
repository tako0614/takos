import { assertEquals, assertThrows } from "jsr:@std/assert";

import {
  buildRoutingTarget,
  collectHostnames,
} from "@/services/deployment/routing";

const baseServiceRouteRecord = {
  id: "w-1",
  hostname: "test.example.com",
  activeDeploymentId: "dep-prev",
  customDomains: [],
};

Deno.test("collectHostnames - normalizes, deduplicates, and filters hostnames", () => {
  assertEquals(
    collectHostnames({
      hostname: "Worker.Example.Com",
      customDomains: [{ domain: "custom.com" }, { domain: null }],
    }),
    ["worker.example.com", "custom.com"],
  );
});

Deno.test("buildRoutingTarget - builds active deployment routing target", () => {
  const result = buildRoutingTarget({
    deploymentId: "dep-1",
    deploymentVersion: 2,
    deployArtifactRef: "worker-w-1-v2",
    deploymentTarget: { route_ref: "worker-w-1-v2" },
    serviceRouteRecord: baseServiceRouteRecord,
    desiredRoutingStatus: "active",
    desiredRoutingWeight: 100,
    activeDeployment: null,
  }, ["test.example.com"]);

  assertEquals(result.target.type, "deployments");
  if (result.target.type === "deployments") {
    assertEquals(result.target.deployments[0].status, "active");
    assertEquals(result.target.deployments[0].weight, 100);
  }
  assertEquals(result.auditDetails.mode, "active");
});

Deno.test("buildRoutingTarget - builds canary routing target and clamps weight", () => {
  const result = buildRoutingTarget({
    deploymentId: "dep-2",
    deploymentVersion: 2,
    deployArtifactRef: "worker-w-1-v2",
    deploymentTarget: { route_ref: "worker-w-1-v2" },
    serviceRouteRecord: baseServiceRouteRecord,
    desiredRoutingStatus: "canary",
    desiredRoutingWeight: 150,
    activeDeployment: {
      id: "dep-1",
      artifactRef: "worker-w-1-v1",
      targetJson: '{"route_ref":"worker-w-1-v1"}',
      routingStatus: "active",
    },
  }, ["test.example.com"]);

  assertEquals(result.target.type, "deployments");
  if (result.target.type === "deployments") {
    const canarySlot = result.target.deployments.find((d) =>
      d.status === "canary"
    );
    assertEquals(canarySlot?.weight, 99);
  }
  assertEquals(result.auditDetails.mode, "canary");
});

Deno.test("buildRoutingTarget - canary worker-bundle slots route to artifact refs", () => {
  const result = buildRoutingTarget({
    deploymentId: "dep-2",
    deploymentVersion: 2,
    deployArtifactRef: "worker-w-1-v2",
    deploymentTarget: {
      route_ref: "worker-w-1",
      endpoint: { kind: "service-ref", ref: "worker-w-1" },
      artifact: { kind: "worker-bundle" },
    },
    serviceRouteRecord: baseServiceRouteRecord,
    desiredRoutingStatus: "canary",
    desiredRoutingWeight: 10,
    activeDeployment: {
      id: "dep-1",
      artifactRef: "worker-w-1-v1",
      targetJson: JSON.stringify({
        route_ref: "worker-w-1",
        endpoint: { kind: "service-ref", ref: "worker-w-1" },
        artifact: { kind: "worker-bundle" },
      }),
      routingStatus: "active",
    },
  }, ["test.example.com"]);

  assertEquals(result.target.type, "deployments");
  if (result.target.type === "deployments") {
    assertEquals(result.target.deployments.map((entry) => entry.routeRef), [
      "worker-w-1-v1",
      "worker-w-1-v2",
    ]);
  }
});

Deno.test("buildRoutingTarget - rounds fractional canary weight before clamping", () => {
  const result = buildRoutingTarget({
    deploymentId: "dep-2",
    deploymentVersion: 2,
    deployArtifactRef: "worker-w-1-v2",
    deploymentTarget: { route_ref: "worker-w-1-v2" },
    serviceRouteRecord: baseServiceRouteRecord,
    desiredRoutingStatus: "canary",
    desiredRoutingWeight: 1.9,
    activeDeployment: {
      id: "dep-1",
      artifactRef: "worker-w-1-v1",
      targetJson: '{"route_ref":"worker-w-1-v1"}',
      routingStatus: "active",
    },
  }, ["test.example.com"]);

  assertEquals(result.target.type, "deployments");
  if (result.target.type === "deployments") {
    const canarySlot = result.target.deployments.find((d) =>
      d.status === "canary"
    );
    assertEquals(canarySlot?.weight, 2);
  }
});

Deno.test("buildRoutingTarget - rejects unsupported or incomplete routing inputs", () => {
  assertThrows(
    () =>
      buildRoutingTarget({
        deploymentId: "dep-1",
        deploymentVersion: 1,
        deployArtifactRef: "",
        deploymentTarget: {},
        serviceRouteRecord: baseServiceRouteRecord,
        desiredRoutingStatus: "active",
        desiredRoutingWeight: 100,
        activeDeployment: null,
      }, ["test.example.com"]),
    Error,
    "Deployment route ref is missing",
  );

  assertThrows(
    () =>
      buildRoutingTarget({
        deploymentId: "dep-1",
        deploymentVersion: 1,
        deployArtifactRef: "worker-w-1-v1",
        deploymentTarget: {
          endpoint: {
            kind: "http-url" as const,
            base_url: "https://external.example.com",
          },
        },
        serviceRouteRecord: baseServiceRouteRecord,
        desiredRoutingStatus: "canary",
        desiredRoutingWeight: 10,
        activeDeployment: null,
      }, ["test.example.com"]),
    Error,
    "http-url deployment targets do not support canary routing",
  );
});
