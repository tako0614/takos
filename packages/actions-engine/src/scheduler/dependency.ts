/**
 * DAG（有向非巡回グラフ）で依存関係を解決
 */
import type { Workflow } from "../workflow-models.ts";
import { normalizeNeedsInput } from "./job.ts";

/**
 * 依存関係解決失敗時に投げるエラー
 */
export class DependencyError extends Error {
  constructor(
    message: string,
    public readonly jobs?: string[],
  ) {
    super(message);
    this.name = "DependencyError";
  }
}

/**
 * 依存グラフの表現
 */
export interface DependencyGraph {
  /** 全ノード（ジョブ ID） */
  nodes: Set<string>;
  /** エッジ: キーは値側のジョブに依存 */
  edges: Map<string, Set<string>>;
  /** 逆向きエッジ: キーを依存先として参照するジョブ集合 */
  reverseEdges: Map<string, Set<string>>;
}

function getOrCreateGraphSet(
  map: Map<string, Set<string>>,
  key: string,
): Set<string> {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const created = new Set<string>();
  map.set(key, created);
  return created;
}

const EMPTY_JOB_SET = new Set<string>();

/**
 * ワークフローから依存グラフを構築する
 */
export function buildDependencyGraph(workflow: Workflow): DependencyGraph {
  const nodes = new Set<string>();
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();

  // すべてのノードを初期化
  for (const jobId of Object.keys(workflow.jobs)) {
    nodes.add(jobId);
    edges.set(jobId, new Set());
    reverseEdges.set(jobId, new Set());
  }

  // 'needs' 宣言からエッジを構築
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    const needs = normalizeNeedsInput(job.needs);
    for (const need of needs) {
      if (!nodes.has(need)) {
        throw new DependencyError(
          `Job "${jobId}" depends on unknown job "${need}"`,
          [jobId, need],
        );
      }
      getOrCreateGraphSet(edges, jobId).add(need);
      getOrCreateGraphSet(reverseEdges, need).add(jobId);
    }
  }

  return { nodes, edges, reverseEdges };
}

/**
 * グラフ内の循環依存を検出
 * 見つかれば循環パスを返し、なければ空配列を返す
 */
export function detectCycle(graph: DependencyGraph): string[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): string[] | null {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const dependencies = graph.edges.get(node) || EMPTY_JOB_SET;
    for (const dep of dependencies) {
      if (!visited.has(dep)) {
        const cycle = dfs(dep);
        if (cycle) return cycle;
      } else if (recursionStack.has(dep)) {
        // 循環を検出、循環パスを返す
        const cycleStart = path.indexOf(dep);
        return [...path.slice(cycleStart), dep];
      }
    }

    path.pop();
    recursionStack.delete(node);
    return null;
  }

  for (const node of graph.nodes) {
    if (!visited.has(node)) {
      const cycle = dfs(node);
      if (cycle) return cycle;
    }
  }

  return [];
}

function assertAcyclic(graph: DependencyGraph): void {
  const cycle = detectCycle(graph);
  if (cycle.length > 0) {
    throw new DependencyError(
      `Circular dependency detected: ${cycle.join(" -> ")}`,
      cycle,
    );
  }
}

/**
 * ジョブを並列実行フェーズに分類
 * 同一フェーズ内のジョブは並列実行可能
 */
export function groupIntoPhases(graph: DependencyGraph): string[][] {
  // 先に循環依存を検査
  assertAcyclic(graph);

  const phases: string[][] = [];
  const assigned = new Set<string>();

  while (assigned.size < graph.nodes.size) {
    const phase: string[] = [];

    for (const node of graph.nodes) {
      if (assigned.has(node)) continue;

      // 依存ジョブがすべて割り当て済みか確認
      const dependencies = graph.edges.get(node) || EMPTY_JOB_SET;
      let canAdd = true;
      for (const dep of dependencies) {
        if (!assigned.has(dep)) {
          canAdd = false;
          break;
        }
      }

      if (canAdd) {
        phase.push(node);
      }
    }

    if (phase.length === 0) {
      // サイクル検出が正常ならここは発生しない
      throw new DependencyError("Unable to resolve dependencies");
    }

    // 予測可能な順序となるようソート
    phase.sort();
    phases.push(phase);

    for (const node of phase) {
      assigned.add(node);
    }
  }

  return phases;
}
