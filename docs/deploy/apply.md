# apply / plan (compatibility)

`takos apply` と `takos plan` は legacy compatibility command です。 current
preferred flow は `takos deploy` と `takos deploy --plan` です。

## 移行先

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- ローカル / repo /
  catalog からの deploy
- [ロールバック](/deploy/rollback) --- `takos rollback GROUP_NAME --space SPACE_ID` の手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド

## 旧コマンドの読み替え

| 旧コマンド | 新コマンド |
| --- | --- |
| `takos apply` | `takos deploy --space SPACE_ID` |
| `takos plan` | `takos deploy --plan --space SPACE_ID` |
| `takos apply --env staging` | `takos deploy --env staging --space SPACE_ID` |
| `takos apply --target web` | `takos deploy --target web --space SPACE_ID` |
