/**
 * Skill Plan - Handles skill plan resolution, catalog management, and locale processing.
 *
 * Extracted from runner.ts to separate skill concerns from the core run loop.
 */
import type { AgentRunnerIo } from './runner-io';
import type { AgentMessage, AgentEvent } from './agent-models';
import type { ToolExecutorLike } from '../../tools/executor';
import type { SkillCatalogEntry, SkillSelection, SkillContext, SkillLoadResult } from './skills';
export interface SkillPlanDeps {
    runIo: AgentRunnerIo;
    runId: string;
    threadId: string;
    spaceId: string;
    agentType: string;
}
export interface SkillState {
    locale: 'ja' | 'en';
    availableSkills: SkillCatalogEntry[];
    selectedSkills: SkillSelection[];
    activatedSkills: SkillContext[];
}
/**
 * Resolve the skill plan for the current run, updating the provided skill state in place.
 * Returns the raw SkillLoadResult for further processing.
 */
export declare function resolveAndApplySkills(deps: SkillPlanDeps, state: SkillState, history: AgentMessage[], toolExecutor: ToolExecutorLike | undefined, emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>): Promise<SkillLoadResult>;
/** Build the skill plan object expected by the LangGraph runner. */
export declare function buildSkillPlan(state: SkillState): {
    locale: "en" | "ja";
    availableSkills: SkillCatalogEntry[];
    selectableSkills: SkillCatalogEntry[];
    selectedSkills: SkillSelection[];
    activatedSkills: SkillContext[];
};
//# sourceMappingURL=skill-plan.d.ts.map