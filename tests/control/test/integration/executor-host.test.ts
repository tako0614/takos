import { getRequiredProxyCapability } from "@/runtime/container-hosts/executor-host.ts";

import { strict as assert } from "node:assert";
import { test } from "bun:test";

test("executor-host proxy capability boundaries - maps current control paths to control capability", () => {
  assert.deepStrictEqual(getRequiredProxyCapability("/proxy/db/first"), null);
  assert.deepStrictEqual(getRequiredProxyCapability("/proxy/runtime/fetch"), null);
  assert.deepStrictEqual(getRequiredProxyCapability("/proxy/unknown/fetch"), null);
  assert.deepStrictEqual(getRequiredProxyCapability("/proxy/heartbeat"), null);
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/heartbeat"),
    "control",
  );
  assert.deepStrictEqual(getRequiredProxyCapability("/proxy/run/reset"), null);
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-reset"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-record"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-bootstrap"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/run-bootstrap",
    ),
    "control",
  );
  assert.deepStrictEqual(getRequiredProxyCapability("/proxy/api-keys"), null);
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/api-keys"),
    "control",
  );
  assert.deepStrictEqual(getRequiredProxyCapability("/proxy/run/usage"), null);
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-usage"),
    "control",
  );
  assert.deepStrictEqual(getRequiredProxyCapability("/proxy/billing/run-usage"), null);
  assert.deepStrictEqual(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/billing-run-usage",
    ),
    null,
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-context"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/no-llm-complete",
    ),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/conversation-history",
    ),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/skill-plan"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/memory-activation",
    ),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/memory-finalize",
    ),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/add-message"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/update-run-status",
    ),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/current-session"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/is-cancelled"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/tool-catalog"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/tool-execute"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/tool-execute"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/tool-cleanup"),
    "control",
  );
  assert.deepStrictEqual(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-event"),
    "control",
  );
});

test("executor-host proxy capability boundaries - rejects unknown proxy paths", () => {
  assert.deepStrictEqual(getRequiredProxyCapability("/proxy/unknown"), null);
  assert.deepStrictEqual(getRequiredProxyCapability("/proxy/token/refresh"), null);
});
