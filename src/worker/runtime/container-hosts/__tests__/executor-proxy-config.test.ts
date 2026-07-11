import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  buildAgentExecutorContainerEnvVars,
  buildAgentExecutorProxyConfig,
  shouldInjectProviderKeysDirect,
} from "../executor-proxy-config.ts";

test("container env omits provider keys by default (proxy mode)", () => {
  const vars = buildAgentExecutorContainerEnvVars({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
    TAKOS_AGENT_START_TOKEN: "start-token",
    OPENAI_API_KEY: "sk-openai",
    ANTHROPIC_API_KEY: "sk-anthropic",
    GOOGLE_API_KEY: "google-key",
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
    TAKOS_AGENT_TOOL_ALLOWLIST: "file_read, web_fetch",
  });
  assertEquals(override.TAKOS_AGENT_TOOL_ALLOWLIST, "file_read, web_fetch");

  const blank = buildAgentExecutorContainerEnvVars({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
    TAKOS_AGENT_TOOL_ALLOWLIST: "   ",
  });
  assertEquals(blank.TAKOS_AGENT_TOOL_ALLOWLIST, "*");
});

test("container env stays proxy-only when flag is unset/empty/false", () => {
  for (const flag of [undefined, "", "   ", "0", "false", "no", "off"]) {
    const vars = buildAgentExecutorContainerEnvVars({
      TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
      OPENAI_API_KEY: "sk-openai",
      EXECUTOR_INJECT_PROVIDER_KEYS_DIRECT: flag,
    });
    assertEquals("OPENAI_API_KEY" in vars, false);
  }
});

test("container env injects provider keys only with explicit opt-in flag", () => {
  for (const flag of ["1", "true", "TRUE", " yes ", "Yes"]) {
    const vars = buildAgentExecutorContainerEnvVars({
      TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-anthropic",
      GOOGLE_API_KEY: "google-key",
      EXECUTOR_INJECT_PROVIDER_KEYS_DIRECT: flag,
    });
    assertEquals(vars.OPENAI_API_KEY, "sk-openai");
    assertEquals(vars.ANTHROPIC_API_KEY, "sk-anthropic");
    assertEquals(vars.GOOGLE_API_KEY, "google-key");
  }
});

test("opt-in mode skips empty/whitespace provider keys", () => {
  const vars = buildAgentExecutorContainerEnvVars({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
    OPENAI_API_KEY: "  sk-openai  ",
    ANTHROPIC_API_KEY: "   ",
    EXECUTOR_INJECT_PROVIDER_KEYS_DIRECT: "1",
  });
  assertEquals(vars.OPENAI_API_KEY, "sk-openai");
  assertEquals("ANTHROPIC_API_KEY" in vars, false);
  assertEquals("GOOGLE_API_KEY" in vars, false);
});

test("shouldInjectProviderKeysDirect parses truthy/falsy values", () => {
  assertEquals(shouldInjectProviderKeysDirect("1"), true);
  assertEquals(shouldInjectProviderKeysDirect("true"), true);
  assertEquals(shouldInjectProviderKeysDirect("YES"), true);
  assertEquals(shouldInjectProviderKeysDirect(undefined), false);
  assertEquals(shouldInjectProviderKeysDirect(""), false);
  assertEquals(shouldInjectProviderKeysDirect("0"), false);
  assertEquals(shouldInjectProviderKeysDirect("false"), false);
  assertEquals(shouldInjectProviderKeysDirect("maybe"), false);
});
