export const deploy = {
  // Resources
  resources: "リソース",
  noResources: "リソースがありません",
  createResource: "リソースを作成",
  shareResource: "共有",
  addDomain: "ドメインを追加",
  adding: "追加中...",
  add: "追加",

  // Worker Settings
  envVars: "環境変数",
  bindings: "バインディング",
  runtime: "ランタイム",
  varName: "変数名",
  varValue: "値",
  plainText: "プレーン",
  secret: "シークレット",
  saveEnvVars: "環境変数を保存",
  bindingsHint: "D1、R2、KVなどのリソースをワーカーにバインド",
  noBindings: "バインディングがありません",
  addBinding: "バインディングを追加",
  saveBindings: "バインディングを保存",
  compatibilityDate: "互換性日付",
  cpuLimit: "CPU制限",
  compatibilityFlags: "互換性フラグ",
  compatibilityFlagsHint: "カンマ区切りで入力",
  subrequestsLimit: "サブリクエスト制限",
  subrequestsHint: "外部APIコールの最大数",
  saveRuntime: "ランタイム設定を保存",
  hostname: "ホスト名",
  lastUpdated: "最終更新",
  loadingBindings: "バインディングを読み込み中",
  boundServices: "バインドされたサービス",

  // General Settings
  general: "基本情報",
  subdomain: "サブドメイン",
  saveSubdomain: "サブドメインを保存",
  currentUrl: "現在のURL",
  workerId: "ワーカーID",

  // Domain Settings
  domains: "ドメイン",
  platformDomain: "プラットフォームドメイン",
  noCustomDomains: "カスタムドメインがありません",
  domainAdded: "ドメインを追加しました",
  domainVerified: "ドメインを検証しました",
  verifyDomain: "DNS検証",
  verificationFailed: "検証に失敗しました",
  domainActive: "有効",
  domainPending: "DNS設定待ち",
  cnameInstruction: "DNSレコードを追加してください",
  dnsSetup: "DNS設定",
  recordLabel: "レコード",
  targetLabel: "ターゲット",

  // Deployment Detail
  status: "ステータス",
  open: "開く",
  customDomains: "カスタムドメイン",
  dangerZone: "危険ゾーン",
  saved: "保存しました",
  created: "作成しました",
  deleteResource: "リソースを削除",
  confirmDeleteResource: "このリソースを削除しますか？",
  type: "タイプ",

  // Workers
  workers: "ワーカー",
  noWorkers: "ワーカーがありません",
  deleteWorker: "ワーカーを削除",
  confirmDeleteWorker:
    "このワーカーを削除しますか？すべてのデータが失われます。",
  yurucommuWorkerDeleteWarning:
    "このWorkerはYurucommuに紐づいています。削除するとYurucommuインスタンスが動作しなくなる可能性があります。",
  retry: "再試行",
  failedToAddDomain: "ドメインの追加に失敗しました",
  stopped: "停止しました",

  // Deployment Logs
  deploymentHistory: "デプロイ履歴",
  deploymentEvents: "イベント",
  deploymentFailed: "デプロイ失敗",
  loadingDeploymentDetails: "デプロイ詳細を読み込み中...",
  versionLabel: "バージョン",
  bundleHash: "バンドルハッシュ",
  bundleSize: "バンドルサイズ",
  deployedBy: "デプロイ者",
  deployStatus_pending: "準備中",
  deployStatus_in_progress: "進行中",
  deployStatus_success: "成功",
  deployStatus_failed: "失敗",
  deployStatus_rolled_back: "ロールバック済み",
  routingStatus_active: "アクティブ",
  routingStatus_canary: "カナリア",
  routingStatus_rollback: "ロールバック",
  routingStatus_archived: "アーカイブ",
  confirmRollback: "ロールバック",
  rollbackWarning:
    "deployment v{version} にトラフィックを切り替えます（即時反映）。",
  rollback: "ロールバック",
  rollbackApplied: "ロールバックを適用しました",
  failedToRollback: "ロールバックに失敗しました",
  rollbackToVersion: "v{version} にロールバック",

  // Resource Bindings
  boundWorkers: "バインドされたワーカー",
  boundWorkersHint: "このリソースを使用しているワーカー",
  noBindingsHint: "現在このリソースにバインドされているワーカーはありません",
  removeBinding: "バインディングを削除",
  removeBindingFor: "{name} のバインディングを削除",
  bindingRemoved: "バインディングを削除しました",
  failedToRemoveBinding: "バインディングの削除に失敗しました",

  // Environment Variables & Secrets
  environmentVariables: "環境変数",
  envVarsDescription: "コードから参照できるプレーンテキストの環境変数です。",
  noEnvVars: "環境変数がありません",
  secrets: "シークレット",
  secretsDescription: "ログやUIでマスクされる暗号化されたシークレットです。",
  noSecrets: "シークレットがありません",
  addNewVariable: "新しい変数を追加",
  deleteEnvVar: "変数を削除",
  confirmDeleteEnvVar: "この環境変数を削除してもよろしいですか？",
  deleteSecret: "シークレットを削除",
  confirmDeleteSecret: "このシークレットを削除してもよろしいですか？",
  showSecret: "シークレットを表示",
  hideSecret: "シークレットを非表示",

  // Deploy Panel
  resourceCreated: "リソースを作成しました",
  resourceDeleted: "リソースを削除しました",

  // Deploy Sidebar
  repositories: "リポジトリ",

  // Create Resource Modal
  d1Database: "D1データベース",
  r2Storage: "R2ストレージ",
  kvStore: "KVストア",
  vectorizeIndex: "Vectorizeインデックス",
  workerResource: "ワーカー",
  resourceStatus_active: "アクティブ",
  resourceStatus_creating: "作成中",
  resourceStatus_error: "エラー",

  // R2 Browser
  r2LastModified: "更新日時",
  r2LoadMore: "さらに読み込む",
  r2DeleteConfirm: '"{key}" を削除してもよろしいですか？',

  // Detail Page
  overview: "概要",
  explorer: "エクスプローラー",
  browser: "ブラウザ",
  tables: "テーブル",
  noTables: "テーブルがありません",
  execute: "実行",
  result: "結果",
  noObjects: "オブジェクトがありません",
  size: "サイズ",
  createdAt: "作成日",
  resourceId: "リソースID",
  resourceSections: "リソースセクション",
  deleteResourceWarning:
    "この操作は取り消せません。関連するすべてのデータが削除されます。",
  yurucommuResourceDeleteWarning:
    "このリソースはYurucommuに紐づいています。削除するとYurucommuインスタンスが動作しなくなる可能性があります。",

  // Workers Tab
  useAgentToCreateWorker: "エージェントを使用してWorkerをデプロイしてください",

  // Resource Overview
  connectionInfo: "接続情報",
  loadingConnectionInfo: "接続情報を読み込み中...",
  connectionInfoNotAvailable: "接続情報はありません",
  resourceCredentials: "認証情報",
  resourceCredentialsManagedByAccounts:
    "リソース認証情報は Takosumi Accounts が AppGrant/AppBinding 認証情報として発行します。",
  resourceCredentialsNoLocalTokens:
    "この control UI ではリソースアクセストークンを作成しません。",
  copyConnectionField: "{field}をクリップボードにコピー",

  // D1 Explorer
  sqlConsole: "SQLコンソール",
  databaseTables: "データベーステーブル",
  loadingTables: "テーブルを読み込み中",
  tableList: "テーブル一覧",
  executeSqlQuery: "SQLクエリを実行",
  tableDataFor: "{table} のテーブルデータ",
  tableContents: "{table} の内容",
  queryFailed: "クエリに失敗しました",
} as const;
