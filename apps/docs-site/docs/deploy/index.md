# デプロイ

現在の実働 surface は `takos deploy-group` です。`takos deploy` と `/api/spaces/:spaceId/app-deployments` は docs 上の契約として残っていますが、このリポジトリの current implementation では end-to-end に接続されていません。

## 現在使える方法

| | `takos deploy-group` | `takos deploy` |
|---|---|---|
| 状態 | current | not currently wired |
| 用途 | ローカルからの直接デプロイ | Store / app-deployments 経由の将来 surface |
| 実行元 | ローカル CLI | Takos control plane |
| 認証 | Cloudflare API トークン | Takos 認証 |

現時点で使うべきなのは [deploy-group](/deploy/deploy-group) です。`takos deploy` を前提にした手順は未接続の implementation note として読んでください。

## クイックスタート

```bash
# ローカルからステージングにデプロイ
takos deploy-group --env staging

# Store 経由デプロイは current implementation では利用不可
takos deploy --space SPACE_ID --repo REPO_ID --ref main
```

## 関連ページ

- [deploy-group コマンド](/deploy/deploy-group) --- ローカルからの直接デプロイ
- [Store 経由デプロイ](/deploy/store-deploy) --- Store 公開・CI/CD 連携
- [Dispatch Namespace](/deploy/namespaces) --- マルチテナントデプロイ
- [ロールバック](/deploy/rollback) --- ロールバックの手順
- [トラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処
