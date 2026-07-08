export const settings = {
  // Settings
  settingsTitle: "アカウント設定",
  email: "メールアドレス",
  name: "名前",
  language: "言語",

  // Workspace Settings
  workspaceSlug: "スペーススラッグ",

  // Members
  members: "メンバー",
  noMembers: "メンバーはまだいません",
  inviteMember: "メンバーを招待",
  memberInvited: "メンバーを招待しました",
  failedToInvite: "メンバーの招待に失敗しました",
  removeMember: "メンバーを削除",
  removeMemberWarning: "このメンバーをスペースから削除してもよろしいですか？",
  memberRemoved: "メンバーを削除しました",
  failedToRemove: "削除に失敗しました",
  memberUpdated: "メンバーの役割を更新しました",
  failedToUpdate: "更新に失敗しました",
  invite: "招待",
  emailPlaceholder: "email@example.com",
  roleOwner: "オーナー",
  roleAdmin: "管理者",
  roleMember: "メンバー",

  // Space aliases
  spaceSettings: "スペース設定",
  spaceInfo: "スペース情報",
  spaceSlug: "スペーススラッグ",
  spaceName: "スペース名",
  spaceNamePlaceholder: "マイスペース",
  selectSpace: "スペースを選択",
  selectSpaceHint: "スペースを選択して設定を表示",
  selectSpaceFirst: "先にスペースを選択してください",
  selectSpaceToChat: "チャットするスペースを選択してください",
  noSpacesAvailable: "利用可能なスペースがありません",
  spaceNotFound: "スペースが見つかりません",
  spaceNotFoundDesc: "お探しのスペースは存在しないか、アクセス権がありません。",
  personalSpaceNameHint: "個人スペースの名前は変更できません",
  personalSpaceNote:
    "これは個人スペースです。削除したり、他のユーザーと共有することはできません。",
  deleteSpace: "スペースを削除",
  deleteSpaceWarning:
    "このスペースを削除してもよろしいですか？この操作は取り消せません。すべてのデータが完全に削除されます。",
  deleteSpaceHint: "このスペースとすべてのデータを完全に削除",
  spaceDeleted: "スペースを削除しました",
  createSpace: "スペースを作成",
  createSpaceHint: "チームで作業するにはチームスペースを作成してください",
  installFeaturedAppsOnCreate: "おすすめアプリをインストールする",
  installFeaturedAppsOnCreateHint:
    "接続済みのアプリカタログから、運営者が選んだアプリを追加します。",
  spaceCreated: "スペースを作成しました",
  targetSpace: "対象スペース",

  // Settings Privacy
  privacyTitle: "プライバシー",
  privateAccount: "非公開アカウント",
  requireApprovalForFollowers: "新しいフォロワーの承認を必須にする。",
  activityVisibility: "アクティビティの公開範囲",
  visibilityPublic: "公開",
  visibilityFollowers: "フォロワーのみ",
  visibilityPrivate: "非公開",
} as const;
