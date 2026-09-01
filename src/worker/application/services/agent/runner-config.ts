import type { AgentConfig } from "./agent-models.ts";
import type { AgentConfigEnv } from "../../../shared/types/env.ts";
import { SYSTEM_PROMPTS } from "./prompt-builder.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import {
  parseFloatValue,
  parseIntValue,
} from "@takos/worker-platform-utils/env-parse";
import {
  DEFAULT_AGENT_TYPE,
  isAgentType,
} from "../../../shared/types/agent-tasks.ts";

const DEFAULT_TEMPERATURE = 0.5;
export const DEFAULT_AGENT_MAX_GRAPH_STEPS = 64;
export const DEFAULT_AGENT_MAX_TOOL_ROUNDS = 8;

export function getAgentConfig(
  agentType: string,
  env?: AgentConfigEnv,
): AgentConfig {
  const warn = (msg: string) =>
    logWarn(msg, { module: "services/agent/runner-config" });

  const resolvedAgentType = isAgentType(agentType)
    ? agentType
    : DEFAULT_AGENT_TYPE;
  const systemPrompt = SYSTEM_PROMPTS[resolvedAgentType];

  const maxGraphSteps = env?.TAKOS_AGENT_MAX_GRAPH_STEPS
    ? parseIntValue(
        "TAKOS_AGENT_MAX_GRAPH_STEPS",
        env.TAKOS_AGENT_MAX_GRAPH_STEPS,
        DEFAULT_AGENT_MAX_GRAPH_STEPS,
        { min: 1, max: 128, warn },
      )
    : DEFAULT_AGENT_MAX_GRAPH_STEPS;
  const maxToolRounds = env?.TAKOS_AGENT_MAX_TOOL_ROUNDS
    ? parseIntValue(
        "TAKOS_AGENT_MAX_TOOL_ROUNDS",
        env.TAKOS_AGENT_MAX_TOOL_ROUNDS,
        DEFAULT_AGENT_MAX_TOOL_ROUNDS,
        { min: 1, max: 16, warn },
      )
    : DEFAULT_AGENT_MAX_TOOL_ROUNDS;

  const temperature = parseFloatValue(
    "AGENT_TEMPERATURE",
    env?.AGENT_TEMPERATURE,
    DEFAULT_TEMPERATURE,
    { min: 0, max: 1, warn },
  );

  return {
    type: resolvedAgentType,
    systemPrompt,
    maxGraphSteps,
    maxToolRounds,
    temperature,
  };
}
