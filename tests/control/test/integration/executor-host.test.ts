import { getRequiredProxyCapability } from "@/runtime/container-hosts/executor-host.ts";

import { assertEquals } from "@std/assert";

Deno.test("executor-host proxy capability boundaries - maps current control paths to control capability", () => {
  assertEquals(getRequiredProxyCapability("/proxy/db/first"), null);
  assertEquals(getRequiredProxyCapability("/proxy/runtime/fetch"), null);
  assertEquals(getRequiredProxyCapability("/proxy/unknown/fetch"), null);
  assertEquals(getRequiredProxyCapability("/proxy/heartbeat"), null);
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/heartbeat"),
    "control",
  );
  assertEquals(getRequiredProxyCapability("/proxy/run/reset"), null);
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-reset"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-record"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-bootstrap"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/run-bootstrap",
    ),
    "control",
  );
  assertEquals(getRequiredProxyCapability("/proxy/api-keys"), null);
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/api-keys"),
    "control",
  );
  assertEquals(getRequiredProxyCapability("/proxy/run/usage"), null);
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-usage"),
    "control",
  );
  assertEquals(getRequiredProxyCapability("/proxy/billing/run-usage"), null);
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/billing-run-usage",
    ),
    null,
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-context"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/no-llm-complete",
    ),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/conversation-history",
    ),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/skill-plan"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/memory-activation",
    ),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/memory-finalize",
    ),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/add-message"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/update-run-status",
    ),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/current-session",
    ),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/is-cancelled"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/tool-catalog"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/tool-execute"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/tool-execute"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/tool-cleanup"),
    "control",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-event"),
    "control",
  );
});

Deno.test("executor-host proxy capability boundaries - rejects unknown proxy paths", () => {
  assertEquals(getRequiredProxyCapability("/proxy/unknown"), null);
  assertEquals(getRequiredProxyCapability("/proxy/token/refresh"), null);
});
