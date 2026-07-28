import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { fetchCapsuleWorkloadServices } from "../takosumi-workload-services.ts";

function uiInterface() {
  return {
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "Interface",
    metadata: {
      id: "if_docs",
      workspaceId: "workspace_1",
      name: "docs",
      ownerRef: { kind: "Capsule", id: "capsule_docs" },
      generation: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    spec: {
      type: "interface.ui.surface",
      version: "1",
      document: { launcher: true, display: { title: "Docs" } },
      inputs: {
        url: { source: "literal", value: "https://docs.example.test/" },
      },
      access: { visibility: "workspace" },
    },
    status: {
      phase: "Resolved",
      observedGeneration: 1,
      resolvedRevision: 2,
      resolvedInputs: { url: "https://docs.example.test/" },
    },
  };
}

function readyBinding() {
  return {
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "InterfaceBinding",
    metadata: {
      id: "ifb_docs",
      workspaceId: "workspace_1",
      generation: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    spec: {
      interfaceId: "if_docs",
      subjectRef: { kind: "Principal", id: "principal_1" },
      permissions: ["ui.open"],
      delivery: { type: "none" },
    },
    status: { phase: "Ready", observedInterfaceRevision: 2 },
  };
}

test("Capsule services use exact authorized Interfaces and never Outputs", async () => {
  const requested: URL[] = [];
  const services = await fetchCapsuleWorkloadServices(
    "capsule_docs",
    "workspace_1",
    {
      baseUrl: "https://app.takosumi.test",
      token: "delegated-token",
      subjectId: "principal_1",
      fetch: async (input) => {
        const url = new URL(input);
        requested.push(url);
        if (url.pathname.endsWith("/bindings")) {
          return Response.json({ bindings: [readyBinding()] });
        }
        return Response.json({
          interfaces:
            url.searchParams.get("type") === "interface.ui.surface"
              ? [uiInterface()]
              : [],
        });
      },
    },
  );

  assertEquals(services, [
    {
      id: "interface:docs",
      capability: "interface.ui.surface",
      status: "ready",
      endpoint: "https://docs.example.test/",
      secret_configured: false,
      token_expires_at: null,
    },
  ]);
  assertEquals(
    requested.some((url) => url.pathname.includes("/outputs")),
    false,
  );
  for (const url of requested.filter(
    (candidate) => candidate.pathname === "/v1/interfaces",
  )) {
    assertEquals(url.searchParams.get("ownerKind"), "Capsule");
    assertEquals(url.searchParams.get("ownerId"), "capsule_docs");
  }
});

test("Capsule services fail closed without delegated Principal authority", async () => {
  let fetched = false;
  const services = await fetchCapsuleWorkloadServices(
    "capsule_docs",
    "workspace_1",
    {
      baseUrl: "https://app.takosumi.test",
      token: "operator-token",
      fetch: async () => {
        fetched = true;
        return Response.json({ interfaces: [] });
      },
    },
  );
  assertEquals(services, []);
  assertEquals(fetched, false);
});
