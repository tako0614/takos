import { getRequiredProxyCapability } from "@/runtime/container-hosts/executor-host.ts";

import { assertEquals } from "jsr:@std/assert";

Deno.test("executor-host proxy capability boundaries - maps current control paths to control capability", () => {
  assertEquals(getRequiredProxyCapability("/proxy/db/first"), null);
  assertEquals(getRequiredProxyCapability("/proxy/runtime/fetch"), null);
  assertEquals(getRequiredProxyCapability("/proxy/unknown/fetch"), null);
  assertEquals(getRequiredProxyCapability("/proxy/heartbeat"), "control");
  assertEquals(getRequiredProxyCapability("/rpc/control/heartbeat"), "control");
  assertEquals(getRequiredProxyCapability("/proxy/run/reset"), "control");
  assertEquals(getRequiredProxyCapability("/rpc/control/run-reset"), "control");
  assertEquals(
    getRequiredProxyCapability("/rpc/control/run-record"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/run-bootstrap"),
    "control",
  );
  assertEquals(getRequiredProxyCapability("/proxy/api-keys"), "control");
  assertEquals(getRequiredProxyCapability("/rpc/control/api-keys"), "control");
  assertEquals(
    getRequiredProxyCapability("/proxy/billing/run-usage"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/billing-run-usage"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/run-context"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/no-llm-complete"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/conversation-history"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/skill-plan"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/memory-activation"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/memory-finalize"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/add-message"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/update-run-status"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/current-session"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/is-cancelled"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/tool-catalog"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/tool-execute"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/rpc/control/tool-cleanup"),
    "control",
  );
  assertEquals(getRequiredProxyCapability("/rpc/control/run-event"), "control");
});

Deno.test("executor-host proxy capability boundaries - rejects unknown proxy paths", () => {
  assertEquals(getRequiredProxyCapability("/proxy/unknown"), null);
  assertEquals(getRequiredProxyCapability("/proxy/token/refresh"), null);
});
