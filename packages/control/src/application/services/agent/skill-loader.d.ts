/**
 * Skill Loading and Runtime Resolution.
 *
 * Contains functions that load equipped skills from the database,
 * build skill resolution context from conversation history and
 * thread metadata, and emit skill load outcome events.
 *
 * Extracted from skills.ts to separate runtime loading concerns
 * from scoring and resolution logic.
 */
import type { AgentConfig, AgentMessage, AgentEvent } from './agent-models';
import type { ToolExecutorLike } from '../../tools/executor';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { SkillCatalogEntry, SkillContext, SkillResolutionContext, SkillSelection } from './skill-resolution';
export interface SkillLoadResult {
    success: boolean;
    error?: string;
    skillLocale: 'ja' | 'en';
    availableSkills: SkillCatalogEntry[];
    selectedSkills: SkillSelection[];
    activatedSkills: SkillContext[];
}
export declare function loadEquippedSkills(db: SqlDatabaseBinding, spaceId: string, toolExecutor: ToolExecutorLike | undefined, config: AgentConfig, skillContext: SkillResolutionContext): Promise<SkillLoadResult>;
/**
 * Build the skill resolution context from conversation history and thread metadata.
 */
export declare function buildSkillResolutionContext(db: SqlDatabaseBinding, context: {
    threadId: string;
    runId: string;
    spaceId: string;
}, config: AgentConfig, history: AgentMessage[]): Promise<SkillResolutionContext>;
export declare function resolveSkillPlanForRun(db: SqlDatabaseBinding, input: {
    threadId: string;
    runId: string;
    spaceId: string;
    agentType: string;
    history: AgentMessage[];
    availableToolNames: string[];
}): Promise<SkillLoadResult>;
/**
 * Emit the skill load outcome event (success with details, or warning on failure).
 */
export declare function emitSkillLoadOutcome(result: SkillLoadResult, emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>): Promise<void>;
//# sourceMappingURL=skill-loader.d.ts.map