# デプロイ

Takos の deploy system は **二層モデル**:

- **Layer 1: primitive (foundation)** — compute / storage / route / publish。
  task-oriented CLI (`takos service`, `takos resource`, ...) で個別 CRUD。詳細は
  [CLI リファレンス](/reference/cli#primitive-個別操作) を参照
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
| `takos deploy`        | local manifest または repository URL から group を deploy（唯一の deploy entrypoint） |
| `takos deploy --plan` | `takos deploy` の non-mutating preview（dry-run）                            |
| `takos install`       | `takos deploy` の sugar。catalog で owner/repo を解決して同じ pipeline を呼ぶ |
| `takos rollback`      | group の前回 snapshot を再適用                                                |
| `takos uninstall`     | group を uninstall して managed resources を削除                              |

### primitive 個別操作 (Layer 1)

`takos service` / `takos resource` / `takos worker` などの task-oriented CLI で
primitive を個別に CRUD できます。詳細は
[CLI リファレンス - Primitive 個別操作](/reference/cli#primitive-個別操作) を参照。

`takos apply` は廃止され、`takos deploy` に統合されました。
`takos plan` という standalone command はありません。preview は `takos deploy --plan` を使ってください。

## クイックスタート

```bash
takos deploy --env staging
```

## 関連ページ

- [deploy コマンド](/deploy/deploy) - `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) - local / repo / catalog
  からの deploy
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
