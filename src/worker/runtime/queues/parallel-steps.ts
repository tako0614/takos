/**
 * Parallel Workflow Step Execution.
 *
 * Analyzes step dependencies to build a DAG, then executes
 * independent steps concurrently while respecting data flow.
 *
 * This is an opt-in executor for workflows that can run independent steps
 * concurrently. Callers choose it by invoking {@link executeStepLoopParallel}.
 */

import type { WorkflowStepResult } from "../../application/services/execution/workflow-engine.ts";
import type { JobExecutionState, JobQueueContext } from "./workflow-types.ts";
import {
  getRunStatus,
  getStepDisplayName,
} from "./workflow-runtime-client.ts";
import {
  emitCancellation,
  executeOneStep,
  executeStepLoop,
} from "./workflow-job-phases.ts";
import { logInfo, logWarn } from "../../shared/utils/logger.ts";

// ---------------------------------------------------------------------------
// Step type — mirrors the inline type from WorkflowJobDefinition.steps
// ---------------------------------------------------------------------------

type JobStep = JobQueueContext["message"]["jobDefinition"]["steps"][number];

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

/**
 * Regex that matches `steps.<id>.outputs` references in step fields.
 *
 * Captures the step id as group 1. Used to infer data-flow dependencies
 * between steps so that independent steps can be scheduled in parallel.
 */
const STEPS_REF_REGEX = /steps\.([a-zA-Z_][a-zA-Z0-9_-]*)\b/g;

/**
 * Build a DAG from workflow step definitions based on `steps.<id>` references.
 *
 * A step is considered to depend on another when its `if` condition,
 * environment variables, or `run` field references `steps.<id>.outputs`.
 * Steps without dependencies (or whose dependencies have all completed)
 * are eligible for parallel execution.
 */
export class StepDependencyGraph {
  /**
   * Map from step index to the set of step indices it depends on.
   * Only steps with an `id` can be referenced, so anonymous steps
   * never appear as dependencies.
   */
  private readonly edges: Map<number, Set<number>>;

  /** Map from step id to its index in the steps array. */
  private readonly idToIndex: Map<string, number>;

  /** Total number of steps. */
  readonly size: number;

  constructor(steps: JobStep[]) {
    this.size = steps.length;
    this.idToIndex = new Map();
    this.edges = new Map();

    // First pass: build id -> index mapping
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.id) {
        this.idToIndex.set(step.id, i);
      }
      this.edges.set(i, new Set());
    }

    // Second pass: extract dependency references
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const referencedIds = Array.from(this.extractStepReferences(step));
      for (let r = 0; r < referencedIds.length; r++) {
        const depIndex = this.idToIndex.get(referencedIds[r]);
        if (depIndex !== undefined && depIndex !== i) {
          this.edgesForIndex(i).add(depIndex);
        }
      }
    }
  }

  /** Return the dependency set for an index, throwing if uninitialised. */
  private edgesForIndex(index: number): Set<number> {
    const set = this.edges.get(index);
    if (!set) {
      throw new Error(
        `StepDependencyGraph edges missing for index ${index}`,
      );
    }
    return set;
  }

  /**
   * Return the indices of steps whose dependencies are all in
   * {@link completedStepIds} and that are not themselves completed.
   */
  getReadySteps(completedIndices: Set<number>): number[] {
    const ready: number[] = [];
    for (let i = 0; i < this.size; i++) {
      if (completedIndices.has(i)) continue;
      const depsArr = Array.from(this.edgesForIndex(i));
      let allMet = true;
      for (let d = 0; d < depsArr.length; d++) {
        if (!completedIndices.has(depsArr[d])) {
          allMet = false;
          break;
        }
      }
      if (allMet) {
        ready.push(i);
      }
    }
    return ready;
  }

  /**
   * Detect whether the dependency graph contains a cycle.
   *
   * Uses Kahn's algorithm — if topological order cannot include all
   * nodes, a cycle exists.
   */
  hasCycle(): boolean {
    // In-degree = number of prerequisites each node has = size of its
    // dependency set.
    const inDegree: number[] = [];
    for (let i = 0; i < this.size; i++) {
      inDegree[i] = this.edgesForIndex(i).size;
    }

    const queue: number[] = [];
    for (let i = 0; i < this.size; i++) {
      if (inDegree[i] === 0) queue.push(i);
    }

    let visited = 0;
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === undefined) break;
      visited++;

      // For every other node that depends on `node`, reduce its in-degree
      for (let candidate = 0; candidate < this.size; candidate++) {
        if (this.edgesForIndex(candidate).has(node)) {
          inDegree[candidate]--;
          if (inDegree[candidate] === 0) {
            queue.push(candidate);
          }
        }
      }
    }

    return visited < this.size;
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Extract all `steps.<id>` references from the fields of a step that
   * may contain expression interpolation.
   */
  private extractStepReferences(step: JobStep): Set<string> {
    const refs = new Set<string>();
    const fields: Array<string | undefined> = [
      step.if,
      step.run,
    ];

    // Also scan env values
    if (step.env) {
      for (const value of Object.values(step.env)) {
        fields.push(value);
      }
    }

    for (const field of fields) {
      if (!field) continue;
      let match: RegExpExecArray | null;
      // Reset lastIndex for the global regex
      STEPS_REF_REGEX.lastIndex = 0;
      while ((match = STEPS_REF_REGEX.exec(field)) !== null) {
        refs.add(match[1]);
      }
    }

    return refs;
  }
}

// ---------------------------------------------------------------------------
// Parallel step loop
// ---------------------------------------------------------------------------

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
export async function executeStepLoopParallel(
  ctx: JobQueueContext,
  state: JobExecutionState,
): Promise<"cancelled" | void> {
  const { jobDefinition, runId } = ctx.message;
  const steps = jobDefinition.steps;

  // Build dependency graph
  const graph = new StepDependencyGraph(steps);

  // Cycle detected — fall back to sequential execution
  if (graph.hasCycle()) {
    logWarn(
      "Step dependency cycle detected, falling back to sequential execution",
      {
        module: "parallel-steps",
        action: "fallback",
      },
    );
    return executeStepLoop(ctx, state);
  }

  const completedIndices = new Set<number>();
  let cancelled = false;

  while (completedIndices.size < steps.length) {
    // ── Cancellation check ──────────────────────────────────────────
    const runStatus = await getRunStatus(ctx.env.DB, runId);
    if (runStatus === "cancelled") {
      await emitCancellation(ctx, state);
      cancelled = true;
      break;
    }

    // ── Get next batch of ready steps ───────────────────────────────
    const readyIndices = graph.getReadySteps(completedIndices);

    if (readyIndices.length === 0 && completedIndices.size < steps.length) {
      // Should not happen if hasCycle() returned false, but guard anyway
      logWarn("No ready steps but graph is incomplete — possible deadlock", {
        module: "parallel-steps",
      });
      state.jobConclusion = "failure";
      state.logs.push("Internal error: step dependency deadlock");
      state.logs.push("");
      break;
    }

    if (readyIndices.length > 1) {
      logInfo(`Executing ${readyIndices.length} steps in parallel`, {
        module: "parallel-steps",
      });
    }

    // ── Execute batch ───────────────────────────────────────────────
    const batchPromises = readyIndices.map((i) =>
      executeOneStep(ctx, state, i)
    );

    const batchResults = await Promise.allSettled(batchPromises);

    // ── Process results ─────────────────────────────────────────────
    for (let b = 0; b < readyIndices.length; b++) {
      const stepIndex = readyIndices[b];
      const outcome = batchResults[b];

      completedIndices.add(stepIndex);

      if (outcome.status === "rejected") {
        // Unexpected error — treat as failure
        const step = steps[stepIndex];
        const stepNumber = stepIndex + 1;
        const stepName = getStepDisplayName(step, stepNumber);
        const errorMessage = outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);

        const failResult: WorkflowStepResult = {
          stepNumber,
          name: stepName,
          status: "completed",
          conclusion: "failure",
          error: errorMessage,
          outputs: {},
        };
        state.stepResults.push(failResult);
        state.logs.push(`--- Step ${stepNumber}: ${stepName} ---`);
        state.logs.push(`Error: ${errorMessage}`);
        state.logs.push("");

        if (!step["continue-on-error"]) {
          state.jobConclusion = "failure";
        }
      }
      // fulfilled results are already recorded by executeOneStep
    }
  }

  if (cancelled) {
    return "cancelled";
  }
}
