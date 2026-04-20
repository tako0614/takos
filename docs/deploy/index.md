# デプロイ

Takos の deploy system は **primitive-first** です。worker / service / route /
publication / resource はそれぞれ個別の record として存在し、group
に所属しているかどうかで runtime や resource provider の扱いは変わりません。

- **Primitive** — deploy や管理の対象になる個別 record。workload、route、
  publication、resource、consume edge などを含む
- **Group** — primitive を任意に束ねる state scope。所属 primitive は
  inventory、group snapshot、rollback、uninstall、updates などの group
  機能を使える
- **Manifest** — primitive の desired declaration を書く入力ファイル。group
  専用形式ではなく、group 所属を付ける場合も付けない場合も同じ primitive
  declaration として扱う

group は便利な collection ですが、特権的な runtime ではありません。group なしの
primitive も同じ API / runtime model で扱います。group に所属すると、その
primitive が inventory、snapshot、rollback などの group 機能に参加できる
だけです。

## 現在使うコマンド

### deploy operations

| コマンド              | 用途                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `takos deploy`        | local manifest または repository URL から group inventory へ primitive declaration を apply |
| `takos deploy --plan` | `takos deploy` の group-scoped non-mutating preview（dry-run）                              |
| `takos install`       | `takos deploy` の sugar。catalog で owner/repo を解決して同じ pipeline を呼ぶ               |
| `takos rollback`      | group snapshot を再適用する group 機能                                                      |
| `takos uninstall`     | group に所属する manifest-managed primitive を削除し、group scope を閉じる                  |
| `takos group ...`     | group inventory / group-scoped declaration / group 機能の管理                               |
| `takos resource ...`  | resource primitive の個別管理                                                               |

### primitive operations

worker / service / route / publication / resource は個別 record
として追跡されます。resource は `takos resource` / `takos res`
で操作できます。compute / route / publication の個別 CRUD は control plane の
HTTP API で扱います。

`takos deploy` / `takos deploy --plan` は manifest や repository を入力にして、
明示した group inventory へ primitive declaration を apply / preview
する入口です。group なしの primitive は個別 primitive API / CLI で管理します。

## クイックスタート

```bash
takos deploy --env staging --space SPACE_ID --group my-app
```

group snapshot を使う deploy では group 名を必ず指定します:

```bash
takos deploy --plan --env staging --space SPACE_ID --group my-app
```

## 関連ページ

- [deploy コマンド](/deploy/deploy) - `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) - local / repo / catalog
  からの deploy
- [Deploy Group](/deploy/deploy-group) - group 機能と inventory
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
