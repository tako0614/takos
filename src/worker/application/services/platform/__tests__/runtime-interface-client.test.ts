import { test } from "bun:test";
import { assertEquals, assertRejects } from "@takos/test/assert";

import {
  fetchAuthorizedRuntimeInterfaces,
  issueRuntimeInterfaceAccessToken,
  type RuntimeInterfaceRequestConfig,
} from "../runtime-interface-client.ts";

const selector = {
  workspaceId: "workspace_owner",
  type: "takosumi.ai.gateway",
  permission: "ai.chat",
  deliveryTypes: ["oauth2"],
} as const;

function resolvedInterface() {
  return {
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "Interface",
    metadata: {
      id: "if_ai_gateway",
      workspaceId: "workspace_owner",
      name: "default-ai",
      ownerRef: { kind: "Workspace", id: "workspace_owner" },
      generation: 1,
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    },
    spec: {
      type: "takosumi.ai.gateway",
      version: "v1",
      document: { protocol: "openai-compatible" },
      inputs: {
        endpoint: {
          source: "literal",
          value: "https://app.takosumi.test/gateway/ai/v1",
        },
      },
      access: {
        visibility: "workspace",
        resourceUriInput: "endpoint",
      },
    },
    status: {
      phase: "Resolved",
      observedGeneration: 1,
      resolvedRevision: 3,
      resolvedInputs: {
        endpoint: "https://app.takosumi.test/gateway/ai/v1",
      },
    },
  };
}

function readyBinding(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "InterfaceBinding",
    metadata: {
      id: "ifb_ai_gateway",
      workspaceId: "workspace_owner",
      generation: 2,
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    },
    spec: {
      interfaceId: "if_ai_gateway",
      subjectRef: { kind: "Principal", id: "pairwise-user" },
      permissions: ["ai.chat"],
      delivery: { type: "oauth2" },
    },
    status: {
      phase: "Ready",
      observedInterfaceRevision: 3,
    },
    ...overrides,
  };
}

test("runtime Interface discovery requires the exact Principal and revision", async () => {
  const config: RuntimeInterfaceRequestConfig = {
    baseUrl: "https://internal-app.takosumi.test",
    token: "delegated-accounts-token",
    subjectId: "pairwise-user",
    fetch: async (input) => {
      const url = new URL(input);
      if (url.pathname === "/v1/interfaces") {
        return Response.json({ interfaces: [resolvedInterface()] });
      }
      return Response.json({
        bindings: [
          readyBinding({
            metadata: {
              ...readyBinding().metadata,
              id: "ifb_wrong_subject",
            },
            spec: {
              ...readyBinding().spec,
              subjectRef: { kind: "Principal", id: "someone-else" },
            },
          }),
          readyBinding({
            metadata: { ...readyBinding().metadata, id: "ifb_stale" },
            status: { phase: "Ready", observedInterfaceRevision: 2 },
          }),
          readyBinding(),
        ],
      });
    },
  };

  const authorized = await fetchAuthorizedRuntimeInterfaces(selector, config);
  assertEquals(authorized.length, 1);
  assertEquals(authorized[0]?.interface.metadata.id, "if_ai_gateway");
  assertEquals(authorized[0]?.binding.metadata.id, "ifb_ai_gateway");
});

test("runtime Interface discovery rejects unsupported credential delivery", async () => {
  const authorized = await fetchAuthorizedRuntimeInterfaces(selector, {
    baseUrl: "https://internal-app.takosumi.test",
    token: "delegated-accounts-token",
    subjectId: "pairwise-user",
    fetch: async (input) => {
      const url = new URL(input);
      if (url.pathname === "/v1/interfaces") {
        return Response.json({ interfaces: [resolvedInterface()] });
      }
      return Response.json({
        bindings: [
          readyBinding({
            spec: {
              ...readyBinding().spec,
              delivery: {
                type: "oauth2",
                credentialRef: "secret/operator-key",
              },
            },
          }),
        ],
      });
    },
  });
  assertEquals(authorized, []);
});

test("runtime Interface token response is invocation-only and non-reusable", async () => {
  const resource = "https://app.takosumi.test/gateway/ai/v1";
  const valid = await issueRuntimeInterfaceAccessToken(
    {
      baseUrl: "https://internal-app.takosumi.test",
      token: "delegated-accounts-token",
      subjectId: "pairwise-user",
      fetch: async () =>
        Response.json({
          access_token: "runtime-interface-token",
          token_type: "Bearer",
          expires_in: 30,
          expires_at: new Date(Date.now() + 30_000).toISOString(),
          scope: "ai.chat",
          resource,
        }),
    },
    {
      interfaceId: "if_ai_gateway",
      permission: "ai.chat",
      resource,
      errorLabel: "AI Gateway Interface",
    },
  );
  assertEquals(valid, "runtime-interface-token");

  for (const invalidBody of [
    {
      access_token: "delegated-accounts-token",
      token_type: "Bearer",
      expires_in: 30,
      expires_at: new Date(Date.now() + 30_000).toISOString(),
      scope: "ai.chat",
      resource,
    },
    {
      access_token: "runtime-interface-token",
      token_type: "Bearer",
      expires_in: 61,
      expires_at: new Date(Date.now() + 61_000).toISOString(),
      scope: "ai.chat",
      resource,
    },
    {
      access_token: "runtime-interface-token",
      refresh_token: "must-not-exist",
      token_type: "Bearer",
      expires_in: 30,
      expires_at: new Date(Date.now() + 30_000).toISOString(),
      scope: "ai.chat",
      resource,
    },
  ]) {
    await assertRejects(
      () =>
        issueRuntimeInterfaceAccessToken(
          {
            baseUrl: "https://internal-app.takosumi.test",
            token: "delegated-accounts-token",
            subjectId: "pairwise-user",
            fetch: async () => Response.json(invalidBody),
          },
          {
            interfaceId: "if_ai_gateway",
            permission: "ai.chat",
            resource,
            errorLabel: "AI Gateway Interface",
          },
        ),
      "credential response is invalid",
    );
  }
});
