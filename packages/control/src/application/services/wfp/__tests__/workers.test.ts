import { assertEquals } from "jsr:@std/assert";

import { createWorkerWithWasm } from "../workers.ts";
import type { WfpContext } from "../wfp-contracts.ts";

function createFakeContext(): {
  ctx: WfpContext;
  requests: Array<{ path: string; options: RequestInit }>;
} {
  const requests: Array<{ path: string; options: RequestInit }> = [];
  const ctx: WfpContext = {
    config: {
      accountId: "account-1",
      apiToken: "token-1",
      dispatchNamespace: "dispatch-namespace",
    },
    scriptPath(workerName: string): string {
      return `/accounts/account-1/workers/dispatch/namespaces/dispatch-namespace/scripts/${workerName}`;
    },
    accountPath(suffix: string): string {
      return `/accounts/account-1${suffix}`;
    },
    async cfFetch<T>() {
      throw new Error("not used");
    },
    async cfFetchWithRetry<T>(path: string, options: RequestInit) {
      requests.push({ path, options });
      return {
        success: true,
        errors: [],
        messages: [],
        result: {},
      } as never;
    },
    formatBinding(binding) {
      return { ...binding };
    },
    formatBindingForUpdate(binding) {
      return { ...binding };
    },
  };

  return { ctx, requests };
}

Deno.test("createWorkerWithWasm formats D1 bindings with database_id", async () => {
  const { ctx, requests } = createFakeContext();

  await createWorkerWithWasm(
    ctx,
    "worker-with-wasm",
    "export default {}",
    new Uint8Array([0, 97, 115, 109]).buffer,
    {
      bindings: [
        {
          type: "d1",
          name: "DB",
          database_id: "db-123",
        },
      ],
    },
  );

  assertEquals(requests.length, 1);
  const formData = requests[0]?.options.body as FormData;
  assertEquals(formData instanceof FormData, true);

  const metadataBlob = formData.get("metadata");
  assertEquals(metadataBlob instanceof Blob, true);
  const metadata = JSON.parse(await (metadataBlob as Blob).text()) as {
    bindings: Array<Record<string, unknown>>;
  };

  assertEquals(metadata.bindings, [
    {
      type: "d1",
      name: "DB",
      id: "db-123",
    },
  ]);
});
