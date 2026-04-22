import {
  filterBindingsByCapabilities,
  selectAllowedCapabilities,
} from "@/services/platform/capabilities";

import { assertEquals } from "jsr:@std/assert";

Deno.test("selectAllowedCapabilities - grants non-AI tenant resource capabilities to editors", () => {
  const allowed = selectAllowedCapabilities({
    role: "editor",
    securityPosture: "standard",
    tenantType: "third_party",
  });

  assertEquals(allowed.has("queue.write"), true);
  assertEquals(allowed.has("analytics.write"), true);
  assertEquals(allowed.has("workflow.invoke"), true);
});

Deno.test("filterBindingsByCapabilities - allows queue, analytics, and workflow bindings when their capabilities are granted", () => {
  const { allowedBindings, deniedBindings } = filterBindingsByCapabilities({
    allowed: new Set(["queue.write", "analytics.write", "workflow.invoke"]),
    bindings: [
      { type: "queue", name: "JOB_QUEUE", queue_name: "jobs" },
      { type: "analytics_engine", name: "EVENTS", dataset: "events" },
      { type: "workflow", name: "PUBLISH_FLOW", workflow_name: "publish-flow" },
    ],
  });

  assertEquals(allowedBindings.length, 3);
  assertEquals(deniedBindings, []);
});
Deno.test("filterBindingsByCapabilities - denies workflow bindings without workflow.invoke", () => {
  const { allowedBindings, deniedBindings } = filterBindingsByCapabilities({
    allowed: new Set(["queue.write", "analytics.write"]),
    bindings: [
      { type: "workflow", name: "PUBLISH_FLOW", workflow_name: "publish-flow" },
    ],
  });

  assertEquals(allowedBindings, []);
  assertEquals(deniedBindings, [
    { type: "workflow", name: "PUBLISH_FLOW", workflow_name: "publish-flow" },
  ]);
});
