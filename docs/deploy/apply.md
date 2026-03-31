# apply

`takos apply` は `.takos/app.yml` を読み取り、Cloudflare-native spec を group desired state として反映する正面入口です。runtime model は Takos runtime で、Cloudflare backend と互換 backend のどちらにも同じ spec を流します。

## 基本

```bash
takos apply --env staging
```

## 主なオプション

| option | 説明 |
| --- | --- |
| `--env <name>` | 反映先環境 |
| `--manifest <path>` | manifest path。既定は `.takos/app.yml` |
| `--auto-approve` | 確認プロンプトを省略 |
| `--target <key...>` | 一部だけ反映。例: `workers.web`, `resources.primary-db` |
| `--namespace <name>` | Dispatch namespace |
| `--group <name>` | 対象 group 名 |
| `--provider <provider>` | `cloudflare|local|aws|gcp|k8s`。`/groups/plan` と `/groups/apply` の対象 group に適用 |
| `--space <id>` | 対象 workspace ID |
| `--offline` | API を使わず local state で apply |

## 何をするか

1. `.takos/app.yml` か `--manifest` で指定した manifest を読み込む
2. desired app manifest を group desired として保存し、内部 canonical state に compile する
3. resources / services / routes の差分を計算する
4. provider translation report を出し、未接続 path は fail-fast で止める
5. group の desired / observed snapshot を更新する

## provider / env の更新

`takos apply` / `takos plan` が既存 group 名を指定した場合、`--provider` と `--env` は
当該 group を更新します（作成済み group への再指定で provider/env を切り替え可能）。

## translation report

`takos apply` は plan/apply の前に provider translation report を表示します。CLI では `Spec: Cloudflare-native` と `Runtime: Takos runtime` を前提に、どの backend でどう実現されるかを示します。

- `native`: Cloudflare backend 上で spec を直接実現できる
- `portable`: compatibility backend 上で spec を provider-backed または Takos-managed path で実現できる
- `unsupported`: current deploy pipeline には接続されておらず fail-fast で止まる

特に `aws` / `gcp` / `k8s` の group apply は、未接続の resource/workload/route が含まれると apply 前に失敗します。

## 例

```bash
takos apply --env production --target workers.web --target resources.primary-db
```

`takos worker deploy` と `takos service deploy` は単体ワークロード向け、`takos apply` は manifest 全体向けです。
