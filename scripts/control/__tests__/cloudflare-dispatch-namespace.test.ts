import { test } from "bun:test";
import assert from "node:assert/strict";

import { resolveCloudflareDispatchNamespace } from "../cloudflare-dispatch-namespace.ts";

function createEnv(values: Record<string, string | undefined>) {
  return (key: string) => values[key];
}

test("resolveCloudflareDispatchNamespace prefers WFP_DISPATCH_NAMESPACE", () => {
  assert.equal(
    resolveCloudflareDispatchNamespace(
      createEnv({
        WFP_DISPATCH_NAMESPACE: " wfp-namespace ",
      }),
    ),
    "wfp-namespace",
  );
});

test("resolveCloudflareDispatchNamespace rejects missing namespace", () => {
  assert.throws(
    () => resolveCloudflareDispatchNamespace(createEnv({})),
    Error,
    "WFP_DISPATCH_NAMESPACE is required.",
  );
});
