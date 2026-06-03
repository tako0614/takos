import type { AgentConfig } from "./agent-models.ts";
import type { AgentConfigEnv } from "../../../shared/types/env.ts";
import { CUSTOM_TOOLS } from "../../tools/custom/index.ts";
import { SYSTEM_PROMPTS } from "./prompt-builder.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import {
  parseFloatValue,
  parseIntValue,
} from "@takos/worker-platform-utils/env-parse";

const DEFAULT_MAX_ITERATIONS = 10000;
const DEFAULT_TEMPERATURE = 0.5;

export function getAgentConfig(
  agentType: string,
  env?: AgentConfigEnv,
): AgentConfig {
  const warn = (msg: string) =>
    logWarn(msg, { module: "services/agent/runner-config" });

  const systemPrompt = SYSTEM_PROMPTS[agentType] || SYSTEM_PROMPTS.default;

  const tools = CUSTOM_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  const maxIterations = parseIntValue(
    "MAX_AGENT_ITERATIONS",
    env?.MAX_AGENT_ITERATIONS,
    DEFAULT_MAX_ITERATIONS,
    { min: 1, warn },
  );

  const temperature = parseFloatValue(
    "AGENT_TEMPERATURE",
    env?.AGENT_TEMPERATURE,
    DEFAULT_TEMPERATURE,
    { min: 0, max: 1, warn },
  );

  const rateLimitRaw = env?.AGENT_RATE_LIMIT
    ? parseIntValue("AGENT_RATE_LIMIT", env.AGENT_RATE_LIMIT, 0, {
      min: 1,
      warn,
    })
    : undefined;
  const rateLimit = rateLimitRaw && rateLimitRaw > 0 ? rateLimitRaw : undefined;

  return {
    type: agentType,
    systemPrompt,
    tools,
    maxIterations,
    temperature,
    rateLimit,
  };
}
