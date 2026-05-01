# deploy

`takos deploy` は Takos の Deployment lifecycle entrypoint です。deploy manifest
(`.takos/app.yml` / `.takos/app.yaml`) または repository URL を入力にして、
worker / service / resource / route / publication / consume の authoring
declaration を 1 つの Deployment record として resolve し、`takos-paas` Core の
`Deployment.desired` (routes / bindings / resources / runtime_network_policy /
activation_envelope) を pin します。default では resolve に続けて apply まで
1 step で実行されます。manifest の `name` で決まる group が GroupHead pointer
を進める対象で、`--group` は override です。

> 現行実装の split status は [Current Implementation Note](/takos-paas/current-state#deploy-shell) を参照

runtime model は tenant runtime で、operator-selected backend に backend-neutral
schema / translation surface を流します。これは runtime behavior や provider
resource existence の一致を意味しません。manifest の `name` または `--group`
override で決まる group の GroupHead が advance され、その group の deployment
履歴 / rollback / uninstall などの group 機能が使えます。group 所属は runtime
や resource provider の特別処理ではありません。group なしの primitive は個別
primitive API で管理します。

`publications` は他の primitive へ共有する typed outputs publication catalog です。
Takos API key / OAuth client は `takos.api-key` / `takos.oauth-client` built-in
provider publication を `consume` して受け取ります。SQL / object-store / queue
などの resource は manifest の `resources`、または `/api/resources/*` などの
resource API / runtime binding で管理します。backend の選択は operator-only
で、manifest には書きません。

ローカル manifest 経路では、CLI が `build.fromWorkflow` の workflow を
workflow-runner でローカル実行し、その build artifact を `source.artifacts`
として送ります。repository URL deploy では CLI は repo を fetch せず、
`repository_url + ref/ref_type` を `POST /api/public/v1/deployments` に渡します。
その先の Deployment service が repo fetch、manifest parse、resolve、apply を担当します。

## 基本

```bash
# ローカル manifest から resolve + apply (default)
takos deploy --env staging --space SPACE_ID

# repository URL から resolve + apply
takos deploy https://github.com/acme/my-app.git --env staging --space SPACE_ID

# in-memory preview (Deployment record は持続化しない)
takos deploy --preview --space SPACE_ID

# resolved Deployment record だけ作って apply は保留
takos deploy --resolve-only --space SPACE_ID
# → 出力された deployment id を `takos apply <id>` で適用
```

positional argument を省略するとローカルの `.takos/app.yml` または
`.takos/app.yaml` を source にします。URL を渡すとその repository を source
にします。`TAKOS_SPACE_ID` または `.takos-session` で既定 space
が決まっている場合は `--space` を省略できます。

## 主なオプション

| option                     | 説明                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| positional `repositoryUrl` | (optional) canonical HTTPS git repository URL。省略時はローカル manifest            |
| `--preview`                | in-memory preview。Deployment record は持続化されない                               |
| `--resolve-only`           | resolved Deployment を作るだけで apply しない (`takos apply <id>` が必要)           |
| `--env <name>`             | 反映先環境                                                                          |
| `--manifest <path>`        | manifest path。既定は `.takos/app.yml` / `.takos/app.yaml`                          |
| `--auto-approve`           | apply 時の確認プロンプトを省略                                                      |
| `--json`                   | machine-readable JSON output                                                        |
| `--ref <ref>`              | branch / tag / commit（repo URL 指定時）                                            |
| `--ref-type <type>`        | `branch` / `tag` / `commit`（repo URL 指定時、CLI で choice validation）            |
| `--group <name>`           | manifest の `name` から決まる group 名を override する                              |
| `--space <id>`             | 対象 space ID                                                                       |

`repositoryUrl` と `--manifest` は同時指定できません。`--preview` と
`--resolve-only` も排他です。

## resolve と apply の境界

1. `.takos/app.yml` / `.takos/app.yaml` か `--manifest` で指定した deploy
   manifest を読み込み、CLI が build artifact を集める
2. `POST /api/public/v1/deployments` (`mode="apply"` が default、`mode="preview"` /
   `mode="resolve"` が flag で選べる) を呼ぶ
3. Deployment service が manifest snapshot を pin し、descriptor closure を
   resolve して Deployment.resolution / Deployment.desired を作る (`status="resolved"`)
4. apply mode では続けて provider operations を順次実行する (`status="applying"` →
   `applied`)。すべての required operation が成功すると GroupHead が新しい
   Deployment を指す
5. workload / routes / publication / binding は Deployment.desired の field と
   して同期され、Takos built-in provider publication consume の validation も
   この段階で行われる
6. 失敗時は `status="failed"` で停止し、`Deployment.conditions[]` に operation
   ごとの結果が残る。GroupHead は advance されない

- `--preview` は DB を更新しません。group が未作成でも preview だけ返します。
  Deployment id は `preview:<digest>` という揮発 id です
- `--resolve-only` は Deployment record を持続化しますが、apply は実行しません。
  reviewer は `takos diff <id>` で expansion を確認し、`takos approve <id>`
  (任意) と `takos apply <id>` で適用します
- default の `takos deploy` は `--resolve-only` 相当 + `takos apply` を 1 step
  で実行する sugar です
- `--env` は resolve の評価条件であり、実際の provider mutation は apply 時に
  だけ起きます。backend 選択は operator/runtime configuration の責務で、
  manifest には書きません
- repo URL 由来の Deployment は app bundle ではなく Deployment.input の source
  metadata から記録済み commit を再解決します
- `takos deploy` は canonical PaaS implementation ではローカル manifest 由来
  でも repo URL 由来でも同じ `POST /api/public/v1/deployments` endpoint を通り
  ます。`source.kind` はローカルでは `inline`、repo URL では `git`。人間向け
  表示名として `local` / `repo:owner/repo@ref` を使います

## ローカル deploy と repo deploy の違い

canonical PaaS implementation では、ローカル manifest 由来でも repo URL 由来でも
`takos deploy` の Deployment lifecycle は同じです。違いは
「Deployment.input.manifest_snapshot がどこから来るか」という provenance だけです。
現行 CLI の HTTP path は `POST /api/public/v1/deployments` (resolve+apply 1 step)
と、追加で `POST /api/public/v1/deployments/:id/apply` などの advanced endpoint
です。

repo URL を指定した場合、**CLI は repository URL を `POST /api/public/v1/deployments`
の `source.kind="git"` として渡す。** repo fetch、manifest parse、resolve、apply
は Deployment service の責務です。CLI 側で repo を clone することはありません。

| 観点              | local manifest flow                                                             | repo URL deploy                                                                           |
| ----------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| source            | local working tree                                                              | `repository_url + ref/ref_type`                                                           |
| source 解決       | CLI が manifest / artifact を読み、`POST /api/public/v1/deployments` に送る     | Deployment service が repo fetch / manifest parse を担当する                              |
| desired apply     | Deployment.desired に worker / service / route / publication / consume を pin   | Deployment.desired に worker / service / route / publication / consume を pin             |
| Deployment record | Deployment.input に manifest / artifacts を記録                                 | Deployment.input に repository URL / ref / commit / manifest metadata を記録              |
| rollback 可否     | GroupHead を retained Deployment に切り替えて再 apply                           | GroupHead を retained Deployment に切り替えて再 apply (commit を再解決)                   |
| API source kind   | `inline`                                                                        | `git`                                                                                     |
| 表示名            | `local`                                                                         | `repo:owner/repo@ref`                                                                     |

## runtime translation report

`takos deploy` は resolve / apply の前に runtime translation report を表示します。
CLI では `Spec: Takos deploy manifest`、`Runtime: tenant runtime`、
`Surface: Portable` として、Deployment.desired を tenant runtime
へ渡すための backend requirement preflight を示します。backend adapter 名は
operator 内部の実装詳細として扱い、通常の report には出しません。

- `compatible`: tenant runtime へ渡す schema / translation が成立する
- `unsupported`: current Deployment service には接続されておらず fail-fast で止まる

runtime translation report が対象にするのは `Deployment.desired.routes` と
Deployment.desired の workload 部分、runtime が満たすべき operator/backend 要件
です。SQL / object-store / queue などの resource は publish catalog の対象では
なく、resource record は manifest `resources` または `/api/resources/*` などの
resource API で扱います。この report は full runtime compatibility や resource
existence を判定しません。 manifest 側の workload / route / publication /
consume の整合性は manifest validation と Deployment service の resolve gate で
確認します。

::: warning operator backend ごとの実装は同じ public deploy surface
を使いますが、内部の adapter と backing service は backend
ごとに異なります。backend / adapter 名は operator-only configuration
であり、public deploy manifest には書きません。runtime translation report で
`unsupported` と判定された workload / route は実行前に失敗します。resource は
manifest の publications catalog ではなく、manifest `resources` または resource API
で扱います。operator 向けの現在の backing 実装は
[hosting/aws](/hosting/aws)、[hosting/gcp](/hosting/gcp)、[hosting/kubernetes](/hosting/kubernetes)
と [Not A Current Contract](/hosting/differences#not-a-current-contract)
を参照してください。
:::

## 関連 verb

`takos deploy` だけでなく、Deployment lifecycle を細かく制御したいときは以下の
verb を組み合わせます。詳細は [CLI コマンド](/reference/cli) を参照。

| verb                                | 用途                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| `takos apply <deployment-id>`       | resolved Deployment を applied に進める                           |
| `takos diff <deployment-id>`        | resolved Deployment の expansion + GroupHead 比較を表示する       |
| `takos approve <deployment-id>`     | `require-approval` decision に approval を添付する                |
| `takos rollback [<group>]`          | group の GroupHead を previous Deployment に切り替える            |

## 例

```bash
# in-memory preview だけ
takos deploy --preview --env production --space SPACE_ID

# resolved Deployment を作って reviewer flow に渡す
takos deploy --resolve-only --env production --space SPACE_ID
takos diff dep_abc123 --space SPACE_ID
takos approve dep_abc123 --space SPACE_ID
takos apply dep_abc123 --space SPACE_ID

# repo URL から特定の tag を resolve + apply
takos deploy https://github.com/acme/my-app.git --space SPACE_ID --ref v1.2.0 --ref-type tag
```

canonical PaaS implementation では、ローカル working tree からの `takos deploy`
も repo URL からの `takos deploy` も同じ Deployment endpoint を通ります。
CLI 側の役割が異なるだけで（local は CLI が manifest / artifacts を読んで
`POST /api/public/v1/deployments` に渡し、repo は Deployment service が repo
を解決する）、Deployment.desired の構造は同じです。release / catalog package
からの deploy は [Repository / Catalog デプロイ](/deploy/store-deploy) を参照
してください。

## 次のステップ

- [Repository / Catalog デプロイ](/deploy/store-deploy) --- repository / catalog
  経由の Deployment
- [Deploy Group](/deploy/deploy-group) --- group / GroupHead と inventory
- [ロールバック](/deploy/rollback) --- `takos rollback` の手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド
