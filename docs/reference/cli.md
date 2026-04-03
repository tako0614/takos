# CLI

Takos CLI は、認証、アプリ構成の preview/apply、repository deploy、group
inventory など Takos の public surface を操作する入口です。

`.takos/app.yml` を直接扱うのは `takos plan` / `takos apply` で、`takos deploy`
/ `takos install` は repository / catalog 経由の deploy surface
を扱います。public spec は Cloudflare-native で、実行モデルは Takos runtime
です。

`takos apply` は source projection を更新しますが、app deployment history record
は作りません。local working tree 由来の apply では `currentAppDeploymentId` は
意図的に `null` のままです。

## Top-level

| command              | 説明                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `takos login`        | CLI 認証                                                                      |
| `takos endpoint ...` | 接続先管理                                                                    |
| `takos plan`         | `.takos/app.yml` の non-mutating preview                                      |
| `takos apply`        | `.takos/app.yml` を plan/apply                                                |
| `takos deploy`       | repository URL を source に app deployment を作成                             |
| `takos install`      | catalog metadata で解決した repository URL を source に app deployment を作成 |
| `takos uninstall`    | group を terminal uninstall して managed resources を削除                     |
| `takos group ...`    | group inventory の参照                                                        |
| `takos api ...`      | generic task command                                                          |

## `takos apply`

```bash
takos apply --env staging
```

| option                  | 説明                                                    |
| ----------------------- | ------------------------------------------------------- |
| `--env <name>`          | 反映先環境                                              |
| `--manifest <path>`     | manifest path。既定は `.takos/app.yml`                  |
| `--auto-approve`        | 確認プロンプトを省略                                    |
| `--target <key...>`     | 一部だけ反映。例: `workers.web`, `resources.primary-db` |
| `--provider <provider>` | `cloudflare`, `local`, `aws`, `gcp`, `k8s`              |
| `--group <name>`        | 対象 group 名。省略時は `metadata.name`                 |
| `--space <id>`          | 対象 workspace ID                                       |

## `takos plan`

| option                  | 説明                                       |
| ----------------------- | ------------------------------------------ |
| `--env <name>`          | ターゲット環境名                           |
| `--manifest <path>`     | manifest path。既定は `.takos/app.yml`     |
| `--provider <provider>` | `cloudflare`, `local`, `aws`, `gcp`, `k8s` |
| `--group <name>`        | 対象 group 名。省略時は `metadata.name`    |
| `--space <id>`          | 対象 workspace ID                          |

`takos plan` / `takos apply` は provider translation report を表示します。\
表示は `Spec: Cloudflare-native` と `Runtime: Takos runtime`
を前提にしつつ、どの backend でその spec を実現するかを示します。未接続の
provider/resource/workload/route が含まれる場合は fail-fast で終了します。

## `takos deploy`

```bash
takos deploy https://github.com/acme/my-app.git --space SPACE_ID --ref main
```

| option                     | 説明                                       |
| -------------------------- | ------------------------------------------ |
| positional `repositoryUrl` | canonical HTTPS git repository URL         |
| `--ref <ref>`              | branch / tag / commit                      |
| `--ref-type <type>`        | `branch` / `tag` / `commit`                |
| `--group <name>`           | 対象 group 名                              |
| `--env <name>`             | target env                                 |
| `--provider <provider>`    | `cloudflare`, `local`, `aws`, `gcp`, `k8s` |
| `--space <id>`             | 対象 workspace ID                          |
| `--json`                   | JSON 出力                                  |

サブコマンド:

| command                      | 説明                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `takos deploy status`        | deployment 一覧                                                   |
| `takos deploy status <id>`   | deployment 詳細                                                   |
| `takos deploy rollback <id>` | 保存済み snapshot を既存 group に再適用する。group が無ければ失敗 |

## `takos install`

```bash
takos install OWNER/REPO --space SPACE_ID --version v1.0.0
```

catalog metadata から `repository_url + release tag` を解決して app deployment
を作成します。target workspace に Store app が install
されている必要はありません。

内部では catalog metadata から `repository_url + release tag` を引いて
`takos deploy` と同じ API を呼びます。

## `takos uninstall`

```bash
takos uninstall GROUP_NAME --space SPACE_ID
```

group の desired state を empty に apply し、managed resources を削除してから
group row も削除します。`takos uninstall` は terminal 操作で、あとから rollback
で deleted group を再生成することはできません。

## `takos group`

| command                                         | 説明                                 |
| ----------------------------------------------- | ------------------------------------ |
| `takos group list`                              | group 一覧                           |
| `takos group show <name>`                       | group inventory 表示                 |
| `takos group delete <name>`                     | 空の group を削除                    |
| `takos group desired get <name>`                | group の desired app manifest を取得 |
| `takos group desired put <name> --file app.yml` | group の desired app manifest を置換 |
