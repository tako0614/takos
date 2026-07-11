import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  buildAgentExecutorContainerEnvVars,
  buildAgentExecutorProxyConfig,
} from "../executor-proxy-config.ts";

test("container env omits provider keys by default (proxy mode)", () => {
  const vars = buildAgentExecutorContainerEnvVars({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
    TAKOS_AGENT_START_TOKEN: "start-token",
  });

  assertEquals(vars, {
    TAKOS_AGENT_BIND_HOST: "0.0.0.0",
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
    TAKOS_AGENT_START_TOKEN: "start-token",
    TAKOS_AGENT_TOOL_ALLOWLIST: "*",
  });
  assertEquals("OPENAI_API_KEY" in vars, false);
  assertEquals("ANTHROPIC_API_KEY" in vars, false);
  assertEquals("GOOGLE_API_KEY" in vars, false);
});

test("container start auth uses the canonical agent start token", () => {
  const config = buildAgentExecutorProxyConfig({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
    TAKOS_AGENT_START_TOKEN: "start-token",
  });

  assertEquals(config.controlRpcBaseUrl, "https://host.internal/");
  assertEquals(config.startToken, "start-token");
});

test("tool allowlist defaults to '*' but honors an operator override", () => {
  const def = buildAgentExecutorContainerEnvVars({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
  });
  assertEquals(def.TAKOS_AGENT_TOOL_ALLOWLIST, "*");

  const override = buildAgentExecutorContainerEnvVars({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
    TAKOS_AGENT_TOOL_ALLOWLIST: "web_fetch, create_artifact",
  });
  assertEquals(
    override.TAKOS_AGENT_TOOL_ALLOWLIST,
    "web_fetch, create_artifact",
  );

  const blank = buildAgentExecutorContainerEnvVars({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
    TAKOS_AGENT_TOOL_ALLOWLIST: "   ",
  });
  assertEquals(blank.TAKOS_AGENT_TOOL_ALLOWLIST, "*");
});
