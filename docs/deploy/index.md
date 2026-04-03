# デプロイ

Takos をサービスとソフトウェアの民主化基盤として反映・配布するときの surface
をまとめた章です。local working tree からの `takos plan` / `takos apply`、
repository URL や catalog package からの `takos deploy` / `takos install`
をここで整理します。

## 現在使うコマンド

| コマンド          | 用途                                                                          |
| ----------------- | ----------------------------------------------------------------------------- |
| `takos plan`      | local manifest の non-mutating preview                                        |
| `takos apply`     | local manifest と local artifact を upload して apply                         |
| `takos deploy`    | repository URL を source に app deployment を作成                             |
| `takos install`   | catalog metadata で解決した repository URL を source に app deployment を作成 |
| `takos uninstall` | group を uninstall して managed resources を削除                              |

## クイックスタート

```bash
takos apply --env staging
```

## 関連ページ

- [apply コマンド](/deploy/apply) - `takos apply` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) - `takos deploy` /
  `takos install`
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
