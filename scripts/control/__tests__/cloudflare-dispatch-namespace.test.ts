import { assertEquals, assertThrows } from "@std/assert";

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

Deno.test("resolveCloudflareDispatchNamespace rejects missing namespace", () => {
  assertThrows(
    () => resolveCloudflareDispatchNamespace(createEnv({})),
    Error,
    "WFP_DISPATCH_NAMESPACE is required.",
  );
});
