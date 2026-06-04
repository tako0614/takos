/**
 * takos-actions-engine
 *
 * GitHub Actions 互換ワークフローの in-process な parser / validator / planner。
 *
 * NOTE: runnable な式評価エンジン (tokenizer / evaluator / 実行コンテキストビルダー)
 * は提供しない。Takos の control plane は queue 分散・remote-runtime な独自 executor
 * を実装しており、step の `if:` 条件評価は worker runtime 側の
 * `src/worker/runtime/queues/workflow-expressions.ts` が担う (always/success/failure/
 * cancelled と限定的な `${{ ... }}` lookup のみをサポートする subset)。この module が
 * 公開するのは workflow の parse / validate と dependency / matrix 展開を踏まえた
 * 実行計画の算出のみ。
 */

// 公開型
export type {
  // トリガー型
  BranchFilter,
  Conclusion,
  ConcurrencyConfig,
  ContainerConfig,
  DiagnosticSeverity,
  ExecutionPlan,
  Job,
  JobDefaults,
  JobOutputs,
  JobStrategy,
  MatrixConfig,
  MatrixContext,
  // パーサー / スケジューラー型
  ParsedWorkflow,
  PermissionLevel,
  Permissions,
  PullRequestEventType,
  PullRequestTriggerConfig,
  RepositoryDispatchConfig,
  ScheduleTriggerConfig,
  // ステップ / ジョブ / ワークフロー型
  Step,
  StrategyContext,
  Workflow,
  WorkflowCallConfig,
  WorkflowCallInput,
  WorkflowCallOutput,
  WorkflowCallSecret,
  WorkflowDiagnostic,
  WorkflowDispatchConfig,
  WorkflowDispatchInput,
  WorkflowTrigger,
} from "./workflow-models.ts";

// パーサー API（公開）
export { parseWorkflow } from "./parser/workflow.ts";
export { validateWorkflow, type ValidationResult } from "./parser/validator.ts";

// 共有ユーティリティ（公開）
export { globMatch } from "./glob-match.ts";

// プランナー API（公開）
//
// in-process な実行レイヤは提供せず、dependency / matrix 展開を踏まえた
// 実行計画の算出だけを公開する。
export { createExecutionPlan } from "./scheduler/job.ts";
