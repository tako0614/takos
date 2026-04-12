# デプロイ

Takos の deploy system は **二層モデル**:

- **Layer 1: primitive (foundation)** — compute / resource / route / publish。
  これは control plane の internal model で、public CLI から個別 CRUD は
  しない。公開契約は `publish` / `consume` ベースの manifest と API
  reference を読む
- **Layer 2: group (上位 bundling)** — primitive 群を束ねて bulk lifecycle と
  desired state management を提供する optional な仕組み。manifest deploy で
  自動作成

このページは Layer 2 (group bulk operation) のコマンドをまとめます。`takos deploy`
を中心に、`takos deploy --plan` での preview と `takos install` / `takos rollback`
/ `takos uninstall` の関係を整理します。

## 現在使うコマンド

### group bulk operations (Layer 2)

| コマンド              | 用途                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| `takos deploy`        | local manifest または repository URL から group を deploy（current preferred entrypoint） |
| `takos deploy --plan` | `takos deploy` の non-mutating preview（dry-run）                            |
| `takos install`       | `takos deploy` の sugar。catalog で owner/repo を解決して同じ pipeline を呼ぶ |
| `takos rollback`      | group の前回 snapshot を再適用                                                |
| `takos uninstall`     | group を uninstall して managed resources を削除                              |

### primitive 個別操作 (Layer 1)

primitive の個別操作は public CLI では提供しません。standalone primitive
や provider resource は control plane の internal API として扱います。詳細は
[CLI リファレンス](/reference/cli) と [API リファレンス](/reference/api) を
参照。

`takos deploy` / `takos deploy --plan` が current preferred flow です。
`takos apply` と `takos plan` は legacy compatibility command として残っています。

## クイックスタート

```bash
takos deploy --env staging --space SPACE_ID
```

## 関連ページ

- [deploy コマンド](/deploy/deploy) - `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) - local / repo / catalog
  からの deploy
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
