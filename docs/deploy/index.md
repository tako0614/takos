# デプロイ

Takos の deploy surface は 3 つに分かれます。

## 現在使うコマンド

| コマンド | 用途 |
| --- | --- |
| `takos plan` | local manifest の non-mutating preview |
| `takos apply` | local manifest と local artifact を upload して apply |
| `takos deploy` | repo/ref を source に app deployment を作成 |
| `takos install` | Store package release を source に app deployment を作成 |

## クイックスタート

```bash
takos apply --env staging
```

## 関連ページ

- [apply コマンド](/deploy/apply) - `takos apply` の詳細
- [Store 経由デプロイ](/deploy/store-deploy) - `takos deploy` / `takos install`
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
