/**
 * Parallel Workflow Step Execution.
 *
 * Analyzes step dependencies to build a DAG, then executes
 * independent steps concurrently while respecting data flow.
 *
 * This is an alternative to the sequential {@link executeStepLoop} in
 * `workflow-job-phases.ts`. The original sequential executor is kept
 * for backward compatibility — callers opt in to parallel execution
 * by calling {@link executeStepLoopParallel} instead.
 */
import type { JobExecutionState, JobQueueContext } from './workflow-types';
type JobStep = JobQueueContext['message']['jobDefinition']['steps'][number];
/**
 * Build a DAG from workflow step definitions based on `steps.<id>` references.
 *
 * A step is considered to depend on another when its `if` condition,
 * environment variables, or `run` field references `steps.<id>.outputs`.
 * Steps without dependencies (or whose dependencies have all completed)
 * are eligible for parallel execution.
 */
export declare class StepDependencyGraph {
    /**
     * Map from step index to the set of step indices it depends on.
     * Only steps with an `id` can be referenced, so anonymous steps
     * never appear as dependencies.
     */
    private readonly edges;
    /** Map from step id to its index in the steps array. */
    private readonly idToIndex;
    /** Total number of steps. */
    readonly size: number;
    constructor(steps: JobStep[]);
    /**
     * Return the indices of steps whose dependencies are all in
     * {@link completedStepIds} and that are not themselves completed.
     */
    getReadySteps(completedIndices: Set<number>): number[];
    /**
     * Detect whether the dependency graph contains a cycle.
     *
     * Uses Kahn's algorithm — if topological order cannot include all
     * nodes, a cycle exists.
     */
    hasCycle(): boolean;
    /**
     * Extract all `steps.<id>` references from the fields of a step that
     * may contain expression interpolation.
     */
    private extractStepReferences;
}
/**
 * Execute workflow steps in parallel where possible, respecting data-flow
 * dependencies between steps.
 *
 * This function has the same signature and semantics as
 * {@link executeStepLoop} but analyzes step dependencies to run
 * independent steps concurrently. If a dependency cycle is detected,
 * it falls back to the original sequential implementation.
 *
 * @returns `'cancelled'` if the run was cancelled, `undefined` otherwise.
 */
export declare function executeStepLoopParallel(ctx: JobQueueContext, state: JobExecutionState): Promise<'cancelled' | void>;
export {};
//# sourceMappingURL=parallel-steps.d.ts.map