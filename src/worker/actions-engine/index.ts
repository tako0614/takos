/**
 * takos-actions-engine
 *
 * GitHub Actions 互換ワークフローの parser / validator / planner ライブラリ。
 *
 * NOTE: in-process な実行レイヤ (JobScheduler / StepRunner / shell executor /
 * 実行コンテキストビルダー) は提供しない。Takos の control plane は queue 分散・
 * remote-runtime な独自 executor を実装しており、この package を runnable engine
 * としては consume しない。公開するのは parser / validator と実行計画の算出のみ。
 */

// 公開型
export type {
  ActionResolver,
  // トリガー型
  BranchFilter,
  Conclusion,
  ConcurrencyConfig,
  ContainerConfig,
  DiagnosticSeverity,
  ExecutionContext,
  ExecutionPlan,
  // コンテキスト型
  GitHubContext,
  InputsContext,
  Job,
  JobContext,
  JobDefaults,
  JobOutputs,
  JobResult,
  JobStrategy,
  MatrixConfig,
  MatrixContext,
  NeedsContext,
  // パーサー / スケジューラー型
  ParsedWorkflow,
  PermissionLevel,
  Permissions,
  PullRequestEventType,
  PullRequestTriggerConfig,
  RepositoryDispatchConfig,
  RunnerContext,
  // 実行状態型
  RunStatus,
  ScheduleTriggerConfig,
  // ステップ / ジョブ / ワークフロー型
  Step,
  StepExecutor,
  StepResult,
  StepsContext,
  StrategyContext,
  Workflow,
  WorkflowCallConfig,
  WorkflowCallInput,
  WorkflowCallOutput,
  WorkflowCallSecret,
  WorkflowDiagnostic,
  WorkflowDispatchConfig,
  WorkflowDispatchInput,
  WorkflowResult,
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
