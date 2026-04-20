/**
 * GitHub Actions 互換のワークフロー型定義
 */

// =============================================================================
// トリガー設定の型定義
// =============================================================================

/**
 * ブランチ/タグフィルター設定
 */
export interface BranchFilter {
  branches?: string[];
  "branches-ignore"?: string[];
  tags?: string[];
  "tags-ignore"?: string[];
  paths?: string[];
  "paths-ignore"?: string[];
}

/**
 * プルリクエストイベントのトリガー設定
 */
export interface PullRequestTriggerConfig extends BranchFilter {
  types?: PullRequestEventType[];
}

/**
 * プルリクエストイベント種別
 *
 * GitHub Actions 互換: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#pull_request
 */
export type PullRequestEventType =
  | "assigned"
  | "unassigned"
  | "labeled"
  | "unlabeled"
  | "opened"
  | "edited"
  | "closed"
  | "reopened"
  | "synchronize"
  | "converted_to_draft"
  | "ready_for_review"
  | "locked"
  | "unlocked"
  | "review_requested"
  | "review_request_removed"
  | "auto_merge_enabled"
  | "auto_merge_disabled"
  | "milestoned"
  | "demilestoned"
  | "enqueued"
  | "dequeued";

/**
 * issues イベント種別
 *
 * GitHub Actions 互換: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#issues
 */
export type IssuesEventType =
  | "opened"
  | "edited"
  | "deleted"
  | "transferred"
  | "pinned"
  | "unpinned"
  | "closed"
  | "reopened"
  | "assigned"
  | "unassigned"
  | "labeled"
  | "unlabeled"
  | "locked"
  | "unlocked"
  | "milestoned"
  | "demilestoned";

/**
 * issue_comment イベント種別
 */
export type IssueCommentEventType = "created" | "edited" | "deleted";

/**
 * release イベント種別
 */
export type ReleaseEventType =
  | "published"
  | "unpublished"
  | "created"
  | "edited"
  | "deleted"
  | "prereleased"
  | "released";

/**
 * watch イベント種別
 */
export type WatchEventType = "started";

/**
 * workflow_dispatch 入力定義
 */
export interface WorkflowDispatchInput {
  description?: string;
  required?: boolean;
  default?: string;
  type?: "string" | "boolean" | "choice" | "environment";
  options?: string[];
}

/**
 * workflow_dispatch トリガー設定
 */
export interface WorkflowDispatchConfig {
  inputs?: Record<string, WorkflowDispatchInput>;
}

/**
 * スケジュールトリガー設定（cron）
 */
export interface ScheduleTriggerConfig {
  cron: string;
}

/**
 * repository_dispatch トリガー設定
 */
export interface RepositoryDispatchConfig {
  types?: string[];
}

/**
 * workflow_call 入力定義
 */
export interface WorkflowCallInput {
  description?: string;
  required?: boolean;
  default?: string | boolean | number;
  type: "string" | "boolean" | "number";
}

/**
 * workflow_call 出力定義
 */
export interface WorkflowCallOutput {
  description?: string;
  value: string;
}

/**
 * workflow_call シークレット定義
 */
export interface WorkflowCallSecret {
  description?: string;
  required?: boolean;
}

/**
 * workflow_call トリガー設定
 */
export interface WorkflowCallConfig {
  inputs?: Record<string, WorkflowCallInput>;
  outputs?: Record<string, WorkflowCallOutput>;
  secrets?: Record<string, WorkflowCallSecret>;
}

/**
 * 利用可能な全トリガー
 */
export interface WorkflowTrigger {
  push?: BranchFilter | null;
  pull_request?: PullRequestTriggerConfig | null;
  pull_request_target?: PullRequestTriggerConfig | null;
  workflow_dispatch?: WorkflowDispatchConfig | null;
  workflow_call?: WorkflowCallConfig | null;
  schedule?: ScheduleTriggerConfig[];
  repository_dispatch?: RepositoryDispatchConfig | null;
  // イベント: issue
  issues?: { types?: IssuesEventType[] } | null;
  issue_comment?: { types?: IssueCommentEventType[] } | null;
  // イベント: release
  release?: { types?: ReleaseEventType[] } | null;
  // その他の汎用イベント
  create?: null;
  delete?: null;
  fork?: null;
  watch?: { types?: WatchEventType[] } | null;
}

// =============================================================================
// ステップ定義
// =============================================================================

/**
 * ステップ定義
 */
export interface Step {
  /** ステップ ID */
  id?: string;
  /** ステップ表示名 */
  name?: string;
  /** 使用するアクション（例: "actions/checkout@v4"） */
  uses?: string;
  /** 実行するシェルコマンド */
  run?: string;
  /** run ステップの作業ディレクトリ */
  "working-directory"?: string;
  /** run ステップで使うシェル */
  shell?: "bash" | "pwsh" | "python" | "sh" | "cmd" | "powershell";
  /** アクションに渡す入力パラメータ */
  with?: Record<string, unknown>;
  /** このステップの環境変数 */
  env?: Record<string, string>;
  /** 条件付き実行 */
  if?: string;
  /** エラー時も継続 */
  "continue-on-error"?: boolean;
  /** タイムアウト（分） */
  "timeout-minutes"?: number;
}

// =============================================================================
// ジョブ型定義
// =============================================================================

/**
 * 戦略マトリクス設定
 * 配列と include/exclude の両方を扱うため、より柔軟な型を使用
 */
export type MatrixConfig = Record<
  string,
  unknown[] | Record<string, unknown>[]
>;

/**
 * ジョブ戦略設定
 */
export interface JobStrategy {
  matrix?: MatrixConfig;
  "fail-fast"?: boolean;
  "max-parallel"?: number;
}

/**
 * コンテナ設定
 */
export interface ContainerConfig {
  image: string;
  credentials?: {
    username: string;
    password: string;
  };
  env?: Record<string, string>;
  ports?: (number | string)[];
  volumes?: string[];
  options?: string;
}

/**
 * ジョブ出力定義
 */
export type JobOutputs = Record<string, string>;

/**
 * 権限設定
 */
export type PermissionLevel = "read" | "write" | "none";
export type Permissions =
  | "read-all"
  | "write-all"
  | Record<string, PermissionLevel>;

/**
 * 同時実行制御設定
 */
export interface ConcurrencyConfig {
  group: string;
  "cancel-in-progress"?: boolean;
}

/**
 * ジョブ既定値設定
 */
export interface JobDefaults {
  run?: {
    shell?: string;
    "working-directory"?: string;
  };
}

/**
 * ジョブ定義
 */
export interface Job {
  /** ジョブ表示名 */
  name?: string;
  /** ランナーラベルまたはランナーグループ */
  "runs-on": string | string[];
  /** 依存ジョブ */
  needs?: string | string[];
  /** 条件付き実行 */
  if?: string;
  /** 全ステップ共通の環境変数 */
  env?: Record<string, string>;
  /** ジョブステップ */
  steps: Step[];
  /** ジョブ出力 */
  outputs?: JobOutputs;
  /** マトリクス戦略 */
  strategy?: JobStrategy;
  /** ジョブ実行用コンテナ */
  container?: string | ContainerConfig;
  /** サービスコンテナ */
  services?: Record<string, ContainerConfig>;
  /** タイムアウト（分） */
  "timeout-minutes"?: number;
  /** ジョブ失敗時にワークフローを継続する */
  "continue-on-error"?: boolean;
  /** ジョブ権限 */
  permissions?: Permissions;
  /** 同時実行設定 */
  concurrency?: string | ConcurrencyConfig;
  /** run ステップの既定設定 */
  defaults?: JobDefaults;
  /** デプロイ先環境 */
  environment?: string | { name: string; url?: string };
}

// =============================================================================
// ワークフロー型定義
// =============================================================================

/**
 * 完全なワークフロー定義
 */
export interface Workflow {
  /** ワークフロー表示名 */
  name?: string;
  /**
   * 実行名テンプレート。GitHub Actions 互換の `run-name` フィールド。
   * 式補間をサポートするが、現状 runtime はテンプレート文字列として
   * そのまま保持するのみで、`${{ ... }}` の interpolation は将来実装。
   */
  "run-name"?: string;
  /** トリガーイベント */
  on: WorkflowTrigger | string | string[];
  /** グローバル環境変数 */
  env?: Record<string, string>;
  /** ジョブ定義 */
  jobs: Record<string, Job>;
  /** グローバル権限 */
  permissions?: Permissions;
  /** グローバル同時実行設定 */
  concurrency?: string | ConcurrencyConfig;
  /** 全ジョブ共通の既定設定 */
  defaults?: JobDefaults;
}

// =============================================================================
// 実行状態型
// =============================================================================

/**
 * GitHub Actions ワークフロー実行ステータス
 *
 * これは *Actions* ドメインのステータスで、packages/control 側の
 * Agent RunStatus（'pending'|'queued'|'running'|'completed'|'failed'|'cancelled'）と
 * 意図的に異なる形式。
 * Web UI（apps/control/web/src/views/repos/components/actions/actions-types.ts）では
 * concurrency ブロック中表示用に 'waiting' を追加している。
 */
export type RunStatus = "queued" | "in_progress" | "completed" | "cancelled";

/**
 * 実行結果
 */
export type Conclusion = "success" | "failure" | "cancelled" | "skipped";

/**
 * ステップ実行結果
 */
export interface StepResult {
  /** ステップ ID */
  id?: string;
  /** ステップ名 */
  name?: string;
  /** 実行状態 */
  status: RunStatus;
  /** 最終結果 */
  conclusion?: Conclusion;
  /** `steps.<id>.outcome` 互換用。現状は `conclusion` と同じ値。 */
  outcome?: Conclusion;
  /** ステップ出力 */
  outputs: Record<string, string>;
  /** 開始時刻 */
  startedAt?: Date;
  /** 終了時刻 */
  completedAt?: Date;
  /** 失敗時のエラーメッセージ */
  error?: string;
}

/**
 * ジョブ実行結果
 */
export interface JobResult {
  /** ジョブ ID */
  id: string;
  /** ジョブ名 */
  name?: string;
  /** 実行状態 */
  status: RunStatus;
  /** 最終結果 */
  conclusion?: Conclusion;
  /** ステップ結果 */
  steps: StepResult[];
  /** ジョブ出力 */
  outputs: Record<string, string>;
  /** 開始時刻 */
  startedAt?: Date;
  /** 終了時刻 */
  completedAt?: Date;
  /** マトリクス実行時の値 */
  matrix?: Record<string, unknown>;
}

/**
 * ワークフロー実行結果
 */
export interface WorkflowResult {
  /** 実行 ID */
  id: string;
  /** ワークフロー名 */
  name?: string;
  /** 実行状態 */
  status: RunStatus;
  /** 最終結果 */
  conclusion?: Conclusion;
  /** ジョブ結果 */
  jobs: Record<string, JobResult>;
  /** トリガーイベント */
  event: string;
  /** 開始時刻 */
  startedAt?: Date;
  /** 終了時刻 */
  completedAt?: Date;
}

// =============================================================================
// コンテキスト型（式評価用）
// =============================================================================

/**
 * GitHub コンテキスト
 */
export interface GitHubContext {
  /** ワークフローを起動したイベント名 */
  event_name: string;
  /** イベントペイロード */
  event: Record<string, unknown>;
  /** Git リファレンス（ブランチ/タグ） */
  ref: string;
  /** リファレンス名（ブランチまたはタグ名） */
  ref_name: string;
  /** Git SHA（コミットハッシュ） */
  sha: string;
  /** リポジトリ所有者とリポジトリ名 */
  repository: string;
  /** リポジトリ所有者 */
  repository_owner: string;
  /** 実行者 */
  actor: string;
  /** ワークフロー名 */
  workflow: string;
  /** ジョブ名 */
  job: string;
  /** 実行 ID */
  run_id: string;
  /** 実行番号 */
  run_number: number;
  /** 再試行回数 */
  run_attempt: number;
  /** サーバー URL */
  server_url: string;
  /** API の URL */
  api_url: string;
  /** GraphQL の URL */
  graphql_url: string;
  /** ワークスペースパス */
  workspace: string;
  /** アクション名 */
  action: string;
  /** アクションパス */
  action_path: string;
  /** トークン */
  token: string;
  /** PR ヘッド参照 */
  head_ref?: string;
  /** PR ベース参照 */
  base_ref?: string;
}

/**
 * Runner コンテキスト
 */
export interface RunnerContext {
  /** ランナー名 */
  name: string;
  /** ランナー OS */
  os: "Linux" | "Windows" | "macOS";
  /** ランナーアーキテクチャ */
  arch: "X86" | "X64" | "ARM" | "ARM64";
  /** テンポラリディレクトリ */
  temp: string;
  /** ツールキャッシュディレクトリ */
  tool_cache: string;
  /** デバッグモード */
  debug: string;
}

/**
 * ジョブコンテキスト
 */
export interface JobContext {
  /** ジョブステータス */
  status: "success" | "failure" | "cancelled";
  /** コンテナ情報 */
  container?: {
    id: string;
    network: string;
  };
  /** サービスコンテナ */
  services?: Record<
    string,
    {
      id: string;
      network: string;
      ports: Record<string, string>;
    }
  >;
}

/**
 * Steps コンテキスト（直前ステップの結果）
 */
export type StepsContext = Record<
  string,
  {
    outputs: Record<string, string>;
    outcome: "success" | "failure" | "cancelled" | "skipped";
    conclusion: "success" | "failure" | "cancelled" | "skipped";
  }
>;

/**
 * Needs コンテキスト（依存ジョブの結果）
 */
export type NeedsContext = Record<
  string,
  {
    outputs: Record<string, string>;
    result: "success" | "failure" | "cancelled" | "skipped";
  }
>;

/**
 * Strategy コンテキスト
 */
export interface StrategyContext {
  "fail-fast": boolean;
  "job-index": number;
  "job-total": number;
  "max-parallel": number;
}

/**
 * Matrix コンテキスト
 */
export type MatrixContext = Record<string, unknown>;

/**
 * Inputs コンテキスト（workflow_dispatch 入力）
 */
export type InputsContext = Record<string, string | boolean | number>;

/**
 * 実行コンテキスト
 */
export interface ExecutionContext {
  github: GitHubContext;
  env: Record<string, string>;
  vars: Record<string, string>;
  secrets: Record<string, string>;
  runner: RunnerContext;
  job: JobContext;
  steps: StepsContext;
  needs: NeedsContext;
  strategy?: StrategyContext;
  matrix?: MatrixContext;
  inputs?: InputsContext;
}

// =============================================================================
// パーサー / スケジューラー型
// =============================================================================

/**
 * メタ情報付きの解析済みワークフロー
 */
export interface ParsedWorkflow {
  /** 解析済みワークフロー */
  workflow: Workflow;
  /** 解析エラー／警告 */
  diagnostics: WorkflowDiagnostic[];
}

/**
 * 診断の重大度
 */
export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * ワークフロー診断（error/warning）
 */
export interface WorkflowDiagnostic {
  /** 重大度 */
  severity: DiagnosticSeverity;
  /** エラー／警告メッセージ */
  message: string;
  /** YAML 上の場所 */
  path?: string;
  /** 行番号 */
  line?: number;
  /** カラム番号 */
  column?: number;
}

/**
 * ジョブ実行順序
 */
export interface ExecutionPlan {
  /** 実行フェーズごとのジョブ群（同一フェーズは並列実行） */
  phases: string[][];
}

/**
 * ステップ実行関数の型
 */
export type StepExecutor = (
  step: Step,
  context: ExecutionContext,
) => Promise<StepResult>;

/**
 * アクション解決関数の型
 */
export type ActionResolver = (
  uses: string,
) => Promise<{ run: StepExecutor } | null>;
