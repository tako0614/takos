# apply

`takos apply` は `.takos/app.yml` を読み取り、group 単位で resources、services、routes を reconcile する正面入口です。

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
| `--space <id>` | 対象 workspace ID |
| `--offline` | API を使わず local state で apply |

## 何をするか

1. `.takos/app.yml` を読み込む
2. desired app manifest を group desired として保存し、内部 canonical state に compile する
3. resources / services / routes の差分を計算する
4. provider translation report を出し、未接続 path は fail-fast で止める
5. group の desired / observed snapshot を更新する

## translation report

`takos apply` は plan/apply の前に provider translation report を表示します。

- `native`: 現在の provider path でそのまま実行できる
- `portable`: current codebase で portability backend / adapter に接続済み
- `planned` / `unsupported`: current deploy pipeline には未接続なので fail-fast で止まる

特に `aws` / `gcp` / `k8s` の group apply は、未接続の resource/workload/route が含まれると apply 前に失敗します。

## 例

```bash
takos apply --env production --target workers.web --target resources.primary-db
```

`takos worker deploy` と `takos service deploy` は単体ワークロード向け、`takos apply` は manifest 全体向けです。
