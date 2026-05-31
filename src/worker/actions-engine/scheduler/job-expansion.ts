/**
 * マトリクス展開と関連する純粋ヘルパ。
 * JobScheduler クラス本体から分離した stateless ユーティリティ群。
 */
import type {
  Job,
  MatrixContext,
  StrategyContext,
  Workflow,
} from "../workflow-models.ts";
import type { DependencyGraph } from "./dependency.ts";
import { buildMatrixJobId, expandMatrix } from "./matrix.ts";
import { conditionInvokesStatusFunction } from "../parser/expression.ts";

// --- needsInput 正規化 ---

export function normalizeNeedsInput(needs: unknown): string[] {
  if (typeof needs === "string") return [needs];
  if (Array.isArray(needs)) {
    return needs.filter((need): need is string => typeof need === "string");
  }
  return [];
}

// --- マトリクス展開されたジョブ ---

/**
 * スケジューラ内部で使用する展開済みジョブ記述子。
 * matrix を持たないジョブは一件の展開エントリとして扱う。
 */
export interface ExpandedJob {
  /** 展開後の一意な id (matrix がある場合は `${baseId}-${hash}` 形式) */
  id: string;
  /** 元ジョブ id */
  baseId: string;
  /** ジョブ定義 */
  job: Job;
  /** matrix context（matrix が無い場合は undefined） */
  matrix?: MatrixContext;
  /** strategy context（matrix が無い場合は undefined） */
  strategy?: StrategyContext;
}

/**
 * ワークフローを matrix 展開してスケジューラ内部で使う ExpandedJob の集合を返す。
 * - matrix が空なら元ジョブをそのまま 1 エントリにする
 * - matrix がある場合は組み合わせごとに `${baseId}-${hash}` を生成する
 */
export function buildExpandedJobs(workflow: Workflow): {
  jobs: Map<string, ExpandedJob>;
  expansionMap: Map<string, string[]>;
} {
  const jobs = new Map<string, ExpandedJob>();
  const expansionMap = new Map<string, string[]>();

  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    const expansions = expandMatrix(job.strategy);

    if (expansions.length === 0) {
      // 展開が無いジョブ (matrix 未指定 or 結果 0 件) → 単独エントリ
      jobs.set(jobId, {
        id: jobId,
        baseId: jobId,
        job,
      });
      expansionMap.set(jobId, [jobId]);
      continue;
    }

    // 展開されたエントリを全て追加
    const expandedIds: string[] = [];
    for (const expansion of expansions) {
      const expandedId = buildMatrixJobId(jobId, expansion.hash);
      // 万が一 hash 衝突した場合でも一意化するための suffix
      let uniqueId = expandedId;
      let counter = 1;
      while (jobs.has(uniqueId)) {
        uniqueId = `${expandedId}-${counter}`;
        counter += 1;
      }
      jobs.set(uniqueId, {
        id: uniqueId,
        baseId: jobId,
        job,
        matrix: expansion.matrix,
        strategy: expansion.strategy,
      });
      expandedIds.push(uniqueId);
    }
    expansionMap.set(jobId, expandedIds);
  }

  return { jobs, expansionMap };
}

/**
 * 展開後ジョブ用の DependencyGraph を構築する。
 * needs 参照は展開先 ID 全てに置き換える。
 */
export function buildExpandedDependencyGraph(
  expandedJobs: Map<string, ExpandedJob>,
  expansionMap: Map<string, string[]>,
): DependencyGraph {
  const nodes = new Set<string>();
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();

  for (const expanded of expandedJobs.values()) {
    nodes.add(expanded.id);
    edges.set(expanded.id, new Set());
    reverseEdges.set(expanded.id, new Set());
  }

  for (const expanded of expandedJobs.values()) {
    const needs = normalizeNeedsInput(expanded.job.needs);
    for (const need of needs) {
      const targets = expansionMap.get(need);
      if (!targets || targets.length === 0) {
        throw new Error(
          `Job "${expanded.baseId}" depends on unknown job "${need}"`,
        );
      }
      for (const target of targets) {
        if (!nodes.has(target)) {
          continue;
        }
        const expandedEdges = edges.get(expanded.id);
        const targetReverseEdges = reverseEdges.get(target);
        if (!expandedEdges || !targetReverseEdges) {
          throw new Error(
            `dependency graph invariant violated: missing edge map for "${expanded.id}" or "${target}"`,
          );
        }
        expandedEdges.add(target);
        targetReverseEdges.add(expanded.id);
      }
    }
  }

  return { nodes, edges, reverseEdges };
}

/**
 * `always()` / `failure()` / `cancelled()` を関数として呼び出している if 条件は
 * 依存スキップ / after-failure skip の早期 return を抑制する必要がある。
 *
 * 生文字列への正規表現マッチは `env.X == 'always('` のような文字列リテラルを
 * 誤検出するため、トークン列上で「識別子 + `(`」を判定する
 * conditionInvokesStatusFunction に委譲する。
 */
export function shouldSuppressDependencySkip(
  condition: string | undefined,
): boolean {
  return conditionInvokesStatusFunction(condition);
}
