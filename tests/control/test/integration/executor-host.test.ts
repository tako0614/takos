import { getRequiredProxyCapability } from "@/runtime/container-hosts/executor-host.ts";
import { AGENT_PROXY_SCOPES } from "@/runtime/container-hosts/executor-utils.ts";

import { strict as assert } from "node:assert";
import { test } from "bun:test";

const CONTROL = "/api/internal/v1/agent-control/";

// Capability-split: the single coarse "control" scope was replaced by
// least-privilege per-endpoint scopes. Each control-RPC path resolves to exactly
// one scope, and an agent run (which holds the full AGENT_PROXY_SCOPES set) can
// still reach every control endpoint.
const EXPECTED_SCOPES: Record<string, string> = {
  "heartbeat": "run-lifecycle",
  "run-reset": "run-lifecycle",
  "run-record": "run-lifecycle",
  "run-bootstrap": "run-lifecycle",
  "run-usage": "run-lifecycle",
  "run-context": "run-lifecycle",
  "no-llm-complete": "run-lifecycle",
  "update-run-status": "run-lifecycle",
  "is-cancelled": "run-lifecycle",
  "run-event": "run-lifecycle",
  "current-session": "conversation",
  "conversation-history": "conversation",
  "add-message": "conversation",
  "memory-activation": "memory",
  "memory-finalize": "memory",
  "skill-plan": "skills",
  "tool-catalog": "tools",
  "tool-execute": "tools",
  "tool-cleanup": "tools",
  "api-keys": "provider-keys",
};

test("executor-host proxy capability boundaries - each control path maps to its least-privilege scope (reachable by an agent run)", () => {
  for (const [endpoint, scope] of Object.entries(EXPECTED_SCOPES)) {
    const required = getRequiredProxyCapability(`${CONTROL}${endpoint}`);
    assert.strictEqual(
      required,
      scope,
      `${endpoint} should require scope ${scope}`,
    );
    // An agent run holds the full scope set, so every control endpoint stays
    // reachable for agent runs (no regression vs the old coarse "control").
    assert.ok(
      required !== null && AGENT_PROXY_SCOPES.includes(required),
      `${endpoint} scope ${required} must be in AGENT_PROXY_SCOPES`,
    );
  }
});

test("executor-host proxy capability boundaries - binding-proxy, billing and unknown paths are not control-RPC (null = fail closed)", () => {
  for (
    const path of [
      "/proxy/db/first",
      "/proxy/runtime/fetch",
      "/proxy/unknown/fetch",
      "/proxy/heartbeat",
      "/proxy/run/reset",
      "/proxy/api-keys",
      "/proxy/run/usage",
      "/proxy/billing/run-usage",
      "/api/internal/v1/agent-control/billing-run-usage",
      "/proxy/unknown",
      "/proxy/token/refresh",
    ]
  ) {
    assert.strictEqual(
      getRequiredProxyCapability(path),
      null,
      `${path} must not resolve to a control-RPC scope`,
    );
  }
});
