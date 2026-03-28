# デプロイ

app.yml で定義したアプリを Cloudflare にデプロイします。

## 2 つの方法

| | `takos deploy-group` | `takos deploy` |
|---|---|---|
| 用途 | 開発・テスト | Store 公開 |
| 実行元 | ローカル CLI | Takos control plane |
| 認証 | Cloudflare API トークン | Takos 認証 |

開発中なら [deploy-group](/deploy/deploy-group)、Store に公開するなら [Store 経由](/deploy/store-deploy) を使ってください。

## クイックスタート

```bash
# ローカルからステージングにデプロイ
takos deploy-group --env staging

# Store 経由でデプロイ
takos deploy --space SPACE_ID --repo REPO_ID --ref main
```

## 関連ページ

- [deploy-group コマンド](/deploy/deploy-group) --- ローカルからの直接デプロイ
- [Store 経由デプロイ](/deploy/store-deploy) --- Store 公開・CI/CD 連携
- [Dispatch Namespace](/deploy/namespaces) --- マルチテナントデプロイ
- [ロールバック](/deploy/rollback) --- ロールバックの手順
- [トラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処
