import { assertEquals } from "jsr:@std/assert";
import { getRequiredProxyCapability } from "../executor-auth.ts";

Deno.test("executor auth rejects removed binding proxy paths", () => {
  for (
    const path of [
      "/proxy/db/query",
      "/proxy/offload/get",
      "/proxy/git-objects/get",
      "/proxy/do/fetch",
      "/proxy/vectorize/query",
      "/proxy/ai/run",
      "/proxy/egress/fetch",
      "/proxy/runtime/fetch",
      "/proxy/unknown/fetch",
      "/proxy/queue/send",
    ]
  ) {
    assertEquals(getRequiredProxyCapability(path), null);
  }
});

Deno.test("executor auth maps current dispatch-issued RPC paths to control capability", () => {
  for (
    const path of [
      "/rpc/control/heartbeat",
      "/rpc/control/run-event",
      "/rpc/control/update-run-status",
      "/rpc/control/tool-execute",
    ]
  ) {
    assertEquals(getRequiredProxyCapability(path), "control");
  }
});
