# apply (廃止)

::: danger このページは廃止されました
`takos apply` は廃止され、`takos deploy` に統合されました。 ローカル manifest からの
deploy も repository URL からの deploy も、すべて `takos deploy` で行います。
:::

## 移行先

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- ローカル / repo /
  catalog からの deploy
- [ロールバック](/deploy/rollback) --- `takos rollback GROUP_NAME` の手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド

## 旧コマンドの読み替え

| 旧コマンド | 新コマンド |
| --- | --- |
| `takos apply` | `takos deploy` |
| `takos apply --env staging` | `takos deploy --env staging` |
| `takos apply --target compute.web` | `takos deploy --target compute.web` |
| `takos deploy rollback APP_DEPLOYMENT_ID` | `takos rollback GROUP_NAME` |
