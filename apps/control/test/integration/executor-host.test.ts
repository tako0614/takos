import {
  getRequiredProxyCapability,
  validateProxyResourceAccess,
} from "@/runtime/container-hosts/executor-host.ts";

import { assertEquals } from "jsr:@std/assert";

Deno.test("executor-host proxy capability boundaries - maps binding and control paths to distinct capabilities", () => {
  assertEquals(getRequiredProxyCapability("/proxy/db/first"), "bindings");
  assertEquals(getRequiredProxyCapability("/proxy/runtime/fetch"), "bindings");
  assertEquals(getRequiredProxyCapability("/proxy/browser/fetch"), "bindings");
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
  // /proxy/token/refresh no longer exists
  assertEquals(getRequiredProxyCapability("/proxy/token/refresh"), null);
});

Deno.test("executor-host proxy capability boundaries - allows only run-bound notifier fetches", () => {
  assertEquals(
    validateProxyResourceAccess("/proxy/do/fetch", { run_id: "run-1" }, {
      namespace: "RUN_NOTIFIER",
      name: "run-1",
    }),
    true,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/do/fetch", { run_id: "run-1" }, {
      namespace: "RUN_NOTIFIER",
      name: "run-2",
    }),
    false,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/do/fetch", { run_id: "run-1" }, {
      namespace: "OTHER",
      name: "run-1",
    }),
    false,
  );
});

Deno.test("executor-host proxy capability boundaries - allows only the index queue through the generic queue proxy", () => {
  assertEquals(
    validateProxyResourceAccess("/proxy/queue/send", {}, { queue: "index" }),
    true,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/queue/send", {}, { queue: "other" }),
    false,
  );
});

Deno.test("executor-host proxy capability boundaries - allows only runtime-host URLs on the runtime proxy allowlist", () => {
  assertEquals(
    validateProxyResourceAccess("/proxy/runtime/fetch", {}, {
      url: "https://runtime-host/session/exec",
    }),
    true,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/runtime/fetch", {}, {
      url: "https://runtime-host/repos/clone",
    }),
    true,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/runtime/fetch", {}, {
      url: "https://runtime-host/metrics",
    }),
    false,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/runtime/fetch", {}, {
      url: "https://example.com/session/exec",
    }),
    false,
  );
});

Deno.test("executor-host proxy capability boundaries - allows only browser-host URLs on the browser proxy allowlist", () => {
  assertEquals(
    validateProxyResourceAccess("/proxy/browser/fetch", {}, {
      url: "https://browser-host.internal/create",
    }),
    true,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/browser/fetch", {}, {
      url: "https://browser-host.internal/session/sid-1/action",
    }),
    true,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/browser/fetch", {}, {
      url: "https://browser-host.internal/session/sid-1/screenshot",
    }),
    true,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/browser/fetch", {}, {
      url: "https://browser-host.internal/unknown",
    }),
    false,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/browser/fetch", {}, {
      url: "https://example.com/session/sid-1/goto",
    }),
    false,
  );
});
