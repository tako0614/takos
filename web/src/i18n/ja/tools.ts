export const tools = {
  // MCP Servers Section
  mcpServers: "MCP サーバー",
  mcpServersDescription:
    "worker と app 由来の MCP service は自動で表示されます。外部サーバーはここで追加します。",
  addMcpServer: "MCP サーバーを追加",
  noMcpServersYet: "接続された MCP サーバーはまだありません",
  managedMcpServersAutoConnected:
    "worker / app の MCP service は deploy または install 後に自動で表示されます。",
  inputJson: "入力 (JSON)",
  enable: "有効化",
  disable: "無効化",

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
  mcpReauthorizeAction: "再認証する",
  failedToReauthorizeMcpServer: "MCP サーバーの再認証に失敗しました",
  mcpStatusConnected: "接続済み",
  mcpStatusTokenExpired: "トークン期限切れ",
  mcpStatusDisabled: "無効",
  mcpStatusNoToken: "未認証",
  mcpNameInvalid: "名前は英字で始まり、英数字・_・-のみ（最大64文字）",
  mcpUrlInvalid: "有効なHTTPS URLを入力してください",
  mcpAdvanced: "詳細設定",
  mcpToolCount: "{count}個のツール",
} as const;
