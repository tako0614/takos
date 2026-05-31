import { test } from "bun:test";
import { assertEquals } from "@std/assert";
import {
  buildAgentExecutorContainerEnvVars,
  shouldInjectProviderKeysDirect,
} from "../executor-proxy-config.ts";

test("container env omits provider keys by default (proxy mode)", () => {
  const vars = buildAgentExecutorContainerEnvVars({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
    OPENAI_API_KEY: "sk-openai",
    ANTHROPIC_API_KEY: "sk-anthropic",
    GOOGLE_API_KEY: "google-key",
  });

  assertEquals(vars, {
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://host.internal/",
  });
  assertEquals("OPENAI_API_KEY" in vars, false);
  assertEquals("ANTHROPIC_API_KEY" in vars, false);
  assertEquals("GOOGLE_API_KEY" in vars, false);
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
