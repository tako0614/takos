# デプロイ

Takos の deploy compatibility surface は **Deployment-centric** です。compiled Shape manifest は 1 つの Deployment
record として resolve され、その Deployment が apply されると GroupHead が新しい Deployment を指します。current payload
は `resources[]` の Shape declarations が中心で、MCP / file handler / launcher などの app metadata は Takos app catalog
/ installer layer の surface です。group は Deployment を順序付ける compatibility state scope です。

> 現行実装の split status は
> [Current Implementation Note](https://github.com/tako0614/takosumi/blob/master/docs/reference/architecture/index.md#deploy-shell)
> を参照

::: warning Boundary note Takos product の primary surface は Web UI / public API です。git / workflow / manifest
authoring の CLI は `takosumi-git`、kernel への explicit manifest apply は `takosumi` が担当します。この章に残る
`takos deploy` 系の記述は 移行期間中の Takos CLI surface の説明であり、新しい primary UX として拡張しません。 :::

- **Deployment** — manifest snapshot + descriptor closure + desired state を 1 record として保持する core
  record。`preview` → `resolved` → `applying` → `applied` (もしくは `failed` / `rolled-back`) という state machine
  を持つ
- **GroupHead** — group ごとの current Deployment pointer。rollback は GroupHead を previous Deployment に切り替える
  pointer move
- **ProviderObservation** — provider 側の observed state stream。Deployment.desired に対する eventual consistency
  観測点であり、canonical state ではない
- **Manifest** — Deployment の input。current compiled Shape manifest は `resources[]` を書く。 author 向け 全体ガイドは
  [マニフェスト](/deploy/manifest)

group は便利な scope ですが、特権的な runtime ではありません。group を持たない primitive declaration も同じ Deployment
lifecycle を通ります。group に所属すると、 その primitive を含む Deployment が GroupHead 経由で履歴・rollback
の対象になります。

## 現在使うコマンド

### deploy operations

| コマンド                        | 用途                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `takos deploy`                  | local manifest または repository URL から resolve + apply (Heroku-like sugar)               |
| `takos deploy --preview`        | in-memory preview。Deployment record は持続化しない                                         |
| `takos deploy --resolve-only`   | resolved Deployment record だけ作って apply は保留する                                      |
| `takos apply <deployment-id>`   | resolved Deployment を apply に進める                                                       |
| `takos diff <deployment-id>`    | resolved Deployment の expansion / 現在 GroupHead との diff を表示                          |
| `takos approve <deployment-id>` | `require-approval` policy decision に approval を添付する                                   |
| `takos rollback [<group>]`      | group の GroupHead を previous Deployment に切り替える                                      |
| `takos install`                 | legacy sugar。catalog で owner/repo を解決して同じ compatibility Deployment pipeline を呼ぶ |
| `takos uninstall`               | group に所属する manifest-managed primitive を削除し、group scope を閉じる                  |
| `takos group ...`               | group inventory / GroupHead 状態の管理                                                      |
| `takos resource ...`            | resource primitive の個別管理                                                               |

### primitive operations

legacy component / route / publication / resource / binding は Takos compatibility Deployment.desired の field
として記録されます。 resource は `takos resource` / `takos res` で個別操作できます。legacy component / route /
publication の個別 CRUD は control plane の HTTP API で扱います。current launcher / MCP / file handler metadata は app
catalog / runtime registry の surface であり、kernel manifest の publications ではありません。

この compatibility surface の `takos deploy` は manifest や repository を入力として、Deployment record の作成と apply を
1 step で行う sugar です。reviewer flow が必要な場合は `takos deploy --resolve-only` で Deployment record
だけ作り、`takos diff` / `takos approve` / `takos apply` で確認・承認・適用を分離できます。

## クイックスタート

```bash
takos deploy --env staging --space SPACE_ID
```

3 行サマリ:

1. Takos compatibility CLI が `.takosumi/manifest.yml` を扱う場合でも、その project-layout / authoring convention は
   takosumi-git の所有です。kernel に渡るのは compiled Shape manifest だけです。旧 `.takos/app.yml` / `.takos/app.yaml`
   は後方互換 alias であり、新規 project の正本ではありません。`.takosumi/app.yml` (installer-bound、InstallableApp
   宣言) はこれとは別概念です
   ([`.takosumi/app.yml` Spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md))
2. `--preview` で持続化しない preview、`--resolve-only` で apply 待ち、 `--group NAME` で group 名を override
3. 詳細な lifecycle と option 一覧は [`takos deploy` の compatibility 入門](/deploy/deploy) を参照

::: tip Manifest 二段構造 Installable App Model では deploy manifest を 2 種に分けます:

- compiled manifest (kernel input Shape manifest): 詳細は
  [Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
- `.takosumi/manifest.yml` (takosumi-git-owned authoring compute manifest): `workflowRef` など installer-only extension
  は kernel 到達前に解決・除去される
- `.takosumi/app.yml` (installer-bound, Installable App declaration): 詳細は
  [`.takosumi/app.yml` Spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)

`takos deploy` compatibility path は compiled Shape manifest を Takosumi kernel apply pipeline に渡します。installer
pipeline (Git URL install) は `.takosumi/app.yml` を起点に `.takosumi/manifest.yml` を compile します。 :::

## 関連ページ

- [deploy コマンド](/deploy/deploy) - `takos deploy` / `takos apply` / `takos diff` / `takos approve` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) - local / repo / catalog からの Deployment
- [Deploy Group](/deploy/deploy-group) - group / GroupHead と inventory
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
