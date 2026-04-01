# CLI Commands

Takos CLI の current surface の要約です。

`takos apply` / `takos plan` は `.takos/app.yml` を主要 authoring source として読み込み、group desired state に反映します。public spec は Cloudflare-native で、実行モデルは Takos runtime です。

## Top-level

| command | 説明 |
| --- | --- |
| `takos login` | CLI 認証 |
| `takos endpoint ...` | 接続先管理 |
| `takos plan` | `.takos/app.yml` の non-mutating preview |
| `takos apply` | `.takos/app.yml` を plan/apply |
| `takos deploy` | repo/ref を source に app deployment を作成 |
| `takos install` | Store package release を source に app deployment を作成 |
| `takos group ...` | group inventory の参照 |
| `takos api ...` | generic task command |

## `takos apply`

```bash
takos apply --env staging
```

| option | 説明 |
| --- | --- |
| `--env <name>` | 反映先環境 |
| `--manifest <path>` | manifest path。既定は `.takos/app.yml` |
| `--auto-approve` | 確認プロンプトを省略 |
| `--target <key...>` | 一部だけ反映。例: `workers.web`, `resources.primary-db` |
| `--provider <provider>` | `cloudflare|local|aws|gcp|k8s`。既存 group 指定時は `provider` を更新 |
| `--group <name>` | 対象 group 名。省略時は `metadata.name` |
| `--space <id>` | 対象 workspace ID |

## `takos plan`

| option | 説明 |
| --- | --- |
| `--env <name>` | ターゲット環境名 |
| `--manifest <path>` | manifest path。既定は `.takos/app.yml` |
| `--provider <provider>` | `cloudflare|local|aws|gcp|k8s`。既存 group 指定時は `provider` を更新 |
| `--group <name>` | 対象 group 名。省略時は `metadata.name` |
| `--space <id>` | 対象 workspace ID |

`takos plan` / `takos apply` は provider translation report を表示します。  
表示は `Spec: Cloudflare-native` と `Runtime: Takos runtime` を前提にしつつ、どの backend でその spec を実現するかを示します。未接続の provider/resource/workload/route が含まれる場合は fail-fast で終了します。

## `takos deploy`

| option | 説明 |
| --- | --- |
| `--repo <id>` | repo ID |
| `--ref <ref>` | branch / tag / commit |
| `--ref-type <type>` | `branch` / `tag` / `commit` |
| `--group <name>` | 対象 group 名 |
| `--env <name>` | target env |
| `--provider <provider>` | `cloudflare|local|aws|gcp|k8s` |
| `--space <id>` | 対象 workspace ID |
| `--json` | JSON 出力 |

サブコマンド:

| command | 説明 |
| --- | --- |
| `takos deploy status` | deployment 一覧 |
| `takos deploy status <id>` | deployment 詳細 |
| `takos deploy rollback <id>` | 前の成功 deployment へ戻す |

## `takos install`

```bash
takos install OWNER/REPO --space SPACE_ID --version v1.0.0
```

Store package release を source にして app deployment を作成します。

## `takos group`

| command | 説明 |
| --- | --- |
| `takos group list` | group 一覧 |
| `takos group show <name>` | group inventory 表示 |
| `takos group delete <name>` | 空の group を削除 |
| `takos group desired get <name>` | group の desired app manifest を取得 |
| `takos group desired put <name> --file app.yml` | group の desired app manifest を置換 |
