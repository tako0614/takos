import { assertEquals } from "jsr:@std/assert";

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

Deno.test("toServiceBinding maps public secret resource types to runtime secret_text", () => {
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

Deno.test("toServiceBinding requires resolved secret text for portable secret resources", () => {
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

Deno.test("toServiceBinding accepts canonical public resource type aliases", () => {
  assertEquals(toPublicResourceType("d1"), "sql");
  assertEquals(toPublicResourceType("r2"), "object-store");
  assertEquals(toPublicResourceType("kv"), "key-value");
  assertEquals(toPublicResourceType("vectorize"), "vector-index");

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
