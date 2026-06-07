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
export const PULL_REQUEST_EVENT_TYPES = [
  "assigned",
  "unassigned",
  "labeled",
  "unlabeled",
  "opened",
  "edited",
  "closed",
  "reopened",
  "synchronize",
  "converted_to_draft",
  "ready_for_review",
  "locked",
  "unlocked",
  "review_requested",
  "review_request_removed",
  "auto_merge_enabled",
  "auto_merge_disabled",
  "milestoned",
  "demilestoned",
  "enqueued",
  "dequeued",
] as const;

export type PullRequestEventType = (typeof PULL_REQUEST_EVENT_TYPES)[number];

/**
 * issues イベント種別
 *
 * GitHub Actions 互換: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#issues
 */
export const ISSUES_EVENT_TYPES = [
  "opened",
  "edited",
  "deleted",
  "transferred",
  "pinned",
  "unpinned",
  "closed",
  "reopened",
  "assigned",
  "unassigned",
  "labeled",
  "unlabeled",
  "locked",
  "unlocked",
  "milestoned",
  "demilestoned",
] as const;

export type IssuesEventType = (typeof ISSUES_EVENT_TYPES)[number];

/**
 * issue_comment イベント種別
 */
export const ISSUE_COMMENT_EVENT_TYPES = ["created", "edited", "deleted"] as const;

export type IssueCommentEventType = (typeof ISSUE_COMMENT_EVENT_TYPES)[number];

/**
 * release イベント種別
 */
export const RELEASE_EVENT_TYPES = [
  "published",
  "unpublished",
  "created",
  "edited",
  "deleted",
  "prereleased",
  "released",
] as const;

export type ReleaseEventType = (typeof RELEASE_EVENT_TYPES)[number];

/**
 * watch イベント種別
 */
export const WATCH_EVENT_TYPES = ["started"] as const;

export type WatchEventType = (typeof WATCH_EVENT_TYPES)[number];

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
// 実行結果の結論型
// =============================================================================

/**
 * 実行結果
 */
export type Conclusion = "success" | "failure" | "cancelled" | "skipped";

// =============================================================================
// スケジューラー展開コンテキスト型
// =============================================================================

/**
 * Strategy コンテキスト
 *
 * matrix 展開時に scheduler が組み立てる strategy メタ情報。
 */
export interface StrategyContext {
  "fail-fast": boolean;
  "job-index": number;
  "job-total": number;
  "max-parallel": number;
}

/**
 * Matrix コンテキスト
 *
 * matrix 展開された 1 組み合わせの値マップ。
 */
export type MatrixContext = Record<string, unknown>;

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
