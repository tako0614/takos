import type { AgentConfig } from "./agent-models.ts";
import type { AgentConfigEnv } from "../../../shared/types/env.ts";
import { SYSTEM_PROMPTS } from "./prompt-builder.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import {
  parseFloatValue,
  parseIntValue,
} from "@takos/worker-platform-utils/env-parse";

const DEFAULT_TEMPERATURE = 0.5;

export function getAgentConfig(
  agentType: string,
  env?: AgentConfigEnv,
): AgentConfig {
  const warn = (msg: string) =>
    logWarn(msg, { module: "services/agent/runner-config" });

  const systemPrompt = SYSTEM_PROMPTS[agentType] || SYSTEM_PROMPTS.default;

  const maxGraphSteps = env?.TAKOS_AGENT_MAX_GRAPH_STEPS
    ? parseIntValue(
        "TAKOS_AGENT_MAX_GRAPH_STEPS",
        env.TAKOS_AGENT_MAX_GRAPH_STEPS,
        64,
        { min: 1, max: 128, warn },
      )
    : undefined;
  const maxToolRounds = env?.TAKOS_AGENT_MAX_TOOL_ROUNDS
    ? parseIntValue(
        "TAKOS_AGENT_MAX_TOOL_ROUNDS",
        env.TAKOS_AGENT_MAX_TOOL_ROUNDS,
        8,
        { min: 1, max: 16, warn },
      )
    : undefined;

  const temperature = parseFloatValue(
    "AGENT_TEMPERATURE",
    env?.AGENT_TEMPERATURE,
    DEFAULT_TEMPERATURE,
    { min: 0, max: 1, warn },
  );

  return {
    type: agentType,
    systemPrompt,
    maxGraphSteps,
    maxToolRounds,
    temperature,
  };
}
