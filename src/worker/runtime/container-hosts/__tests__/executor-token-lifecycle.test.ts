import { test } from "bun:test";
import { assertEquals, assertFalse, assertRejects } from "@takos/test/assert";
import {
  AgentControlBodyError,
  proxyTokenMatchesLease,
  removeProxyTokensForLease,
  removeProxyTokensForRun,
  removeStaleProxyTokens,
  removeSupersededProxyTokens,
  readBoundedAgentControlJson,
  rejectsLegacySplitFinalization,
  runtimeProtocolVersionFromStartResult,
  STALE_PROXY_TOKEN_MS,
  upgradeProxyTokenRuntimeProtocol,
} from "../executor-host.ts";
import type { ProxyTokenInfo } from "../executor-utils.ts";

function tokenInfo(
  runId: string,
  serviceId: string,
  leaseVersion: number | undefined,
  lastHeartbeatAt = 1_000,
): ProxyTokenInfo {
  return {
    runId,
    serviceId,
    leaseVersion,
    capability: ["run-lifecycle"],
    executorTier: 1,
    executorContainerId: "tier1-warm-0",
    startedAt: lastHeartbeatAt,
    lastHeartbeatAt,
  };
}

test("proxy token identity includes run, service, and lease version", () => {
  const info = tokenInfo("run-1", "service-1", 4);
  assertEquals(proxyTokenMatchesLease(info, "run-1", "service-1", 4), true);
  assertFalse(proxyTokenMatchesLease(info, "run-1", "service-2", 4));
  assertFalse(proxyTokenMatchesLease(info, "run-1", "service-1", 5));
});

test("protocol v2 tokens cannot bypass atomic completion through split RPCs", () => {
  const splitPaths = [
    "/api/internal/v1/agent-control/add-message",
    "/api/internal/v1/agent-control/update-run-status",
    "/api/internal/v1/agent-control/run-fail",
    "/api/internal/v1/agent-control/run-reset",
  ];
  for (const path of splitPaths) {
    assertEquals(
      rejectsLegacySplitFinalization({ runtimeProtocolVersion: 2 }, path),
      true,
    );
    assertEquals(rejectsLegacySplitFinalization({}, path), false);
  }
  assertEquals(
    rejectsLegacySplitFinalization(
      { runtimeProtocolVersion: 2 },
      "/api/internal/v1/agent-control/complete-run",
    ),
    false,
  );
});

test("rolling start negotiation upgrades only the exact v2 token", () => {
  const tokens = new Map<string, ProxyTokenInfo>([
    ["old-image", tokenInfo("run-old", "service-old", 1)],
    ["new-image", tokenInfo("run-new", "service-new", 2)],
    ["same-lease-other-token", tokenInfo("run-new", "service-new", 2)],
  ]);

  const oldVersion = runtimeProtocolVersionFromStartResult({
    ok: true,
    body: JSON.stringify({ accepted: true }),
  });
  const newVersion = runtimeProtocolVersionFromStartResult({
    ok: true,
    body: JSON.stringify({ accepted: true, runtimeProtocolVersion: 2 }),
  });
  assertEquals(oldVersion, undefined);
  assertEquals(newVersion, 2);

  if (newVersion !== 2) throw new Error("expected v2 negotiation");
  assertEquals(
    upgradeProxyTokenRuntimeProtocol(
      tokens,
      "new-image",
      { runId: "run-new", serviceId: "service-new", leaseVersion: 2 },
      newVersion,
    ),
    true,
  );
  assertEquals(tokens.get("old-image")?.runtimeProtocolVersion, undefined);
  assertEquals(tokens.get("new-image")?.runtimeProtocolVersion, 2);
  assertEquals(
    tokens.get("same-lease-other-token")?.runtimeProtocolVersion,
    undefined,
  );
  assertEquals(
    upgradeProxyTokenRuntimeProtocol(
      tokens,
      "old-image",
      { runId: "wrong-run", serviceId: "service-old", leaseVersion: 1 },
      2,
    ),
    false,
  );
});

test("superseded cleanup preserves exact duplicates and a higher lease", () => {
  const tokens = new Map<string, ProxyTokenInfo>([
    ["old", tokenInfo("run-1", "service-old", 3)],
    ["current-a", tokenInfo("run-1", "service-current", 4)],
    ["current-b", tokenInfo("run-1", "service-current", 4)],
    ["future", tokenInfo("run-1", "service-future", 5)],
    ["other-run", tokenInfo("run-2", "service-other", 1)],
  ]);

  assertEquals(
    removeSupersededProxyTokens(tokens, "run-1", "service-current", 4),
    1,
  );
  assertFalse(tokens.has("old"));
  assertEquals(tokens.has("current-a"), true);
  assertEquals(tokens.has("current-b"), true);
  assertEquals(tokens.has("future"), true);
  assertEquals(tokens.has("other-run"), true);
});

test("lease-lost revoke removes only the stale exact lease", () => {
  const tokens = new Map<string, ProxyTokenInfo>([
    ["stale-a", tokenInfo("run-1", "service-old", 8)],
    ["stale-b", tokenInfo("run-1", "service-old", 8)],
    ["fresh", tokenInfo("run-1", "service-new", 9)],
  ]);

  assertEquals(removeProxyTokensForLease(tokens, "run-1", "service-old", 8), 2);
  assertEquals([...tokens.keys()], ["fresh"]);
});

test("terminal revoke removes every token for only that run", () => {
  const tokens = new Map<string, ProxyTokenInfo>([
    ["run-1-a", tokenInfo("run-1", "service-a", 1)],
    ["run-1-b", tokenInfo("run-1", "service-b", 2)],
    ["run-2", tokenInfo("run-2", "service-c", 1)],
  ]);

  assertEquals(removeProxyTokensForRun(tokens, "run-1"), 2);
  assertEquals([...tokens.keys()], ["run-2"]);
});

test("TTL pruning rejects an expired token while preserving a live token", () => {
  const now = 20_000_000;
  const tokens = new Map<string, ProxyTokenInfo>([
    [
      "expired",
      tokenInfo("run-1", "service-old", 1, now - STALE_PROXY_TOKEN_MS - 1),
    ],
    [
      "boundary",
      tokenInfo("run-2", "service-live", 1, now - STALE_PROXY_TOKEN_MS),
    ],
    ["live", tokenInfo("run-3", "service-live", 1, now - 1)],
    [
      "malformed",
      {
        ...tokenInfo("run-4", "service-malformed", 1),
        startedAt: undefined,
        lastHeartbeatAt: undefined,
      } as unknown as ProxyTokenInfo,
    ],
  ]);

  assertEquals(removeStaleProxyTokens(tokens, now), 2);
  assertFalse(tokens.has("expired"));
  assertFalse(tokens.has("malformed"));
  assertEquals(tokens.has("boundary"), true);
  assertEquals(tokens.has("live"), true);
});

test("control RPC JSON reader enforces both declared and streamed byte caps", async () => {
  const parsed = await readBoundedAgentControlJson(
    new Request("https://executor/control", {
      method: "POST",
      body: JSON.stringify({ runId: "run-1" }),
    }),
    128,
  );
  assertEquals(parsed, { runId: "run-1" });

  await assertRejects(
    () =>
      readBoundedAgentControlJson(
        new Request("https://executor/control", {
          method: "POST",
          headers: { "Content-Length": "1000" },
          body: "{}",
        }),
        128,
      ),
    AgentControlBodyError,
    "too large",
  );

  await assertRejects(
    () =>
      readBoundedAgentControlJson(
        new Request("https://executor/control", {
          method: "POST",
          body: JSON.stringify({ data: "x".repeat(256) }),
        }),
        128,
      ),
    AgentControlBodyError,
    "too large",
  );
});
