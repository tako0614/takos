import { test } from "bun:test";
import { assertEquals } from "@std/assert";

import type { ServiceBindingRow } from "../desired-state-types.ts";
import { toPublicResourceType } from "../../resources/capabilities.ts";
import {
  toRuntimeBindingType,
  toServiceBinding,
} from "../resource-bindings.ts";

function bindingRow(
  overrides: Partial<ServiceBindingRow>,
): ServiceBindingRow {
  return {
    id: "binding-1",
    bindingName: "RESOURCE",
    bindingType: "d1",
    config: "{}",
    resourceId: "resource-1",
    resourceName: "resource",
    resourceType: "d1",
    resourceStatus: "active",
    backendName: "cloudflare",
    backingResourceId: "backing-id",
    backingResourceName: "backing-name",
    resourceConfig: "{}",
    ...overrides,
  };
}

test("toServiceBinding maps public secret resource types to runtime secret_text", () => {
  assertEquals(toRuntimeBindingType("secretRef"), "secret_text");
  assertEquals(toRuntimeBindingType("secret"), "secret_text");

  assertEquals(
    toServiceBinding(bindingRow({
      bindingName: "API_TOKEN",
      bindingType: "secretRef",
      backingResourceId: "secret-value",
    })),
    {
      type: "secret_text",
      name: "API_TOKEN",
      text: "secret-value",
    },
  );

  assertEquals(
    toServiceBinding(bindingRow({
      bindingName: "OTHER_TOKEN",
      bindingType: "secret",
      backingResourceId: "other-secret-value",
    })),
    {
      type: "secret_text",
      name: "OTHER_TOKEN",
      text: "other-secret-value",
    },
  );
});

test("toServiceBinding requires resolved secret text for portable secret resources", () => {
  const row = bindingRow({
    bindingName: "PORTABLE_TOKEN",
    bindingType: "secretRef",
    backendName: "aws",
    backingResourceId: "secret-name",
  });

  assertEquals(toServiceBinding(row), null);
  assertEquals(
    toServiceBinding(row, { secretText: "resolved-secret-value" }),
    {
      type: "secret_text",
      name: "PORTABLE_TOKEN",
      text: "resolved-secret-value",
    },
  );
});

test("toServiceBinding accepts canonical public resource types", () => {
  assertEquals(toPublicResourceType("sql"), "sql");
  assertEquals(toPublicResourceType("object-store"), "object-store");
  assertEquals(toPublicResourceType("key-value"), "key-value");
  assertEquals(toPublicResourceType("vector-index"), "vector-index");
  assertEquals(toPublicResourceType("d1"), null);
  assertEquals(toPublicResourceType("r2"), null);
  assertEquals(toPublicResourceType("vectorize"), null);

  assertEquals(
    toServiceBinding(bindingRow({
      bindingName: "BUCKET",
      bindingType: "object-store",
      backingResourceName: "bucket-name",
    })),
    {
      type: "r2_bucket",
      name: "BUCKET",
      bucket_name: "bucket-name",
    },
  );

  assertEquals(
    toServiceBinding(bindingRow({
      bindingName: "KV",
      bindingType: "key-value",
      backingResourceId: "namespace-id",
    })),
    {
      type: "kv_namespace",
      name: "KV",
      namespace_id: "namespace-id",
    },
  );

  assertEquals(
    toServiceBinding(bindingRow({
      bindingName: "DO",
      bindingType: "durable-object",
      backingResourceName: "DurableClass",
    })),
    {
      type: "durable_object_namespace",
      name: "DO",
      class_name: "DurableClass",
      script_name: undefined,
    },
  );
});

test("toServiceBinding uses durable namespace config from resource config", () => {
  assertEquals(
    toServiceBinding(bindingRow({
      bindingName: "DO",
      bindingType: "durable-object",
      backingResourceName: "fallback-class",
      resourceConfig: JSON.stringify({
        durableNamespace: {
          className: "ConfiguredDurable",
          scriptName: "durable-worker",
        },
      }),
    })),
    {
      type: "durable_object_namespace",
      name: "DO",
      class_name: "ConfiguredDurable",
      script_name: "durable-worker",
    },
  );
});

test("toServiceBinding uses workflow runtime export from resource config", () => {
  assertEquals(
    toServiceBinding(bindingRow({
      bindingName: "WORKFLOW",
      bindingType: "workflow",
      backingResourceName: "fallback-workflow",
      resourceConfig: JSON.stringify({
        workflowRuntime: {
          service: "workflow-worker",
          export: "ConfiguredWorkflow",
        },
      }),
    })),
    {
      type: "workflow",
      name: "WORKFLOW",
      workflow_name: "ConfiguredWorkflow",
    },
  );
});

test("toServiceBinding uses workflow runtime name when export is absent", () => {
  assertEquals(
    toServiceBinding(bindingRow({
      bindingName: "WORKFLOW",
      bindingType: "workflow",
      backingResourceName: "fallback-workflow",
      resourceConfig: JSON.stringify({
        workflowRuntime: {
          service: "workflow-worker",
          name: "NamedWorkflow",
        },
      }),
    })),
    {
      type: "workflow",
      name: "WORKFLOW",
      workflow_name: "NamedWorkflow",
    },
  );
});
