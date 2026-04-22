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

  // App
  appName: "Takos",

  // Navigation
  primaryNavigation: "メインナビゲーション",
  storage: "ストレージ",
  deployNav: "デプロイ",
  groups: "グループ",
  groupsDescription: "デプロイで管理されるグループを確認します。",

  // Workspaces
  createWorkspace: "スペースを作成",
  createGroup: "グループを作成",
  groupName: "グループ名",
  groupNamePlaceholder: "my-app-production",
  groupCreated: "グループを作成しました",
  failedToCreateGroup: "グループの作成に失敗しました",
  failedToLoadGroups: "グループの読み込みに失敗しました",
  searchGroups: "グループを検索",
  noGroups: "グループがありません",
  noGroupsDescription:
    "manifest からデプロイされたアプリは group としてここに表示されます。",
  noGroupSelected: "グループを選択してください",
  desiredState: "Desired State",
  noDesiredState: "Desired state はまだありません",
  inventory: "インベントリ",
  workloads: "ワークロード",
  routes: "ルート",
  environment: "環境",
  lastApplied: "最終適用",
  updated: "更新日時",
  source: "ソース",
  noItems: "項目がありません",
  workspaceName: "スペース名",
  workspaceNamePlaceholder: "マイプロジェクト",
  description: "説明",
  descriptionPlaceholder: "スペースの説明を入力...",
  noDescription: "説明なし",
  creating: "作成中...",
  nameRequired: "名前は必須です",

  // Apps
  apps: "アプリ",

  // Discord-style UI
  personal: "パーソナル",

  // Errors
  unknownError: "不明なエラー",
  networkError: "ネットワークエラー",
  failedToCreate: "作成に失敗しました",
  failedToLoad: "読み込みに失敗しました",
  failedToSave: "保存に失敗しました",
  failedToDelete: "削除に失敗しました",
  workspaceNotFound: "スペースが見つかりません",
  workspaceNotFoundDesc: "スペースが存在しないか、アクセス権限がありません。",

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
  store: "ストア",

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

  // Profile
  noActivityYet: "アクティビティはまだありません",
  noPublicReposYet: "公開リポジトリはまだありません",
  noFollowRequests: "フォローリクエストはありません",
  noStarredReposYet: "スター付きリポジトリはまだありません",
  reject: "拒否",
  accept: "承認",
  new: "新規",
} as const;
