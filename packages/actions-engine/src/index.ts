/**
 * takos-actions-engine
 * GitHub Actions 互換 CI エンジン
 */

// 公開型
export type {
  // トリガー型
  BranchFilter,
  PullRequestTriggerConfig,
  PullRequestEventType,
  WorkflowDispatchInput,
  WorkflowDispatchConfig,
  ScheduleTriggerConfig,
  RepositoryDispatchConfig,
  WorkflowCallInput,
  WorkflowCallOutput,
  WorkflowCallSecret,
  WorkflowCallConfig,
  WorkflowTrigger,
  // ステップ / ジョブ / ワークフロー型
  Step,
  MatrixConfig,
  JobStrategy,
  ContainerConfig,
  JobOutputs,
  PermissionLevel,
  Permissions,
  ConcurrencyConfig,
  JobDefaults,
  Job,
  Workflow,
  // 実行状態型
  RunStatus,
  Conclusion,
  StepResult,
  JobResult,
  WorkflowResult,
  // コンテキスト型
  GitHubContext,
  RunnerContext,
  JobContext,
  StepsContext,
  NeedsContext,
  StrategyContext,
  MatrixContext,
  InputsContext,
  ExecutionContext,
  // パーサー / スケジューラー型
  ParsedWorkflow,
  DiagnosticSeverity,
  WorkflowDiagnostic,
  ExecutionPlan,
  StepExecutor,
  ActionResolver,
} from './workflow-models.ts';

// パーサー API（公開）
export { parseWorkflow } from './parser/workflow.ts';
export { validateWorkflow, type ValidationResult } from './parser/validator.ts';

// スケジューラー API（公開）
export {
  createExecutionPlan,
  JobScheduler,
  type JobSchedulerEvent,
  type JobSchedulerListener,
  type JobSchedulerOptions,
} from './scheduler/job.ts';
export {
  StepRunner,
  type StepRunMetadata,
  type StepRunnerOptions,
} from './scheduler/step.ts';
export type {
  ShellExecutor,
  ShellExecutorOptions,
  ShellExecutorResult,
} from './scheduler/step-shell-executor.ts';

// コンテキストヘルパー（公開）
export {
  createBaseContext,
  parseGitHubEnvFile,
  type ContextBuilderOptions,
} from './context.ts';
