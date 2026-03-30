# デプロイ

現在の正面入口は `takos apply` です。`.takos/app.yml` を読み取り、group 単位で resources、services、routes を反映します。

## 現在使うコマンド

| コマンド | 用途 |
| --- | --- |
| `takos apply` | manifest 全体を plan/apply |
| `takos worker deploy` | 単体 worker の deploy |
| `takos service deploy` | 単体 service の deploy |
| `takos resource ...` | resource の作成・bind・data-plane 操作 |

`takos deploy` と `app-deployments` API は legacy surface です。

## クイックスタート

```bash
takos apply --env staging
```

## 関連ページ

- [apply コマンド](/deploy/apply) - `takos apply` の詳細
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
