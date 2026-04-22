import { assertEquals } from "jsr:@std/assert";

import type { D1Database } from "../../../../shared/types/bindings.ts";
import { buildBindingFromResource, resourceBindingDeps } from "../bindings.ts";

function activeResource(overrides: Record<string, unknown>) {
  return {
    id: "resource-1",
    status: "active",
    type: "workflow",
    backend_name: "cloudflare",
    backing_resource_id: null,
    backing_resource_name: "fallback",
    config: "{}",
    ...overrides,
  };
}

Deno.test("buildBindingFromResource uses workflow runtime config", async () => {
  const originalGetResourceById = resourceBindingDeps.getResourceById;
  resourceBindingDeps.getResourceById = () =>
    Promise.resolve(activeResource({
      type: "workflow",
      backing_resource_name: "fallback-workflow",
      config: JSON.stringify({
        workflowRuntime: {
          service: "workflow-worker",
          export: "ConfiguredWorkflow",
        },
      }),
    }) as never);

  try {
    assertEquals(
      await buildBindingFromResource({} as D1Database, "resource-1", "WF"),
      {
        type: "workflow",
        name: "WF",
        workflow_name: "ConfiguredWorkflow",
      },
    );
  } finally {
    resourceBindingDeps.getResourceById = originalGetResourceById;
  }
});

Deno.test("buildBindingFromResource uses durable namespace config", async () => {
  const originalGetResourceById = resourceBindingDeps.getResourceById;
  resourceBindingDeps.getResourceById = () =>
    Promise.resolve(activeResource({
      type: "durable-object",
      backing_resource_name: "FallbackDurable",
      config: JSON.stringify({
        durableNamespace: {
          className: "ConfiguredDurable",
          scriptName: "durable-worker",
        },
      }),
    }) as never);

  try {
    assertEquals(
      await buildBindingFromResource({} as D1Database, "resource-1", "DO"),
      {
        type: "durable_object_namespace",
        name: "DO",
        class_name: "ConfiguredDurable",
        script_name: "durable-worker",
      },
    );
  } finally {
    resourceBindingDeps.getResourceById = originalGetResourceById;
  }
});
