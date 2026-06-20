export const common = {
  // Common
  loading: "読み込み中...",
  save: "保存",
  cancel: "キャンセル",
  delete: "削除",
  create: "作成",
  edit: "編集",
  copy: "コピー",
  close: "閉じる",
  dialog: "ダイアログ",
  confirm: "確認",
  refresh: "更新",
  search: "検索",
  settings: "設定",
  logout: "ログアウト",
  all: "すべて",
  notFound: "見つかりません",
  passwordRequired: "パスワードが必要です",
  enterPasswordToView:
    "共有されたスレッドを表示するにはパスワードを入力してください。",
  unlock: "解除",
  shareNotAvailable: "この共有リンクは利用できません。",
  noMessages: "メッセージがありません。",
  revoke: "無効化",
  revoked: "無効",
  noShareLinks: "共有リンクはまだありません。",
  move: "移動",
  moved: "移動しました",
  loadingContent: "コンテンツを読み込み中",
  unexpectedErrorTitle: "問題が発生しました",
  unexpectedErrorDescription:
    "予期しないエラーが発生しました。もう一度お試しください。",
  tryAgain: "もう一度試す",
  breadcrumbLabel: "パンくずリスト",
  breadcrumbMoreItems: "その他の項目を表示",
  goBack: "戻る",
  noSpaceAvailable: "利用できるスペースがありません",
  sortLabel: "並び替え:",
  newest: "新着順",
  loadMore: "さらに読み込む",
  remove: "削除",
  install: "インストール",
  connect: "接続",
  disconnect: "切断",
  active: "有効",
  subscribed: "購読中",
  queryResult: "クエリ結果",
  spaceNavigation: "スペースナビゲーション",
  mainNavigation: "メインナビゲーション",
  resourceStatusLabel: "ステータス: {status}",
  avatar: "アバター",
  avatarAlt: "{name}のアバター",
  unknownAuthor: "不明",
  selectOption: "選択してください",

  // App
  appName: "Takos",

  // Navigation
  primaryNavigation: "メインナビゲーション",
  storage: "ストレージ",
  deployNav: "デプロイ",

  // Inventory
  inventory: "インベントリ",

  // Space create
  description: "説明",
  descriptionPlaceholder: "スペースの説明を入力...",
  creating: "作成中...",
  nameRequired: "名前は必須です",

  // Apps
  apps: "アプリ",
  appTypePlatform: "プラットフォーム",
  appTypeCustom: "カスタム",
  appStatusUnknown: "不明",
  appStatusDeployed: "デプロイ済み",
  appStatusActive: "有効",
  appStatusFailed: "失敗",
  appStatusError: "エラー",
  appStatusDegraded: "劣化",
  appStatusPending: "待機中",
  appStatusQueued: "キュー中",
  appStatusInProgress: "進行中",
  appStatusPaused: "一時停止",
  failedToLoadApps: "アプリの読み込みに失敗しました",

  // Discord-style UI
  personal: "パーソナル",

  // Errors
  unknownError: "不明なエラー",
  networkError: "ネットワークエラー",
  failedToCreate: "作成に失敗しました",
  failedToLoad: "読み込みに失敗しました",
  failedToSave: "保存に失敗しました",
  failedToDelete: "削除に失敗しました",
  requestTimedOut: "リクエストがタイムアウトしました",
  authenticationRequired: "認証が必要です",
  requestFailed: "リクエストに失敗しました",
  billingQuotaExceeded: "利用上限に達しました",

  // Confirmation Dialog
  confirmDelete: "削除の確認",
  confirmDeleteThread: "このチャットを削除しますか？",
  confirmDeleteMemory: "このメモリを削除しますか？",
  confirmDeleteReminder: "このリマインダーを削除しますか？",
  confirmDeleteSkill: "このスキルを削除しますか？",
  confirmDeleteDomain: "このドメインを削除しますか？",
  deleteDomain: "ドメインを削除",
  deleteWarning: "この操作は取り消せません",

  // Toast Notifications
  success: "成功",
  error: "エラー",
  operationFailed: "操作に失敗しました",

  // Profile Menu
  profileMenu: "プロフィールメニュー",
  accountSettings: "アカウント設定",
  legalInfo: "規約・プライバシー",
  notFoundMessage: "ページが見つかりませんでした。",
  backToHome: "ホームに戻る",
  openInNewTab: "新しいタブで開く",

  // Fork
  forking: "フォーク中...",

  // Deployments
  noDeployments: "デプロイがありません",

  // Tools
  version: "バージョン",

  // Markdown
  copyCode: "コードをコピー",
  copyFailed: "コピーに失敗しました",

  // Navigation
  store: "ソース",

  // Sidebar
  deleteThread: "スレッドを削除",
  archiveThread: "アーカイブ",
  unarchiveThread: "アーカイブ解除",
  collapseThreads: "スレッドを折りたたむ",
  expandThreads: "スレッドを展開",
  projects: "プロジェクト",
  noProjects: "プロジェクトなし",
  noThreadsYet: "スレッドなし",
  repos: "リポジトリ",

  updatedDate: "更新 {date}",
  userNotFound: "ユーザーが見つかりません",
  failedToLoadRepositories: "リポジトリの読み込みに失敗しました",
  infrastructure: "インフラ",
  reject: "拒否",
  accept: "承認",
  new: "新規",
} as const;
