# apply

`takos apply` は `.takos/app.yml` を読み取り、ローカル source を control plane
に渡して group desired state として反映する正面入口です。runtime model は Takos
runtime で、Cloudflare backend と互換 backend のどちらにも同じ spec を流します。

## 基本

```bash
takos apply --env staging
```

## 主なオプション

| option                  | 説明                                                    |
| ----------------------- | ------------------------------------------------------- |
| `--env <name>`          | 反映先環境                                              |
| `--manifest <path>`     | manifest path。既定は `.takos/app.yml`                  |
| `--auto-approve`        | 確認プロンプトを省略                                    |
| `--target <key...>`     | 一部だけ反映。例: `workers.web`, `resources.primary-db` |
| `--group <name>`        | 対象 group 名                                           |
| `--provider <provider>` | `cloudflare`, `local`, `aws`, `gcp`, `k8s`              |
| `--space <id>`          | 対象 workspace ID                                       |

## plan と apply の境界

1. `.takos/app.yml` か `--manifest` で指定した manifest を読み込む
2. `takos plan` で non-mutating な preview を取り、差分と translation report
   を確認する
3. `takos apply` で desired app manifest を group desired として保存し、内部
   canonical state に compile する
4. resources / services / routes の差分を計算する
5. group の desired / observed snapshot を更新する

- `takos plan` は DB を更新しません。group が未作成でも preview だけ返します。
- `takos apply` は group が未作成なら初回 apply 時に作成します。
- `--provider` と `--env` は preview の評価条件であり、実際の group metadata
  更新は apply 時にだけ起きます。
- `takos apply` は group の source projection を更新しますが、app deployment
  history record は作りません。
- local working tree 由来の apply は `local_upload` projection
  を持てます。この場合 `currentAppDeploymentId` は意図的に `null` のままです。

## translation report

`takos apply` は plan/apply の前に provider translation report を表示します。CLI
では `Spec: Cloudflare-native` と `Runtime: Takos runtime` を前提に、どの
backend でどう実現されるかを示します。

- `native`: Cloudflare backend 上で spec を直接実現できる
- `portable`: compatibility backend 上で spec を provider-backed または
  Takos-managed path で実現できる
- `unsupported`: current deploy pipeline には接続されておらず fail-fast で止まる

特に `aws` / `gcp` / `k8s` の group apply は、未接続の resource/workload/route
が含まれると apply 前に失敗します。

## 例

```bash
takos apply --env production --target workers.web --target resources.primary-db
```

`takos apply` は local working tree を起点にした thin client です。source
projection は更新しますが、rollback 用の deployment snapshot は作りません。
repo/ref や catalog package からの deploy は
[Repository / Catalog デプロイ](/deploy/store-deploy) を参照してください。
