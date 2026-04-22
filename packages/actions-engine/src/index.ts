/**
 * takos-actions-engine
 * GitHub Actions 互換 CI エンジン
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

// スケジューラー API（公開）
export {
  createExecutionPlan,
  JobScheduler,
  type JobSchedulerEvent,
  type JobSchedulerListener,
  type JobSchedulerOptions,
} from "./scheduler/job.ts";
export {
  type StepRunMetadata,
  StepRunner,
  type StepRunnerOptions,
} from "./scheduler/step.ts";
export type {
  ShellExecutor,
  ShellExecutorOptions,
  ShellExecutorResult,
} from "./scheduler/step-shell-executor.ts";

// コンテキストヘルパー（公開）
export {
  type ContextBuilderOptions,
  createBaseContext,
  parseGitHubEnvFile,
} from "./context.ts";
