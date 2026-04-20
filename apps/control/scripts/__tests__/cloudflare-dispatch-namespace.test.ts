import { assertEquals, assertThrows } from "jsr:@std/assert";

import { resolveCloudflareDispatchNamespace } from "../cloudflare-dispatch-namespace.ts";

function createEnv(values: Record<string, string | undefined>) {
  return (key: string) => values[key];
}

Deno.test("resolveCloudflareDispatchNamespace prefers WFP_DISPATCH_NAMESPACE", () => {
  assertEquals(
    resolveCloudflareDispatchNamespace(
      createEnv({
        WFP_DISPATCH_NAMESPACE: " wfp-namespace ",
      }),
    ),
    "wfp-namespace",
  );
});

Deno.test("resolveCloudflareDispatchNamespace accepts matching WFP and CF namespace values", () => {
  assertEquals(
    resolveCloudflareDispatchNamespace(
      createEnv({
        WFP_DISPATCH_NAMESPACE: " namespace ",
        CF_DISPATCH_NAMESPACE: "namespace",
      }),
    ),
    "namespace",
  );
});

Deno.test("resolveCloudflareDispatchNamespace falls back to CF_DISPATCH_NAMESPACE as a deprecated alias", () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assertEquals(
      resolveCloudflareDispatchNamespace(
        createEnv({
          CF_DISPATCH_NAMESPACE: " legacy-namespace ",
        }),
      ),
      "legacy-namespace",
    );
  } finally {
    console.warn = originalWarn;
  }
});

Deno.test("resolveCloudflareDispatchNamespace rejects missing namespace", () => {
  assertThrows(
    () => resolveCloudflareDispatchNamespace(createEnv({})),
    Error,
    "WFP_DISPATCH_NAMESPACE is required.",
  );
});

Deno.test("resolveCloudflareDispatchNamespace rejects conflicting namespace values", () => {
  assertThrows(
    () =>
      resolveCloudflareDispatchNamespace(
        createEnv({
          WFP_DISPATCH_NAMESPACE: "namespace-a",
          CF_DISPATCH_NAMESPACE: "namespace-b",
        }),
      ),
    Error,
    "Conflicting Cloudflare dispatch namespace values",
  );
});
