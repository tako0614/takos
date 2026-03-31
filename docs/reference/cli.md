# CLI Commands

Takos CLI の current surface の要約です。

`takos apply` / `takos plan` は `.takos/app.yml` を主要 authoring source として読み込み、group desired state に反映します。public spec は Cloudflare-native で、実行モデルは Takos runtime です。

## Top-level

| command | 説明 |
| --- | --- |
| `takos apply` | `.takos/app.yml` を plan/apply |
| `takos worker ...` | Worker runtime workload の操作 |
| `takos service ...` | Service workload の操作 |
| `takos resource ...` | resource の作成・bind・data-plane 操作 |
| `takos group ...` | group inventory の参照 |
| `takos endpoint ...` | 接続先管理 |

`takos deploy` は legacy contract です。

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
| `--namespace <name>` | Dispatch namespace |
| `--provider <provider>` | `cloudflare|local|aws|gcp|k8s`。既存 group 指定時は `provider` を更新 |
| `--group <name>` | 対象 group 名。省略時は `metadata.name` |
| `--space <id>` | 対象 workspace ID |
| `--account-id <id>` | Cloudflare account ID |
| `--api-token <token>` | Cloudflare API token |
| `--compatibility-date <date>` | Worker compatibility date |
| `--base-domain <domain>` | template 解決用 base domain |
| `--offline` | API を使わず local state で apply |

## `takos plan`

| option | 説明 |
| --- | --- |
| `--env <name>` | ターゲット環境名 |
| `--manifest <path>` | manifest path。既定は `.takos/app.yml` |
| `--provider <provider>` | `cloudflare|local|aws|gcp|k8s`。既存 group 指定時は `provider` を更新 |
| `--group <name>` | 対象 group 名。省略時は `metadata.name` |
| `--space <id>` | 対象 workspace ID |
| `--offline` | API を使わず local state で plan |

`takos plan` / `takos apply` は provider translation report を表示します。  
表示は `Spec: Cloudflare-native` と `Runtime: Takos runtime` を前提にしつつ、どの backend でその spec を実現するかを示します。未接続の provider/resource/workload/route が含まれる場合は fail-fast で終了します。

## `takos resource`

| command | 説明 |
| --- | --- |
| `takos resource create --type d1` | resource 作成 |
| `takos resource attach <name> --group <name>` | resource を group に所属させる |
| `takos resource detach <name>` | resource を standalone に戻す |
| `takos resource bind` | service/workload に bind |
| `takos resource unbind` | bind 削除 |
| `takos resource sql query` | SQL 実行 |
| `takos resource object ls|get|put|rm` | object store 操作 |
| `takos resource kv ls|get|put|rm` | KV 操作 |

## `takos worker` / `takos service`

| command | 説明 |
| --- | --- |
| `takos worker deploy <name>` | worker deploy |
| `takos worker attach <name> --group <name>` | worker を group に所属させる |
| `takos worker detach <name>` | worker を standalone に戻す |
| `takos service deploy <name>` | service deploy |
| `takos service attach <name> --group <name>` | service を group に所属させる |
| `takos service detach <name>` | service を standalone に戻す |

個別 deploy は group apply の別実装ではなく、first-class workload surface です。

## `takos group`

| command | 説明 |
| --- | --- |
| `takos group list` | group 一覧 |
| `takos group show <name>` | group inventory 表示 |
| `takos group delete <name>` | 空の group を削除 |
| `takos group desired get <name>` | group の desired app manifest を取得 |
| `takos group desired put <name> --file app.yml` | group の desired app manifest を置換 |
