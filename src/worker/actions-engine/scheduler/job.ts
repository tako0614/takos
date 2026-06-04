/**
 * ワークフロー実行計画の算出
 */
import type { ExecutionPlan, Workflow } from "../workflow-models.ts";
import {
  buildDependencyGraph,
  groupIntoPhases,
} from "./dependency.ts";
import {
  buildExpandedDependencyGraph,
  buildExpandedJobs,
} from "./job-expansion.ts";

/**
 * ワークフロー実行計画を作成
 */
export function createExecutionPlan(workflow: Workflow): ExecutionPlan {
  // matrix 展開を適用した実行計画
  const { jobs, expansionMap } = buildExpandedJobs(workflow);
  // サイクル検査は元グラフでも行う。
  buildDependencyGraph(workflow);
  const graph = buildExpandedDependencyGraph(jobs, expansionMap);
  const phases = groupIntoPhases(graph);
  return { phases };
}
