# deploy

`takos deploy` は Takos の group-scoped deploy entrypoint です。deploy manifest
(`.takos/app.yml` / `.takos/app.yaml`) または repository URL を入力にして、
worker / service / resource / route / publication / grant の primitive declaration を
manifest の `name` で決まる group inventory へ渡します。`--group` は override
です。

runtime model は tenant runtime で、operator-selected backend に backend-neutral
schema / translation surface を流します。これは runtime behavior や provider
resource existence の一致を意味しません。manifest の `name` または `--group`
override で決まる group に作成・更新される primitive が所属し、group snapshot / rollback / uninstall
などの group 機能を使えます。group 所属は runtime や resource provider
の特別処理ではありません。group なしの primitive は個別 primitive API
で管理します。

`publish` は他の primitive へ共有する information sharing / capability output
catalog です。Takos capability grant（`api-key` /
`oauth-client`）もここに含めます。SQL / object-store / queue などの resource は
manifest の `resources`、または `/api/resources/*` などの resource API /
runtime binding で管理します。backend の選択は operator-only で、manifest
には書きません。

ローカル manifest 経路では、CLI が `build.fromWorkflow` の workflow を
workflow-runner でローカル実行し、その build artifact を `source.artifacts`
として送ります。repository URL deploy では CLI は repo を fetch せず、
`repository_url + ref/ref_type` を control plane に渡します。

## 基本

```bash
# ローカル manifest から group inventory へ deploy
takos deploy --env staging --space SPACE_ID

# repository URL から deploy
takos deploy https://github.com/acme/my-app.git --env staging --space SPACE_ID

# dry-run preview
takos deploy --plan --space SPACE_ID
```

positional argument を省略するとローカルの `.takos/app.yml` または
`.takos/app.yaml` を source にします。URL を渡すとその repository を source
にします。`TAKOS_SPACE_ID` または `.takos-session` で既定 space
が決まっている場合は `--space` を省略できます。

## 主なオプション

| option                     | 説明                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| positional `repositoryUrl` | (optional) canonical HTTPS git repository URL。省略時はローカル manifest                    |
| `--plan`                   | dry-run preview                                                                             |
| `--env <name>`             | 反映先環境                                                                                  |
| `--manifest <path>`        | manifest path。既定は `.takos/app.yml` / `.takos/app.yaml`                                  |
| `--auto-approve`           | 確認プロンプトを省略                                                                        |
| `--json`                   | machine-readable JSON output                                                                |
| `--target <key...>`        | `takos deploy --plan` / `takos install --plan` で使う diff entry filter。例: `web`, `web:/` |
| `--ref <ref>`              | branch / tag / commit（repo URL 指定時）                                                    |
| `--ref-type <type>`        | `branch` / `tag` / `commit`（repo URL 指定時、CLI で choice validation）                    |
| `--group <name>`           | manifest の `name` から決まる group 名を override する                                      |
| `--space <id>`             | 対象 space ID                                                                               |

`repositoryUrl` と `--manifest` は同時指定できません。

## plan と deploy の境界

1. `.takos/app.yml` / `.takos/app.yaml` か `--manifest` で指定した deploy
   manifest を読み込む
2. `takos deploy --plan --space SPACE_ID` で non-mutating な
   preview を取り、差分と runtime translation report を確認する
3. `takos deploy --space SPACE_ID` で primitive declaration
   を compile し、 service / route / publication / grant へ apply する
4. manifest の `name` または `--group` override で決まる group の inventory に対象 primitive を所属させ、
   group-scoped state を更新する
5. workload / routes の差分を計算し、publication は catalog として同期する。
   Takos capability grants は validation / sync する
6. 指定した group の snapshot を更新する

- `takos deploy --plan --space SPACE_ID` は DB
  を更新しません。group が未作成でも preview だけ返します。
- `takos deploy --space SPACE_ID` は group が未作成なら apply
  時に作成します。
- `--env` は preview の評価条件であり、実際の metadata 更新は deploy
  時にだけ起きます。backend 選択は operator/runtime configuration の責務で、
  manifest には書きません。
- `takos deploy` はローカル manifest 由来でも repo URL 由来でも同じ pipeline
  を通ります。API の source kind はローカル manifest では `manifest`、repo URL
  では `git_ref` で、人間向けの表示名として `local` / `repo:owner/repo@ref`
  を使います。
- group snapshot がある primitive
  は、`takos rollback GROUP_NAME --space SPACE_ID` で snapshot
  を再適用できます。
- `--target` は `takos deploy --plan` と `takos install --plan` で使える diff
  entry filter です。target は diff entry 名で、`web`, `web:/` のほか
  `workers.web`, `routes.web:/` のような dotted category key も受け付けます。
- ローカル manifest 経路では、`build.fromWorkflow.path` / `job` / `artifact`
  に加えて `artifactPath` を使って worker bundle を CLI が API call 前に確認
  します。CLI は workflow-runner で workflow step をローカル実行してから
  artifact を集めます。`artifactPath` は public manifest schema では optional の
  local/private build metadata ですが、local artifact collection
  では必要です。worker bundle が見つからない場合や bundle 候補が解決できない
  場合は、`takos deploy --plan` でも `takos deploy` でも失敗します。

## ローカル deploy と repo deploy の違い

ローカル manifest 由来でも repo URL 由来でも、`takos deploy` の lifecycle は
同じです。違いは「manifest がどこから来るか」という provenance だけです。

repo URL を指定した場合、**CLI は repository URL を control plane に渡す。
control plane が repo を fetch し、manifest を parse し、deploy pipeline
を実行する。CLI 側で repo を clone することはない。** CLI は thin client
として振る舞います。

| 観点            | local manifest flow                                     | repo URL deploy                                                                     |
| --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| source          | local working tree                                      | `repository_url + ref/ref_type`                                                     |
| source 解決     | CLI が manifest / artifact を読む                       | control plane が repo を fetch して manifest を parse する（CLI は URL を渡すだけ） |
| primitive apply | worker / service / route / publication / grant を apply | worker / service / route / publication / grant を apply                             |
| group snapshot  | group 指定時に作る                                      | group 指定時に作る                                                                  |
| rollback 可否   | group snapshot がある場合に再適用                       | group snapshot がある場合に再適用                                                   |
| API source kind | `manifest`                                              | `git_ref`                                                                           |
| 表示名          | `local`                                                 | `repo:owner/repo@ref`                                                               |

## runtime translation report

`takos deploy` は plan/deploy の前に runtime translation report を表示します。
CLI では `Spec: Takos deploy manifest`、`Runtime: tenant runtime`、
`Surface: Portable` として、compiled workload / route を tenant runtime
へ渡すための backend requirement preflight を示します。backend adapter 名は
operator 内部の実装詳細として扱い、通常の report には出しません。

- `compatible`: tenant runtime へ渡す schema / translation が成立する
- `unsupported`: current deploy pipeline には接続されておらず fail-fast で止まる

runtime translation report が対象にするのは `desiredState.workloads` /
`desiredState.routes` と、runtime が満たすべき operator/backend 要件です。SQL /
object-store / queue などの resource は publish catalog の対象ではなく、
resource record は manifest `resources` または `/api/resources/*` などの
resource API で扱います。この
report は full runtime compatibility や resource existence を判定しません。
manifest 側の workload / route / publication / consume の整合性は manifest
validation と deploy validation で確認します。

::: warning operator backend ごとの実装は同じ public deploy surface
を使いますが、内部の adapter と backing service は backend
ごとに異なります。backend / adapter 名は operator-only configuration
であり、public deploy manifest には書きません。runtime translation report で
`unsupported` と判定された workload / route は実行前に失敗します。resource は
manifest の publish catalog ではなく、manifest `resources` または resource API
で扱います。operator 向けの
現在の backing 実装は
[hosting/aws](/hosting/aws)、[hosting/gcp](/hosting/gcp)、[hosting/kubernetes](/hosting/kubernetes)
と [Not A Current Contract](/hosting/differences#not-a-current-contract)
を参照してください。
:::

## 例

```bash
# 一部 workload / route の plan だけ確認
takos deploy --plan --env production --space SPACE_ID --target web --target 'web:/'

# repo URL から特定の tag を deploy
takos deploy https://github.com/acme/my-app.git --space SPACE_ID --ref v1.2.0 --ref-type tag

# dry-run preview
takos deploy --plan --space SPACE_ID
```

ローカル working tree からの `takos deploy` も repo URL からの `takos deploy`
も同じ pipeline を通ります。CLI 側の役割が異なるだけで（local は CLI が manifest
を読んで kernel に渡し、repo は kernel が repo を解決する）、kernel 側の
primitive apply は同じです。`--target` は `takos deploy --plan` /
`takos install --plan` の diff entry filter です。release / catalog package
からの deploy は [Repository / Catalog デプロイ](/deploy/store-deploy)
を参照してください。

## 次のステップ

- [Repository / Catalog デプロイ](/deploy/store-deploy) --- repository / catalog
  経由のデプロイ
- [Deploy Group](/deploy/deploy-group) --- group 機能と inventory
- [ロールバック](/deploy/rollback) --- `takos rollback` の手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド
