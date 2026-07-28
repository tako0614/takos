import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import {
  getUISidebarItems,
  uiExtensionDeps,
} from "../ui-extensions.ts";

test("sidebar discovery reads only authorized Takosumi UI Interfaces", async () => {
  const originalFetch = uiExtensionDeps.fetchAuthorizedRuntimeInterfaces;
  const selectors: unknown[] = [];
  try {
    uiExtensionDeps.fetchAuthorizedRuntimeInterfaces = async (
      selector,
      config,
    ) => {
      selectors.push(selector);
      assertEquals(config.subjectId, "principal-1");
      return [
        {
          interface: {
            apiVersion: "takosumi.dev/v1alpha1",
            kind: "Interface",
            metadata: {
              id: "if_docs",
              workspaceId: "workspace-1",
              name: "docs",
              ownerRef: { kind: "Capsule", id: "capsule-docs" },
              generation: 1,
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z",
            },
            spec: {
              type: "interface.ui.surface",
              version: "1",
              document: {
                launcher: true,
                display: { title: "Docs", icon: "📄" },
                sidebar: { label: "Documents", icon: "file-text" },
              },
              inputs: {
                url: {
                  source: "literal",
                  value: "https://docs.example.test/",
                },
              },
              access: { visibility: "workspace" },
            },
            status: {
              phase: "Resolved",
              observedGeneration: 1,
              resolvedRevision: 2,
              resolvedInputs: { url: "https://docs.example.test/" },
            },
          },
          binding: {
            apiVersion: "takosumi.dev/v1alpha1",
            kind: "InterfaceBinding",
            metadata: {
              id: "ifb-docs",
              workspaceId: "workspace-1",
              generation: 1,
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z",
            },
            spec: {
              interfaceId: "if_docs",
              subjectRef: { kind: "Principal", id: "principal-1" },
              permissions: ["ui.open"],
              delivery: { type: "none" },
            },
            status: {
              phase: "Ready",
              observedInterfaceRevision: 2,
            },
          },
        },
      ] as never;
    };

    assertEquals(
      await getUISidebarItems({
        baseUrl: "https://accounts.takosumi.test",
        token: "delegated-token",
        subjectId: "principal-1",
        workspaceId: "workspace-1",
      }),
      [
        {
          label: "Documents",
          icon: "file-text",
          url: "https://docs.example.test/",
          extensionId: "interface:if_docs",
        },
      ],
    );
    assertEquals(selectors, [
      {
        workspaceId: "workspace-1",
        type: "interface.ui.surface",
        permission: "ui.open",
        deliveryTypes: ["none"],
      },
    ]);
  } finally {
    uiExtensionDeps.fetchAuthorizedRuntimeInterfaces = originalFetch;
  }
});
