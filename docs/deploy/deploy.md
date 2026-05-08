# deploy

::: tip Installable App Model 配下では 2 path に分岐 Takos の deploy には **2
つの異なる surface** があります。

1. **Install from Git** (推奨、ユーザー / 開発者向け)
   `takosumi-git install <git-url> --ref <tag>` または
   `takosumi.cloud/install?git=...` から **AppInstallation を経由して** Takos を
   install する経路。詳細は [Install Paths](/apps/install-paths) と
   [Installer Pipeline](/architecture/installer-pipeline)。
2. **Direct manifest deploy** (legacy / operator 向け) `takosumi` CLI の
   explicit manifest path、または migration window 中の `takos deploy`
   compatibility surface で **compiled manifest** を apply する
   経路。本ページの後半で扱います。これは operator / internal context での利用を
   想定しており、通常の利用者は 1. を選んでください。

**両 path とも最終的に takosumi kernel の `POST /v1/deployments` に着地する**
点は同じですが、**何が AppInstallation 台帳に記録されるか / preview / binding
注入があるか** が異なります。 :::

## 0. .takosumi/app.yml と .takosumi/manifest.yml の区別

deploy 入口に立つ前に、必ず 2 つの manifest を区別してください。

| ファイル / payload             | 受領者                 | 解釈タイミング             | 内容                                                  |
| ------------------------------ | ---------------------- | -------------------------- | ----------------------------------------------------- |
| `.takosumi/app.yml`            | takosumi-git installer | install / upgrade pipeline | InstallableApp v1 metadata + bindings + permissions   |
| `.takosumi/manifest.yml`       | takosumi-git compiler  | compile 前                 | compute resource declaration (placeholder 込み)       |
| compiled manifest HTTP payload | takosumi kernel        | `POST /v1/deployments`     | placeholder / `workflowRef` strip 済み Shape manifest |

- **`.takosumi/app.yml` は kernel に渡らない。** kernel は `identity.oidc@v1`
  のような binding type を **知らない**。
- **`.takosumi/manifest.yml` は compile 後にしか kernel に渡らない。**
  `${bindings.*}` / `${secrets.*}` / `${artifacts.*}` / `workflowRef` を含んだ生
  manifest を kernel に投げてはいけない。

詳細は [.takosumi/app.yml spec](/reference/app-yml-spec) と
[Installable App Model § 2 つの manifest](/architecture/installable-app-model)
を参照。

## 1. Install from Git (推奨 path)

通常の Takos 利用者が使う path です。Takosumi Account に紐付く AppInstallation
を作り、source を git commit に pin して、**takosumi-git installer** が build /
compile / kernel apply を全部やってくれます。

### 1.1 起点

```bash
# CLI から
takosumi-git install https://github.com/takos/takos --ref v1.2.3

# またはブラウザから
# https://takosumi.cloud/install?git=https://github.com/takos/takos&ref=v1.2.3
```

### 1.2 流れ図

```txt
User
 │
 │ Install Takos
 ▼
takosumi-git installer  (= takosumi-git install / takosumi.cloud/install)
 │
 │ 1. Git URL fetch
 │ 2. ref → commit pin
 │ 3. .takosumi/app.yml parse
 │ 4. .takosumi/manifest.yml parse
 │ 5. install preview 生成
 │ 6. user approve
 │ 7. workflow sandbox 実行 (build phase, secrets ゼロ)
 │ 8. artifact resolve (image digest 等)
 │
 ▼
Takosumi Accounts                Takosumi Cloud (managed-postgres / blob / DNS / ...)
 │ identity.oidc@v1 を provision  │ database.postgres@v1, object-store.s3-compatible@v1, ...
 │ install-launch-token@v1 を issue│
 │                                │
 └────────┬───────────────────────┘
          │ binding 注入
          ▼
takosumi-git compiler
 │
 │ 9. bindings / secrets / artifacts placeholder を実値に解決
 │ 10. compiled manifest digest を計算
 │
 ▼
takosumi kernel
 │
 │ 11. POST /v1/deployments で apply (Deployment record 作成)
 │
 ▼
AppInstallation (status: ready)
 │ runtimeBindingId / sourceCommit / appManifestDigest /
 │ compiledManifestDigest が pin される
 │
 ▼
Installed Takos
 │ launch token JWS で /_takosumi/launch に redirect
 │ owner session 作成 → 即 chat
```

step ごとの詳細は [Installer Pipeline](/architecture/installer-pipeline) を
参照。AppInstallation 行に何が pin されるかは
[AppInstallation 台帳](/architecture/app-installation) を参照。

### 1.3 自動注入される bindings

`.takosumi/app.yml` の `bindings:` で宣言された binding は、installer pipeline
の step 10 で **自動注入** されます。代表例:

| binding type                    | compiled manifest / runtime に materialize される値                               |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `identity.oidc@v1`              | `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` |
| `database.postgres@v1`          | `DATABASE_URL`                                                                    |
| `object-store.s3-compatible@v1` | `BLOB_ENDPOINT` / `BLOB_BUCKET` / `BLOB_ACCESS_KEY` / `BLOB_SECRET_KEY`           |
| `domain.http@v1`                | domain resource / route spec に concrete URL として materialize                   |
| `deploy-intent.gitops@v1`       | `DEPLOY_INTENT_DRIVER` / `DEPLOY_INTENT_REMOTE` / `DEPLOY_INTENT_TOKEN`           |
| `install-launch-token@v1`       | `INSTALL_LAUNCH_PUBLIC_KEY` / `INSTALL_LAUNCH_AUDIENCE`                           |

完全な仕様 (placeholder 文法 / rotate / revoke / lifecycle) は
[Binding Catalog](/reference/binding-catalog) を参照。

### 1.4 install preview と AppInstallation

step 5 で **install preview** が生成され、user の approve なしには進めません。
preview には source (publisher / commit / verified) / requested bindings /
requested grants / estimated cost / runtime mode / auth issuer / data
exportability が含まれます。

step 11 が成功すると AppInstallation 行は `installing → ready` に遷移し、
次の値が **immutable に pin** されます。

- `sourceGitUrl` / `sourceRef` / `sourceCommit`
- `appManifestDigest` (`.takosumi/app.yml` の digest)
- `compiledManifestDigest` (kernel に渡した compute manifest の digest)
- `mode` (shared-cell / dedicated / self-hosted)
- `runtimeBindingId`

これにより「何を install したか」を後から AppInstallation + InstallationEvent
ledger だけで完全に再構築できます。

### 1.5 upgrade と rollback

```bash
# upgrade (新しい source ref で installer pipeline を再走)
takosumi-git upgrade inst_abc --ref v1.2.4

# rollback (前の compiled manifest digest に戻す)
takosumi-git rollback inst_abc --to v1.2.3
```

詳細は [Upgrade / Export](/platform/upgrade-export) を参照。

### 1.6 関連 API

CLI が呼ぶ HTTP API は [Install API リファレンス](/reference/install-api) に
集約されています。

| API                                       | 用途                                               |
| ----------------------------------------- | -------------------------------------------------- |
| `POST /v1/install/preview`                | install preview を取得 (mutate なし)               |
| `POST /v1/installations`                  | AppInstallation を作成して installer pipeline 起動 |
| `POST /v1/installations/:id/launch-token` | install 後の owner session 用 launch token 発行    |
| `POST /v1/installations/:id/materialize`  | shared-cell → dedicated 物理化                     |
| `POST /v1/installations/:id/export`       | self-host 用 bundle export                         |

## 2. Direct manifest deploy (legacy / operator)

::: warning Operator / internal context このセクションは **operator / internal
debug** での利用を想定しています。 通常の Takos 利用者は §1 の Install from Git
を使ってください。

direct deploy は AppInstallation 台帳を経由しません。binding 自動注入も
行われず、compiled manifest の env / secrets を operator が責任を持って
用意する必要があります。新しい InstallableApp の lifecycle (preview / permission
grant / upgrade preview / rollback / export) も得られません。 :::

`takos deploy` は migration window 中に残る Takos public API compatibility
entrypoint です。operator が compiled Shape manifest (`apiVersion: "1.0"` /
`kind: Manifest`) または repository URL を入力にして、`resources[]` / routes /
runtime network policy / activation envelope を 1 つの Deployment record として
resolve します。kernel に直接 apply する場合の正本 surface は `takosumi` CLI の
explicit manifest path → `POST /v1/deployments` です。

> 現行実装の split status は
> [Current Implementation Note](/takosumi/current-state#deploy-shell) を参照

runtime model は tenant runtime で、operator-selected backend に backend-neutral
schema / translation surface を流します。これは runtime behavior や provider
resource existence の一致を意味しません。manifest の `name` または `--group`
override で決まる group の GroupHead が advance され、その group の deployment
履歴 / rollback / uninstall などの group 機能が使えます。group 所属は runtime や
resource provider の特別処理ではありません。group なしの primitive は個別
primitive API で管理します。

current Shape manifest は top-level `publications[]` / `bindings[]`
を持ちません。 launcher / MCP / file handler は Takos app metadata / registry の
surface で扱い、 Takos API access は AppGrant / product API の責務です。OIDC
consumer 統合は `identity.oidc@v1` AppBinding (Takosumi Accounts 経由) で
`.takosumi/app.yml` の `bindings.auth` に宣言します。SQL / object-store / queue
などの backing capability は manifest の `resources[]`、または resource API /
runtime binding で管理します。backend の選択は operator-only で、manifest
には書きません。

Takos の compatibility deploy endpoint は compiled manifest と artifact input を
受け取る Web/API surface です。workflow / build / git push 連携は `takosumi-git`
が担当し、Takos へは digest-pinned image を持つ Shape manifest、 または worker
bundle artifact を添えた `source.kind="manifest"` deploy を 渡します。repository
URL deploy では CLI は repo を fetch せず、 `repository_url + ref/ref_type` を
`POST /api/public/v1/deployments` に渡します。 この endpoint は Takos
compatibility API であり、kernel の正本 surface は `POST /v1/deployments` です。

### 2.1 基本

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

positional argument を省略するとローカルの `.takosumi/manifest.yml` を source
にします。URL を渡すとその repository を source にします。`TAKOS_SPACE_ID`
または `.takos-session` で 既定 space が決まっている場合は `--space`
を省略できます。

### 2.2 主なオプション

| option                     | 説明                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| positional `repositoryUrl` | (optional) canonical HTTPS git repository URL。省略時はローカル manifest  |
| `--preview`                | in-memory preview。Deployment record は持続化されない                     |
| `--resolve-only`           | resolved Deployment を作るだけで apply しない (`takos apply <id>` が必要) |
| `--env <name>`             | 反映先環境                                                                |
| `--manifest <path>`        | manifest path。既定は `.takosumi/manifest.yml`                            |
| `--auto-approve`           | apply 時の確認プロンプトを省略                                            |
| `--json`                   | machine-readable JSON output                                              |
| `--ref <ref>`              | branch / tag / commit（repo URL 指定時）                                  |
| `--ref-type <type>`        | `branch` / `tag` / `commit`（repo URL 指定時、CLI で choice validation）  |
| `--group <name>`           | manifest の `name` から決まる group 名を override する                    |
| `--space <id>`             | 対象 space ID                                                             |

`repositoryUrl` と `--manifest` は同時指定できません。`--preview` と
`--resolve-only` も排他です。

### 2.3 resolve と apply の境界

1. `.takosumi/manifest.yml` を takosumi-git で compile するか、`--manifest`
   で指定した placeholder-free Shape manifest を読み込み、必要な worker bundle
   artifact input を添える
2. Takos compatibility path では `POST /api/public/v1/deployments`
   (`mode="apply"` が default、`mode="preview"` / `mode="resolve"` が flag
   で選べる) を呼ぶ。kernel direct path では `POST /v1/deployments` を呼ぶ
3. Deployment service が manifest snapshot を pin し、descriptor closure を
   resolve して Deployment.resolution / Deployment.desired を作る
   (`status="resolved"`)
4. apply mode では続けて provider operations を順次実行する (`status="applying"`
   → `applied`)。すべての required operation が成功すると GroupHead が新しい
   Deployment を指す
5. Shape resources / routes / bindings report は Deployment.desired の field
   として同期される。AppBinding と app metadata は installer / Takos product
   registry 側の surface であり、kernel manifest の `publications[]` ではない
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
- `takos deploy` compatibility path ではローカル manifest 由来でも repo URL
  由来でも同じ `POST /api/public/v1/deployments` endpoint を通ります。
  `source.kind` はローカルでは `manifest`、repo URL では `git_ref`。kernel
  direct path は compiled manifest のみを `POST /v1/deployments` に渡します

### 2.4 ローカル deploy と repo deploy の違い

Takos compatibility implementation では、ローカル manifest 由来でも repo URL
由来でも `takos deploy` の Deployment lifecycle は同じです。違いは
「Deployment.input.manifest_snapshot がどこから来るか」という provenance
だけです。 現行 CLI の HTTP path は `POST /api/public/v1/deployments`
(resolve+apply 1 step) と、追加で `POST /api/public/v1/deployments/:id/apply`
などの advanced endpoint です。これは Takos public compatibility API であり、
takosumi kernel の public API ではありません。

repo URL を指定した場合、**CLI は repository URL を
`POST /api/public/v1/deployments` の `source.kind="git_ref"` として渡す。** repo
fetch、manifest parse、resolve、apply は Deployment service の責務です。CLI 側で
repo を clone することはありません。

| 観点              | local manifest flow                                                                             | repo URL deploy                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| source            | local working tree                                                                              | `repository_url + ref/ref_type`                                              |
| source 解決       | CLI / takosumi-git が compiled manifest / artifact input を読み、Takos compatibility API に送る | Deployment service が repo fetch / manifest parse を担当する                 |
| desired apply     | Deployment.desired に Shape resources / routes / bindings report を pin                         | Deployment.desired に Shape resources / routes / bindings report を pin      |
| Deployment record | Deployment.input に manifest / artifacts を記録                                                 | Deployment.input に repository URL / ref / commit / manifest metadata を記録 |
| rollback 可否     | GroupHead を retained Deployment に切り替えて再 apply                                           | GroupHead を retained Deployment に切り替えて再 apply (commit を再解決)      |
| API source kind   | `manifest`                                                                                      | `git_ref`                                                                    |
| 表示名            | `local`                                                                                         | `repo:owner/repo@ref`                                                        |

### 2.5 runtime translation report

`takos deploy` は resolve / apply の前に runtime translation report
を表示します。 CLI では
`Spec: Takos deploy manifest`、`Runtime: tenant runtime`、 `Surface: Portable`
として、Deployment.desired を tenant runtime へ渡すための backend requirement
preflight を示します。backend adapter 名は operator
内部の実装詳細として扱い、通常の report には出しません。

- `compatible`: tenant runtime へ渡す schema / translation が成立する
- `unsupported`: current Deployment service には接続されておらず fail-fast
  で止まる

runtime translation report が対象にするのは `Deployment.desired.routes` と
Deployment.desired の workload 部分、runtime が満たすべき operator/backend 要件
です。SQL / object-store / queue などの resource は publication catalog
の対象では なく、Shape manifest の `resources[]` または resource API
で扱います。この report は full runtime compatibility や resource existence
を判定しません。manifest 側の Shape resource / route / binding report の整合性は
manifest validation と Deployment service の resolve gate で確認します。

::: warning operator backend ごとの実装は同じ public deploy surface
を使いますが、内部の adapter と backing service は backend
ごとに異なります。backend / adapter 名は operator-only configuration
であり、public deploy manifest には書きません。runtime translation report で
`unsupported` と判定された workload / route は実行前に失敗します。resource は
manifest の publications catalog ではなく、Shape manifest `resources[]` または
resource API で扱います。operator 向けの現在の backing 実装は
[hosting/aws](/hosting/aws)、[hosting/gcp](/hosting/gcp)、[hosting/kubernetes](/hosting/kubernetes)
と [Not A Current Contract](/hosting/differences#not-a-current-contract)
を参照してください。 :::

### 2.6 関連 verb

`takos deploy` だけでなく、Deployment lifecycle を細かく制御したいときは以下の
verb を組み合わせます。詳細は [CLI コマンド](/reference/cli) を参照。

| verb                            | 用途                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| `takos apply <deployment-id>`   | resolved Deployment を applied に進める                     |
| `takos diff <deployment-id>`    | resolved Deployment の expansion + GroupHead 比較を表示する |
| `takos approve <deployment-id>` | `require-approval` decision に approval を添付する          |
| `takos rollback [<group>]`      | group の GroupHead を previous Deployment に切り替える      |

### 2.7 例

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

Takos compatibility path では、ローカル working tree からの `takos deploy` も
repo URL からの `takos deploy` も同じ Deployment endpoint を通ります。 CLI
側の役割が異なるだけで（local / takosumi-git は manifest / artifacts を読んで
`POST /api/public/v1/deployments` に渡し、repo は Deployment service が repo
を解決する）、Deployment.desired の構造は同じです。release / catalog package
からの deploy は [Repository / Catalog デプロイ](/deploy/store-deploy) を参照
してください。

## 3. Troubleshooting

### preview を見るだけにしたい

```bash
takos deploy --preview --space SPACE_ID
```

DB を更新せず、resolve だけ走らせて diff を表示します。Deployment record は
持続化されません。

Installable App Model 配下では `POST /v1/install/preview` で同等の **install
preview** (publisher / commit / requested bindings / requested grants /
estimated cost) を取得できます。詳細は [Install API](/reference/install-api)。

### resolve だけして apply を保留したい

```bash
takos deploy --resolve-only --space SPACE_ID
```

resolved Deployment record を作り、`takos diff` / `takos approve` を経由して
`takos apply` で適用します。

### kernel apply に失敗した

`status="failed"` の `Deployment.conditions[]` に operation ごとの結果が
残ります。GroupHead は advance されないので、`takos rollback` も不要です。 原因
condition を読んで修正後に再 deploy してください。

Installable App Model 配下では AppInstallation 行が `installing → failed`
に遷移し、InstallationEvent ledger に reason が append されます (詳細は
[AppInstallation 台帳](/architecture/app-installation))。

### Takos 自身が deploy したい (Takos の中の機能)

Takos に kernel client を埋め込まないでください。代わりに **GitOps deploy
binding** (`deploy-intent.gitops@v1`) を使い、deployment intent を Git に commit
/ push します。takosumi-git watcher が detect して、installer pipeline を再走 /
kernel apply します。詳細は
[Deploy System § GitOps deploy binding](/architecture/deploy-system) と
[Binding Catalog](/reference/binding-catalog)。

## 次のステップ

- [Install Paths](/apps/install-paths) --- Use Takos / Install from Git /
  Self-host の 3 path
- [Installer Pipeline](/architecture/installer-pipeline) --- 13 step の install
  pipeline 詳細
- [.takosumi/app.yml spec](/reference/app-yml-spec) --- installer-bound manifest
  の field 定義
- [Binding Catalog](/reference/binding-catalog) --- 6 種の binding type と
  自動注入 env
- [Install API](/reference/install-api) --- `POST /v1/installations` 等の wire
  shape
- [Deploy System](/architecture/deploy-system) --- 3 種の deploy path と Core
  record 構造
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- repository / catalog
  経由の Deployment
- [Deploy Group](/deploy/deploy-group) --- group / GroupHead と inventory
- [ロールバック](/deploy/rollback) --- `takos rollback` の手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド
