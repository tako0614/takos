export const settings = {
  // Settings
  settingsTitle: "アカウント設定",
  email: "メールアドレス",
  name: "名前",
  language: "言語",

  // Category Settings
  workspaceSlug: "カテゴリー ID",

  failedToUpdate: "更新に失敗しました",

  // Category aliases (internal keys retain the Space/Workspace API vocabulary)
  spaceSettings: "カテゴリー設定",
  categorySettings: "カテゴリー設定",
  categoryManagement: "カテゴリー管理",
  spaceInfo: "カテゴリー情報",
  spaceSlug: "カテゴリー ID",
  spaceName: "カテゴリー名",
  spaceNamePlaceholder: "仕事",
  selectSpace: "カテゴリーを選択",
  selectSpaceHint: "設定するカテゴリーを選択してください",
  selectSpaceFirst: "先にカテゴリーを選択してください",
  selectSpaceToChat: "チャットするカテゴリーを選択してください",
  noSpacesAvailable: "利用できるカテゴリーがありません",
  spaceNotFound: "カテゴリーが見つかりません",
  spaceNotFoundDesc: "お探しのカテゴリーは存在しないか、利用できません。",
  personalSpaceNameHint: "基本の場所の名前は変更できません",
  personalSpaceNote:
    "これはチャットとメモリーに使う基本の場所です。削除できません。",
  workspaceSecurity: "カテゴリーのセキュリティ",
  workspaceNetworkAccess: "外部ネットワークアクセス",
  workspaceSecurityStandard: "標準",
  workspaceSecurityStandardHint:
    "このカテゴリーで設定した外部 HTTP ツールをエージェントが利用できます。",
  workspaceSecurityRestrictedEgress: "外部 HTTP 通信を制限",
  workspaceSecurityRestrictedEgressHint:
    "一般の外部 HTTP ツールを非表示にして実行を拒否します。このカテゴリーのストレージや Git は引き続き利用できます。",
  deleteSpace: "カテゴリーを削除",
  deleteSpaceWarning:
    "空のカテゴリー「{name}」を削除しますか？この操作は取り消せません。チャット、ストレージ、Git データ、アプリ、Capsule、管理対象リソースが残っている場合、Takos は削除を拒否します。",
  typeWorkspaceNameToConfirm:
    "削除を確定するにはカテゴリー名を正確に入力してください",
  typeToConfirm: "確定するには指定された文字列を入力してください",
  deleteSpaceHint: "空にしたカテゴリーを完全に削除",
  spaceDeleted: "カテゴリーを削除しました",
  createCategory: "カテゴリーを作成",
  createCategoryHint:
    "仕事・生活・趣味など、情報を混ぜたくない用途ごとに自分だけの場所を作ります。",
  categoryName: "カテゴリー名",
  categoryNamePlaceholder: "例: 仕事、暮らし、趣味",
  categoryDescriptionPlaceholder: "このカテゴリーで扱うこと（任意）",
  installFeaturedAppsOnCreate: "おすすめアプリをインストールする",
  installFeaturedAppsOnCreateHint:
    "接続済みのアプリカタログから、運営者が選んだアプリを追加します。",
  categoryCreated: "カテゴリーを作成しました",
  workspaceSavedRefreshFailed:
    "カテゴリーは保存されましたが、一覧を更新できませんでした。再読み込みして最新状態を確認してください。",
  workspaceCreatedRefreshFailed:
    "カテゴリーは作成されましたが、一覧を更新できませんでした。再読み込みして確認してください。",
  workspaceDeletedRefreshFailed:
    "カテゴリーは削除されましたが、一覧を更新できませんでした。再読み込みして一覧を更新してください。",
  targetSpace: "対象カテゴリー",
} as const;
