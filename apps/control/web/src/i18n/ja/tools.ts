export const tools = {
  // Packages
  packageLabel: "パッケージ",

  // Custom Tools
  customTools: "カスタムツール",

  // Packages Section
  install: "インストール",
  installingPackage: "インストール中...",
  noPackagesInstalled: "デプロイスナップショットはまだありません",
  shortcutGroups: "ショートカットグループ",
  uiExtensions: "UI拡張",

  // Custom Tools Section
  addTool: "ツールを追加",
  noCustomToolsYet: "カスタムツールがまだありません",
  createFirstTool: "最初のWorkerツールを作成",
  mcpServers: "MCP サーバー",
  mcpServersDescription:
    "worker と group deployment 由来の managed MCP は自動で表示されます。外部サーバーはここで追加します。",
  addMcpServer: "MCP サーバーを追加",
  noMcpServersYet: "接続された MCP サーバーはまだありません",
  managedMcpServersAutoConnected:
    "managed worker / deployment の MCP は deploy または install 後に自動で表示されます。",
  inputJson: "入力 (JSON)",
  enable: "有効化",
  disable: "無効化",
  test: "テスト",
  executionFailed: "実行に失敗しました",

  // Create Tool Modal
  createCustomTool: "Workerツールを作成",
  editTool: "Workerツールを編集",
  toolNameSnakeCase: "ツール名 (スネークケース)",
  toolDescriptionPlaceholder: "このツールの機能を説明してください",
  parameterDescriptionPlaceholder: "このパラメータの説明",
  toolType: "タイプ",
  inputParameters: "入力パラメータ",
  noParametersDefined: "パラメータが定義されていません",
  addParameter: "パラメータを追加",
  requiredField: "必須",
  schemaTypeString: "文字列",
  schemaTypeNumber: "数値",
  schemaTypeBoolean: "真偽値",
  schemaTypeArray: "配列",
  schemaTypeObject: "オブジェクト",
  nameAlreadyExists: "名前が既に存在します",
  nameCannotBeChanged: "名前 (変更不可)",
  workerIdCannotBeChanged: "Worker ID (変更不可)",
  saveChanges: "変更を保存",

  // Custom Tools Hook
  failedToLoadTool: "ツールの読み込みに失敗しました",
  toolCreated: "ツールを作成しました",
  failedToCreateTool: "ツールの作成に失敗しました",
  toolUpdated: "ツールを更新しました",
  failedToUpdateTool: "ツールの更新に失敗しました",
  deleteToolTitle: "ツールを削除",
  deleteToolConfirm: "「{name}」を削除してもよろしいですか？",
  toolDeleted: "ツールを削除しました",
  failedToDeleteTool: "ツールの削除に失敗しました",
  failedToToggleTool: "ツールの切り替えに失敗しました",

  // Deployment Snapshot Hook
  failedToLoadGroupDeploymentSnapshot:
    "デプロイスナップショットの読み込みに失敗しました",
  removeGroupDeploymentSnapshot: "デプロイスナップショットを削除",
  removeGroupDeploymentSnapshotConfirm:
    "「{name}」と関連するMCPサーバー、ショートカット、UI拡張を削除しますか？",
  groupDeploymentSnapshotRemoved: "デプロイスナップショットを削除しました",
  failedToRemoveGroupDeploymentSnapshot:
    "デプロイスナップショットの削除に失敗しました",
  rollbackGroupDeploymentSnapshot: "デプロイスナップショットをロールバック",
  rollbackGroupDeploymentSnapshotConfirm:
    "「{name}」を前回の成功したデプロイに戻しますか？",
  rolledBackName: "「{name}」をロールバックしました",
  rollbackFailed: "ロールバックに失敗しました",

  // MCP Servers Hook
  failedToFetchMcpServers: "MCPサーバーの取得に失敗しました",
  failedToCreateMcpServer: "MCPサーバーの作成に失敗しました",
  failedToUpdateMcpServer: "MCPサーバーの更新に失敗しました",
  failedToFetchTools: "ツールの取得に失敗しました",
  missingSpaceId: "スペースIDがありません",
  removeMcpServer: "MCPサーバーを削除",
  removeMcpServerConfirm: "このスペースから「{name}」を削除しますか？",
  failedToRemoveMcpServer: "MCPサーバーの削除に失敗しました",

  // MCP
  mcpServerTools: "ツール",
  mcpNoTools: "利用可能なツールはありません",
  mcpFetchingTools: "ツール取得中...",
  mcpFetchToolsFailed: "ツールの取得に失敗しました",
  mcpRefreshTools: "ツールを更新",
  mcpReauthorize: "再認証",
  mcpStatusConnected: "接続済み",
  mcpStatusTokenExpired: "トークン期限切れ",
  mcpStatusDisabled: "無効",
  mcpStatusNoToken: "未認証",
  mcpNameInvalid: "名前は英字で始まり、英数字・_・-のみ（最大64文字）",
  mcpUrlInvalid: "有効なHTTPS URLを入力してください",
  mcpAdvanced: "詳細設定",
  mcpToolCount: "{count}個のツール",
} as const;
