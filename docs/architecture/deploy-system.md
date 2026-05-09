# Deploy System

> **Internal implementation**
>
> このページは deploy system の internal 実装を説明する。
>
> - public contract: [manifest spec](/reference/manifest-spec) /
>   [API reference](/reference/api)
> - Installable App Model の入口:
>   [Installable App Model](./installable-app-model.md)

Takos の deploy system は **Installable App Model** の登場で、 "CLI が直接
kernel を叩いて deploy する" 単一 path から、**3 種の deploy path**
を持つ多層構造に書き換わりました。本ページは、それぞれの path がどの entity
を経由し、どの record を更新するかを **正本** として整理し、その下にある
primitive / Core record 構造 (`takosumi` Core の Deployment /
ProviderObservation / GroupHead) と provider DAG を引き続き説明します。

## 0. 3 種の deploy path (canonical)

Installable App Model 配下の Takos には、deploy intent の origin が異なる **3
種の path** が存在します。どの path も最終的には takosumi kernel の
`POST /v1/deployments` (= compute apply) に着地しますが、**Takos / 利用者
から見える surface は別物** です。

| # | path                      | trigger                                   | 主体                            | 用途                             |
| - | ------------------------- | ----------------------------------------- | ------------------------------- | -------------------------------- |
| 1 | **Install path**          | `POST /v1/installations` (新規 install)   | takosumi-git installer pipeline | App を新規に install する        |
| 2 | **Upgrade path**          | `POST /v1/installations/:id/upgrade`      | 同 installer pipeline (再走)    | source ref / manifest を更新する |
| 3 | **GitOps deploy binding** | Takos が deploy intent repo に `git push` | Takos → takosumi-git watcher    | Takos が自分の中から deploy する |

> **kernel 直叩きは non-canonical**
>
> 旧来の "CLI から直接 kernel に compiled manifest を投げる" 経路は、 operator /
> internal debug でのみ使用する non-canonical path として残します。
>
> - 通常の deploy はすべて上記 3 path のいずれかを通る
> - kernel に `.takosumi/app.yml` を直接渡してはいけない
> - kernel は `app.yml` を解釈しない

3 path に共通する不変条件は次のとおりです。

- kernel は `compiled manifest` (= installer-only placeholder を取り除いた
  compute manifest) しか受け取らない
- `.takosumi/app.yml` (installer-bound) は **kernel に渡らない**。これは
  installer / preview / binding catalog のための surface
- `.takosumi/manifest.yml` は `workflowRef` や `${artifacts.*}` /
  `${bindings.*}` / `${secrets.*}` / `${installation.*}` / `${params.*}`
  を含み得る authoring manifest。kernel に届く前に `workflowRef` と
  installer-only placeholder は消える。kernel-owned `${ref:...}` /
  `${secret-ref:...}` と service import placeholder は deploy route が解決する
  (詳細は [.takosumi/app.yml spec](/reference/app-yml-spec) と
  [Manifest Reference](/reference/manifest-spec))

## 1. Install path (新規 install)

新規に Takos (もしくは任意の InstallableApp) を Takosumi Account の Space に
入れる経路。`takosumi.cloud/install?git=...&ref=...` の "Install Takos" 流入や
`takosumi-git install <git-url>` CLI、`POST /v1/installations` API がここに集約
されます。

### 1.1 Install pipeline 13 step

new.md §12 の install pipeline を canonical step として固定し、
[Installer Pipeline](./installer-pipeline.md) と AppInstallation status 遷移
[(AppInstallation 台帳)](./app-installation.md) で詳細化しています。
本ページではフローのみ示します。

```txt
1. Git URL 受信                   (takosumi-git API)
2. repository fetch               (shallow clone)
3. ref → commit SHA pin           (sourceCommit を確定)
4. .takosumi/app.yml parse        (InstallableApp v1 metadata + bindings)
5. .takosumi/manifest.yml parse   (template manifest)
6. install preview 生成           (publisher / commit / bindings / grants / cost)
7. user approve                   (preview を確認しないと進まない)
8. workflow sandbox 実行          (build phase に runtime secrets を渡さない)
9. artifact resolve               (image digest / asset URI を解決)
10. AppBinding materialize        (identity.oidc@v1, database.postgres@v1, ...)
11. manifest compile              (workflowRef strip / installer-only placeholder 解決)
12. kernel deploy                 (POST /v1/deployments で apply)
13. AppInstallation ready         (status: ready, runtimeBindingId を確定)
```

step 11 で **compiled manifest digest** が確定し、AppInstallation 行の
`compiledManifestDigest` 列に保存されます。kernel はこの digest と一致する
compiled manifest だけを apply します。Step 12 以降は本ページ後半で説明する
従来の Deployment / ProviderObservation / GroupHead の世界に入ります。

### 1.2 何が AppInstallation に保存されるか

step 13 で AppInstallation 行は `installing → ready` に遷移し、次の値が
**immutable** に pin されます。

- `sourceGitUrl` / `sourceRef` / `sourceCommit`
- `appManifestDigest` (`.takosumi/app.yml` の digest)
- `compiledManifestDigest` (kernel に渡した compute manifest の digest)
- `mode` (shared-cell / dedicated / self-hosted)
- `runtimeBindingId` (どの cell / runtime に bind されたか)

これにより、後から「何を install したか」を AppInstallation 行と
InstallationEvent ledger だけで完全に再構築できます。詳細な field は
[AppInstallation 台帳](./app-installation.md) を参照。

## 2. Upgrade path (source ref を更新)

既存 installation の source ref / `.takosumi/app.yml` / `.takosumi/manifest.yml`
を更新する経路。**install path と同じ pipeline を再走** し、新しい compiled
manifest digest を作って kernel に apply する点で構造的に install path
と同一です。

```bash
takosumi-git upgrade inst_abc --ref v1.2.4
```

差分は以下:

- step 7 の `install preview` は **upgrade preview** として manifest diff /
  permission diff / migration plan を提示する
- AppInstallation 行は新しい `sourceCommit` / `appManifestDigest` /
  `compiledManifestDigest` で **更新される** (新規 row は作らない)
- 旧 compiled manifest digest は **rollback 用に保存** され、
  `takosumi-git rollback inst_abc --to v1.2.3` で前の digest に戻せる

upgrade / rollback の UI / 仕様は [Upgrade / Export](/platform/upgrade-export)
を参照。

## 3. GitOps deploy binding (Takos が deploy intent を出す)

Takos 自身が "何かを deploy したい" と判断したとき (例: ユーザーが Takos 内の
sub-app を作る、agent が新しい worker を立てる) には、**Takos は kernel API を
直接叩きません**。代わりに **GitOps deploy binding** (`deploy-intent.gitops@v1`)
を使い、deployment intent を Git repo に commit / push するだけにします。

### 3.1 流れ

```txt
Takos (Installed)
  │
  │ 1. deployment intent (manifest YAML) を生成
  │
  ▼
DEPLOY_INTENT_REMOTE (= installation 専用 Git repo)
  │
  │ 2. git push (DEPLOY_INTENT_TOKEN で auth)
  │
  ▼
takosumi-git watcher
  │
  │ 3. push を検知 → installer pipeline を再走 (workflow / compile)
  │
  ▼
takosumi kernel
  │
  │ 4. compiled manifest を apply
  │
  ▼
新 / 更新された Deployment record (group ごと)
```

### 3.2 Takos が知らなくていい env list

GitOps deploy binding を採用すると、Takos の runtime 依存は次の env のみに
なります (詳細は
[Binding Catalog § deploy-intent.gitops@v1](/reference/binding-catalog)
を参照)。

```env
DEPLOY_INTENT_DRIVER=gitops
DEPLOY_INTENT_REMOTE=https://git.takosumi.cloud/installations/inst_abc/deployments.git
DEPLOY_INTENT_BRANCH=main
DEPLOY_INTENT_TOKEN=...
```

逆に Takos が **知らないもの** (= runtime 依存に **入れない** もの):

- takosumi kernel の endpoint や auth token
- provider credential (Cloudflare API token / AWS keys / 等)
- Takosumi Cloud internal deployment token
- Takosumi Accounts internal API
- Takosumi Cloud billing API

つまり Takos は kernel client / Takosumi 専用 SDK ではなく、**「Git に intent
を書く app」** として完結します。Git が契約書、manifest が設計図、takosumi-git
が大工、kernel が工事現場、という分業が成立します。

### 3.3 budget guard

GitOps binding を経由する deploy intent も、Takosumi Accounts の budget guard
で高額操作を止められます。

```txt
Takos wants to create:
  GPU worker
Estimated cost:
  ¥1,200 / day

Approve?
```

普段の UX を壊さず、高額操作のみ user 確認を挟む設計です (new.md §22.7)。

## 4. compiled manifest と app.yml の役割分離

3 path に共通する **設計の核** は、`.takosumi/app.yml` と
`.takosumi/manifest.yml` を厳格に分離することです。

| ファイル                 | 受領者                 | 解釈タイミング             | 内容                                                             |
| ------------------------ | ---------------------- | -------------------------- | ---------------------------------------------------------------- |
| `.takosumi/app.yml`      | takosumi-git installer | install / upgrade pipeline | InstallableApp v1 metadata + bindings + permissions              |
| `.takosumi/manifest.yml` | takosumi-git compiler  | compile 前                 | compute resource declaration (workflowRef / placeholder 込み)    |
| compiled manifest        | takosumi kernel        | `POST /v1/deployments`     | workflowRef / installer-only placeholder 解決済み Shape manifest |

- `.takosumi/app.yml` は **kernel に渡してはいけない**。kernel は
  `identity.oidc@v1` のような binding type を **知らない**。
- `.takosumi/manifest.yml` は `${bindings.*}` / `${secrets.*}` /
  `${artifacts.*}` / `${installation.*}` / `${params.*}` と `workflowRef`
  を含み得ます。これらは **そのまま kernel に渡してはいけない**。
- kernel が apply するのは **compiled manifest** です。image digest / OIDC
  client / AppInstallation 値など installer-only の値は解決済みですが、 resource
  間参照 (`${ref:...}` / `${secret-ref:...}`) と service import placeholder は
  kernel deploy route の責務として残り得ます。

field 定義は [.takosumi/app.yml spec](/reference/app-yml-spec)、placeholder
文法と binding 種別は [Binding Catalog](/reference/binding-catalog)、Compiler
の動きは [Installer Pipeline](./installer-pipeline.md) を参照。

## 5. 共通基盤: Deployment と Shape resource

3 path のいずれを通っても、kernel に apply された後の Takos deploy system は
takosumi kernel の Deployment lifecycle に集約されます。current authoring
surface は `apiVersion: "1.0"` + `kind: Manifest` + `resources[]` の Shape model
です。旧 AppSpec の `components` / `routes` / `bindings` / `publications` は
current manifest ではありません。

- **Deployment** — input manifest、resource DAG、provider operation、 conditions
  / WAL を 1 lifecycle として扱う中核 record
- **ManifestResource** — `shape` / `name` / `provider` / `spec` を持つ apply
  単位。例 `worker@v1` / `web-service@v1` / `database-postgres@v1`
- **ProviderObservation** — provider 側の observed state を separate stream
  として記録 (canonical な真値ではない)
- **GroupHead** — group ごとの `current_deployment_id` /
  `previous_deployment_id` pointer。Installable App Model では AppInstallation
  側の `compiledManifestDigest` が上位の source pin になる

`ResourceInstance` / `MigrationLedger` のみ Deployment 外の独立 record として
durable state を持ちます。group に所属しているかどうかで shape / provider の
apply semantics は変わりません。

> 現行実装の split status は
> [Current Implementation Note](/takosumi/current-state#deploy-shell) を参照

## 6. Manifest format (Shape model)

`.takosumi/manifest.yml` は kernel-bound compute manifest です。top-level
envelope は closed set で、`apiVersion: "1.0"` と `kind: Manifest` が必須です。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
      routes:
        - my-app.example.com/*
    workflowRef:
      file: build.yml
      job: build-worker
      artifact: bundle
      target: spec.artifact.hash
```

`workflowRef` は takosumi-git の authoring extension です。kernel に到達する
前に artifact hash / URI が `workflowRef.target` に書き込まれ、`workflowRef`
field は削除されます。

container service と database の例:

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: api
resources:
  - shape: database-postgres@v1
    name: db
    provider: "@takos/aws-rds"
    spec:
      version: "16"
      size: small

  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        DATABASE_URL: ${ref:db.connectionString}
        DB_PASSWORD: ${secret-ref:db.passwordSecretRef}
```

normative な field 仕様は [manifest spec](/reference/manifest-spec)、Installable
App Model 上の二段構造は
[Installable App Model § 2 つの manifest](./installable-app-model.md) を参照。

## 7. Shape model

### ManifestResource

`resources[]` の各 entry は `ManifestResource` です。`shape` は portable
resource contract、`provider` はその shape を実装する provider id、`spec` は
shape 固有の desired state です。provider が shape を実装していない場合や
`requires[]` を満たせない場合は reject されます。

### Resource wiring

resource 間 dependency は `${ref:<resource>.<field>}` /
`${secret-ref:<resource>.<field>}` で表現します。kernel は参照を DAG edge
として扱い、cycle を reject し、topological order で apply します。

### Entry points

top-level `routes[]` はありません。HTTP / public entrypoint は shape spec または
`custom-domain@v1` resource で表現します。

```yaml
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

  - shape: custom-domain@v1
    name: api-domain
    provider: "@takos/cloudflare-dns"
    spec:
      name: api.example.com
      target: ${ref:api.url}
```

Worker route patterns are strings in `worker@v1.spec.routes`.

### Cross-instance services

external service dependency は `imports[]` と `serviceResolvers[]`
で表現します。 consumer manifest は service identifier
(`takosumi.account.auth@v1` など) を 参照し、Accounts hostname を直接 pin
しません。service descriptor の取得 / signature verify / endpoint
materialization は kernel deploy route の責務です。

### Installable App binding は別レイヤー

Installable App Model の `.takosumi/app.yml` の `bindings:` (`identity.oidc@v1`
/ `database.postgres@v1` 等) は installer-bound です。 takosumi-git / Takosumi
Accounts が AppBinding を承認・materialize し、 `.takosumi/manifest.yml` の
`${bindings.*}` / `${secrets.*}` に反映してから kernel に渡します。詳しくは
[Binding Catalog](/reference/binding-catalog) を参照。

## 8. CLI / API

CLI は manifest / repository / catalog source から primitive declaration を
apply する task-oriented surface を提供する。 `takos deploy` / `takos install`
は group deployment history を更新するため、 group 名を 明示し、 その group
inventory に参加する。

```bash
takos deploy --space SPACE_ID --group my-app                       # resolve + apply (Heroku-like sugar)
takos deploy --resolve-only --space SPACE_ID --group my-app        # resolved Deployment を作成 (apply 待ち)
takos deploy --preview --space SPACE_ID --group my-app             # 差分プレビュー (non-mutating、record なし)
takos apply <deployment-id> --space SPACE_ID                        # resolved Deployment を apply
takos diff <deployment-id> --space SPACE_ID                         # resolved expansion + diff
takos approve <deployment-id> --space SPACE_ID                      # optional approval を attach
takos install OWNER/REPO --space SPACE_ID --group my-app            # catalog から source を解決して apply
takos rollback GROUP_NAME --space SPACE_ID                          # GroupHead を previous_deployment_id に切替
takos uninstall GROUP_NAME --space SPACE_ID
takos group list --space SPACE_ID                                   # group inventory
takos group show NAME --space SPACE_ID
```

> **operator / internal context**
>
> 上記の `takos deploy` / `takos install` 系 CLI は **operator / internal** の
> context で使うものです。Installable App Model 配下の通常の Takos 利用者は、
> 以下の path を使ってください。

- 一般ユーザー: `Use Takos` ボタン (Install path)
- 開発者: `takosumi-git install <git-url>` または
  `takosumi.cloud/install?git=...&ref=...` (Install path)
- Takos 自体が deploy する場合: GitOps deploy binding (Takos が intent を Git に
  commit、kernel API を直接叩かない)
- 詳細: [Install Paths](/apps/install-paths) /
  [deploy CLI ガイド](/deploy/deploy)

個別 primitive 操作:

- resource / provider output: `takos resource` / `takos res` または
  `/api/resources/*`
- deployment / custom domain projection: `/api/deployments/*` /
  `/api/custom-domains/*`

既存 resource / deployment projection を後から group inventory
に入れたい場合は、 group inventory API を使う。これは manifest format ではなく
operator / internal 管理 API の責務です。

## 9. Group features

Group と primitive projection record の責務は次のように分ける。

- ManifestResource は shape / provider ごとの deployment operation
  として保存される
- worker route / provider domain / `custom-domain@v1` は routing projection に
  materialize される
- resource output と binding evidence は output planner / WAL / resource
  metadata に保存される
- group は `groups` row として inventory / source metadata / current deployment
  pointer / reconcile status を持つ compatibility projection
- deployment history / rollback / uninstall は group inventory に対する
  機能であり、primitive runtime の特別処理ではない

```text
group "my-app":
  groups row:
    inventory / source metadata / GroupHead pointer / reconcile status
  group features:
    deploy (resolve + apply) / deployment history / rollback / uninstall
  inventory:
    resource: web (worker@v1)
    resource: db (database-postgres@v1)
    resource: domain (custom-domain@v1)

group なし primitive:
  resource: shared-db
  custom-domain: redirect.example.com
```

## 10. Deploy pipeline (kernel apply の内部)

`takos deploy` / `takos deploy --resolve-only` が public deploy entrypoint。
group apply の HTTP API path も同じ内部 pipeline を通る。 pipeline は Deployment
lifecycle (`preview` → `resolved` → `applying` → `applied` / `failed` /
`rolled-back`) を 1 record で表現する。

1. **Authoring expansion**
   - deploy manifest envelope (`apiVersion: "1.0"` / `kind: Manifest`) を parse
   - bundled `template` があれば `resources[]` に展開する
   - kernel 到達時点で `workflowRef` や installer-only placeholder
     が残っていれば reject する
   - group が指定されている場合は group membership を付与する
2. **Resolution** (status → `resolved`)
   - `imports[]` があれば `serviceResolvers[]` の anchor から ServiceDescriptor
     を取得し、signature / expiry / contract version を検証
   - `resources[]` の `shape` / `provider` / `requires[]` を catalog と provider
     registry で検証
   - `${ref:...}` / `${secret-ref:...}` を resource dependency edge
     として抽出し、 apply DAG を確定
   - resolution-gate の policy decision を `Deployment.policy_decisions[]`
     に記録
3. **Diff** (read-set validation)
   - 現在 GroupHead が指す Deployment desired resources と新 manifest の
     resources を比較
   - resource creation は resource API 側の責務として扱う
4. **Workload apply** (status → `applying`)
   - ManifestResource を dependency order で provider に apply
   - 各 provider operation は `Deployment.conditions[]` (scope.kind="operation"
     / "phase") に append される
5. **Managed-state sync**
   - provider outputs を validate し、`${ref:...}` / `${secret-ref:...}` の
     consumer resource spec を解決
   - service import evidence / descriptor digest を resource metadata / WAL に
     pin
6. **Routing reconcile**
   - workload apply と managed-state sync が成功した場合だけ worker routes /
     custom-domain resources / provider domains を reconcile
7. **Activation commit** (status → `applied`)
   - `Deployment.desired.activation_envelope` を commit、 GroupHead の
     `current_deployment_id` を新 Deployment に進め、 `previous_deployment_id`
     に旧 current を保持
   - group がある場合は group-scoped declaration / observed state / deployment
     pointer を更新する

## 11. Rollback

rollback は GroupHead の `current_deployment_id` を `previous_deployment_id`
(または明示指定された retained Deployment id) に向けて切り替える pointer move
です。 新 Deployment record は作成されず、 旧 current Deployment は
`rolled-back` status に遷移します。

- code + config + bindings が戻る (retained `Deployment.input.manifest_snapshot`
  と `Deployment.resolution.descriptor_closure` を再利用)
- DB data は戻らない (forward-only migration、 `MigrationLedger` は逆方向
  に進まない)
- resource の data / schema は自動巻き戻ししない
- group なし primitive の個別 rollback は、 その primitive API の contract
  に従う

Installable App Model 配下の **AppInstallation rollback**
(`takosumi-git rollback
inst_abc --to v1.2.3`) は、これとは別レイヤーで、過去の
compiled manifest digest を再 apply することで実現されます (詳細は
[Upgrade / Export](/platform/upgrade-export))。

## 12. Install / version / source tracking

Installable App Model では source tracking の正本は `.takosumi/app.yml` と
AppInstallation 行です。Store / catalog は Git URL と immutable ref を解決し、
takosumi-git installer pipeline に渡します。

repo deploy / install の version は catalog が解決する Git ref / tag
が基準です。 `.takosumi/manifest.yml` に top-level `version` field
はありません。display version は release tag、catalog metadata、または
`.takosumi/app.yml` の metadata から導きます。

```yaml
# .takosumi/app.yml
apiVersion: app.takosumi.dev/v1
kind: InstallableApp
source:
  git: https://github.com/example/my-app
  ref: v1.2.0
  commit: 0123456789abcdef0123456789abcdef01234567
```

group がある場合も、source 情報は AppInstallation / deployment metadata
に保存します。

- `local`: takos deploy で手元から deploy
- `repo:owner/repo@v1.2.0`:
  `takos install owner/repo --version v1.2.0 --space SPACE_ID --group NAME` で
  catalog が解決した repo/ref から deploy

Installable App Model における source pin は AppInstallation 行の `sourceCommit`
/ `appManifestDigest` / `compiledManifestDigest` の 3 列で 表現されます (詳細は
[AppInstallation 台帳](./app-installation.md))。

## まとめ

```text
Takos deploy system (Installable App Model 整合):

  3 deploy paths
    1. Install path     (POST /v1/installations    → installer pipeline → kernel apply)
    2. Upgrade path     (POST /v1/installations/:id/upgrade → 同 pipeline 再走)
    3. GitOps binding   (Takos → git push          → takosumi-git watcher → kernel apply)

  Compiled manifest (kernel に渡る最終形)
    - workflowRef は strip 済み
    - ${bindings.*} / ${secrets.*} / ${artifacts.*} / ${installation.*} は解決済み
    - ${ref:...} / ${secret-ref:...} / ${imports.*} は kernel deploy route が扱う
    - kernel は app.yml を解釈しない

  Core records (kernel 内部)
    - Deployment (input / resolution / desired / conditions)
    - ProviderObservation (observed state stream)
    - GroupHead (current / previous deployment pointer)
    - ResourceInstance / MigrationLedger (durable state)

  Shape authoring surface
    - resources[] (worker / web-service / database-postgres / object-store / custom-domain / ...)
    - imports[] + serviceResolvers[]
    - template expansion

  Optional group scope
    - groups row
    - features: deploy / history / rollback / uninstall
```

## 次に読むページ

- [Installable App Model](./installable-app-model.md) — 全体像と product / layer
  責務分離
- [Installer Pipeline](./installer-pipeline.md) — 13 step の install pipeline
  詳細
- [AppInstallation 台帳](./app-installation.md) — source pin と status 遷移
- [.takosumi/app.yml spec](/reference/app-yml-spec) — installer-bound manifest
- [Binding Catalog](/reference/binding-catalog) — 6 種の installer-bound
  AppBinding type
- [Install API](/reference/install-api) — `POST /v1/installations` 等
- [Upgrade / Export](/platform/upgrade-export) — upgrade / rollback / export
- [deploy CLI ガイド](/deploy/deploy) — operator / internal context での deploy
