/**
 * Skill Plan - Handles skill plan resolution, catalog management, and locale processing.
 *
 * Extracted from runner.ts to separate skill concerns from the core run loop.
 */

import type { AgentRunnerIo } from "./runner-io.ts";
import type { AgentEvent, AgentMessage } from "./agent-models.ts";
import type { ToolExecutorLike } from "../../tools/executor.ts";
import type {
  SkillCatalogEntry,
  SkillContext,
  SkillLoadResult,
  SkillSelection,
} from "./skills.ts";
import { emitSkillLoadOutcome } from "./skills.ts";

export interface SkillPlanDeps {
  runIo: AgentRunnerIo;
  runId: string;
  threadId: string;
  spaceId: string;
  agentType: string;
}

export interface SkillState {
  locale: "ja" | "en";
  availableSkills: SkillCatalogEntry[];
  selectedSkills: SkillSelection[];
  activatedSkills: SkillContext[];
}

/**
 * Resolve the skill plan for the current run, updating the provided skill state in place.
 * Returns the raw SkillLoadResult for further processing.
 */
export async function resolveAndApplySkills(
  deps: SkillPlanDeps,
  state: SkillState,
  history: AgentMessage[],
  toolExecutor: ToolExecutorLike | undefined,
  emitEvent: (
    type: AgentEvent["type"],
    data: Record<string, unknown>,
  ) => Promise<void>,
): Promise<SkillLoadResult> {
  const result = await deps.runIo.resolveSkillPlan({
    runId: deps.runId,
    threadId: deps.threadId,
    spaceId: deps.spaceId,
    agentType: deps.agentType,
    history,
    availableToolNames: toolExecutor?.getAvailableTools().map((tool) =>
      tool.name
    ) ?? [],
  });

  state.locale = result.skillLocale;
  state.availableSkills = result.availableSkills;
  state.selectedSkills = result.selectedSkills;
  state.activatedSkills = result.activatedSkills;

  await emitSkillLoadOutcome(result, emitEvent);

  return result;
}

/** Build the skill plan object expected by the LangGraph runner. */
export function buildSkillPlan(state: SkillState) {
  return {
    locale: state.locale,
    availableSkills: state.availableSkills,
    selectableSkills: state.availableSkills.filter((skill) =>
      skill.availability !== "unavailable"
    ),
    selectedSkills: state.selectedSkills,
    activatedSkills: state.activatedSkills,
  };
}
