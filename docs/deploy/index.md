# デプロイ

Takos の deploy system は **Deployment-centric** です。authoring manifest は
1 つの Deployment record として resolve され、その Deployment が apply されると
GroupHead が新しい Deployment を指します。worker / service / route / publication
/ resource は Deployment.desired の field として束ねられ、group は Deployment
を順序付ける compatibility state scope です。

> 現行実装の split status は [Current Implementation Note](/takos-paas/current-state#deploy-shell) を参照

- **Deployment** — manifest snapshot + descriptor closure + desired state を
  1 record として保持する core record。`preview` → `resolved` → `applying` →
  `applied` (もしくは `failed` / `rolled-back`) という state machine を持つ
- **GroupHead** — group ごとの current Deployment pointer。rollback は GroupHead
  を previous Deployment に切り替える pointer move
- **ProviderObservation** — provider 側の observed state stream。Deployment.desired
  に対する eventual consistency 観測点であり、canonical state ではない
- **Manifest** — Deployment の input。primitive desired declaration (worker /
  service / resource / route / publication / consume) を書く

group は便利な scope ですが、特権的な runtime ではありません。group を持たない
primitive declaration も同じ Deployment lifecycle を通ります。group に所属すると、
その primitive を含む Deployment が GroupHead 経由で履歴・rollback の対象になります。

## 現在使うコマンド

### deploy operations

| コマンド                       | 用途                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `takos deploy`                 | local manifest または repository URL から resolve + apply (Heroku-like sugar)            |
| `takos deploy --preview`       | in-memory preview。Deployment record は持続化しない                                      |
| `takos deploy --resolve-only`  | resolved Deployment record だけ作って apply は保留する                                   |
| `takos apply <deployment-id>`  | resolved Deployment を apply に進める                                                    |
| `takos diff <deployment-id>`   | resolved Deployment の expansion / 現在 GroupHead との diff を表示                       |
| `takos approve <deployment-id>`| `require-approval` policy decision に approval を添付する                                |
| `takos rollback [<group>]`     | group の GroupHead を previous Deployment に切り替える                                   |
| `takos install`                | `takos deploy` の sugar。catalog で owner/repo を解決して同じ Deployment pipeline を呼ぶ |
| `takos uninstall`              | group に所属する manifest-managed primitive を削除し、group scope を閉じる               |
| `takos group ...`              | group inventory / GroupHead 状態の管理                                                   |
| `takos resource ...`           | resource primitive の個別管理                                                            |

### primitive operations

worker / service / route / publication / resource は Deployment.desired
の field として記録されます。resource は `takos resource` / `takos res`
で個別操作できます。compute / route / publication の個別 CRUD は control plane の
HTTP API で扱います。

`takos deploy` は manifest や repository を入力として、Deployment record の作成と
apply を 1 step で行う sugar です。reviewer flow が必要な場合は
`takos deploy --resolve-only` で Deployment record だけ作り、`takos diff` /
`takos approve` / `takos apply` で確認・承認・適用を分離できます。

## クイックスタート

```bash
takos deploy --env staging --space SPACE_ID
```

3 行サマリ:

1. ローカル `.takos/app.yml` を読んで Deployment を resolve + apply (default)
2. `--preview` で持続化しない preview、`--resolve-only` で apply 待ち、
   `--group NAME` で group 名を override
3. 詳細な lifecycle と option 一覧は [`takos deploy` の canonical 入門](/deploy/deploy) を参照

## 関連ページ

- [deploy コマンド](/deploy/deploy) - `takos deploy` / `takos apply` / `takos diff` /
  `takos approve` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) - local / repo / catalog
  からの Deployment
- [Deploy Group](/deploy/deploy-group) - group / GroupHead と inventory
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
