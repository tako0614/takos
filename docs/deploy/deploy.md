# deploy

`takos deploy` は Takos の current preferred deploy entrypoint です。
`.takos/app.yml` を読み取り、ローカル source（または repository URL）を control
plane に渡して group desired state として反映します。runtime model は Takos
runtime で、Cloudflare backend と互換 backend のどちらにも同じ spec を流します。
public manifest contract では `storage:` / `bind:` は使わず、`compute` /
`routes` / `publish` と `compute.<name>.consume` を使います。standalone resource
は control plane の internal model です。

::: info current preferred flow `takos deploy` と `takos deploy --plan` が
current preferred flow です。 `takos apply` と `takos plan` は legacy
compatibility command として残っています。 :::

## 基本

```bash
# ローカル manifest から deploy
takos deploy --env staging --space SPACE_ID

# repository URL から deploy
takos deploy https://github.com/acme/my-app.git --env staging --space SPACE_ID

# dry-run preview
takos deploy --plan --space SPACE_ID
```

positional argument を省略するとローカルの `.takos/app.yml` を source にします。
URL を渡すとその repository を source にします。 `TAKOS_WORKSPACE_ID` または
`.takos-session` で既定 workspace が決まっている場合は `--space`
を省略できます。

## 主なオプション

| option                     | 説明                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| positional `repositoryUrl` | (optional) canonical HTTPS git repository URL。省略時はローカル manifest |
| `--plan`                   | dry-run preview                                                          |
| `--env <name>`             | 反映先環境                                                               |
| `--manifest <path>`        | manifest path。既定は `.takos/app.yml`                                   |
| `--auto-approve`           | 確認プロンプトを省略                                                     |
| `--target <key...>`        | 一部だけ反映。diff entry 名を指定する。例: `web`, `web:/`                |
| `--ref <ref>`              | branch / tag / commit（repo URL 指定時）                                 |
| `--ref-type <type>`        | `branch` / `tag` / `commit`（repo URL 指定時）                           |
| `--group <name>`           | 対象 group 名                                                            |
| `--provider <provider>`    | `cloudflare`, `local`, `aws`, `gcp`, `k8s`                               |
| `--space <id>`             | 対象 space ID                                                            |

## plan と deploy の境界

1. `.takos/app.yml` か `--manifest` で指定した manifest を読み込む
2. `takos deploy --plan --space SPACE_ID` で non-mutating な preview
   を取り、差分と translation report を確認する
3. `takos deploy --space SPACE_ID` で desired app manifest を group desired
   として保存し、内部 canonical state に compile する
4. compute / routes の差分を計算し、publication は manifest catalog
   として同期する
5. group の desired / observed snapshot を更新する

- `takos deploy --plan --space SPACE_ID` は DB を更新しません。group
  が未作成でも preview だけ返します。
- `takos deploy --space SPACE_ID` は group が未作成なら初回 deploy
  時に作成します。
- `--provider` と `--env` は preview の評価条件であり、実際の group metadata
  更新は deploy 時にだけ起きます。
- `takos deploy` はローカル manifest 由来でも repo URL 由来でも、いずれも
  immutable な app deployment record（snapshot）を作ります。両者は lifecycle 上
  同等です。API の source kind はローカル manifest では `manifest`、repo URL
  では `git_ref` で、人間向けの表示名として `local` / `repo:owner/repo@ref`
  を使います。
- どちらの経路で deploy された group
  も、`takos rollback GROUP_NAME --space SPACE_ID` で前回の snapshot
  を再適用できます。

## ローカル deploy と repo deploy の違い

ローカル manifest 由来でも repo URL 由来でも、`takos deploy` の lifecycle は
同じです（どちらも manifest を kernel に渡し、immutable snapshot を作り、
`takos rollback GROUP_NAME --space SPACE_ID` で巻き戻せます）。違いは「manifest
がどこから来るか」という provenance だけです。

repo URL を指定した場合、**CLI は repository URL を control plane に渡す。
control plane が repo を fetch し、manifest を parse し、deploy pipeline
を実行する。 CLI 側で repo を clone することはない。** CLI は thin client
として振る舞います。

| 観点            | local manifest deploy                                             | repo URL deploy                                                                     |
| --------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| source          | local working tree                                                | `repository_url + ref/ref_type`                                                     |
| source 解決     | CLI が manifest / artifact を読む                                 | control plane が repo を fetch して manifest を parse する（CLI は URL を渡すだけ） |
| snapshot 作成   | immutable snapshot を作る                                         | immutable snapshot を作る                                                           |
| rollback 可否   | `takos rollback GROUP_NAME --space SPACE_ID` で snapshot を再適用 | `takos rollback GROUP_NAME --space SPACE_ID` で snapshot を再適用                   |
| API source kind | `manifest`                                                        | `git_ref`                                                                           |
| 表示名          | `local`                                                           | `repo:owner/repo@ref`                                                               |

## translation report

`takos deploy` は plan/deploy の前に provider translation report を表示します。
CLI では `Spec: Cloudflare-native` と `Runtime: Takos runtime` を前提に、 どの
backend でどう実現されるかを示します。

- `native`: Cloudflare backend 上で spec を直接実現できる
- `compatible`: compatibility backend 上で spec を provider-backed または
  Takos-managed path で実現できる
- `unsupported`: current deploy pipeline には接続されておらず fail-fast で止まる

::: warning provider 別の対応状況 `cloudflare` provider 以外 (`aws` / `gcp` /
`k8s` / `local`) は **compatibility backend** であり、resource / workload /
route ごとに対応状況が異なります。translation report で `unsupported`
と判定された項目が含まれる group の `takos deploy` は実行前に失敗します。各
provider の現在の対応範囲は
[hosting/aws](/hosting/aws)、[hosting/gcp](/hosting/gcp)、[hosting/kubernetes](/hosting/kubernetes)
を参照してください。 :::

## 例

```bash
# 一部 primitive のみ反映
takos deploy --env production --space SPACE_ID --target web --target 'web:/'

# repo URL から特定の tag を deploy
takos deploy https://github.com/acme/my-app.git --space SPACE_ID --ref v1.2.0 --ref-type tag

# dry-run preview
takos deploy --plan --space SPACE_ID
```

ローカル working tree からの `takos deploy` も repo URL からの `takos deploy` も
同じ pipeline を通り、同じ immutable snapshot を作ります。CLI 側の役割が異なる
だけで（local は CLI が manifest を読んで kernel に渡し、repo は kernel が repo
を 解決する）、kernel 側の lifecycle は両者で同一です。release / catalog package
からの deploy は [Repository / Catalog デプロイ](/deploy/store-deploy)
を参照してください。

## 次のステップ

- [Repository / Catalog デプロイ](/deploy/store-deploy) --- repository / catalog
  経由のデプロイ
- [Deploy Group](/deploy/deploy-group) --- group の管理と desired state
- [ロールバック](/deploy/rollback) --- `takos rollback` の手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド
