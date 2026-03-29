/**
 * Prompt Budget Manager
 *
 * Manages system prompt composition with priority-based budget allocation.
 * Prevents unbounded prompt growth that degrades first-token latency.
 */
/**
 * Estimate token count for a text string.
 * More accurate than simple char/4 division:
 * - Splits on word/punctuation boundaries
 * - Counts CJK characters individually (each is typically 1-2 tokens)
 */
export declare function estimateTokens(text: string): number;
export interface PromptLane {
    /** Priority: lower number = higher priority (P0 is highest) */
    priority: number;
    /** Lane identifier for debugging */
    name: string;
    /** Content for this lane */
    content: string;
    /** Maximum tokens for this lane */
    maxTokens: number;
}
export interface PromptBudgetConfig {
    /** Total token budget for the system prompt. Default: 8000 */
    totalBudget?: number;
}
/**
 * Build a budgeted system prompt from priority lanes.
 * Lanes are placed in priority order. When the total budget is exceeded,
 * lower-priority lanes are truncated or dropped.
 */
export declare function buildBudgetedSystemPrompt(lanes: PromptLane[], config?: PromptBudgetConfig): string;
/** Standard lane priorities */
export declare const LANE_PRIORITY: {
    readonly BASE_PROMPT: 0;
    readonly TOOL_CATALOG: 1;
    readonly MEMORY_ACTIVATION: 2;
    readonly SKILL_INSTRUCTIONS: 3;
    readonly THREAD_CONTEXT: 4;
};
/** Standard lane max tokens */
export declare const LANE_MAX_TOKENS: {
    readonly BASE_PROMPT: 2000;
    readonly TOOL_CATALOG: 2500;
    readonly MEMORY_ACTIVATION: 800;
    readonly SKILL_INSTRUCTIONS: 2000;
    readonly THREAD_CONTEXT: 1500;
};
//# sourceMappingURL=prompt-budget.d.ts.map