# Deploy Group

> このページでわかること: group の役割、group に所属した primitive が使える機能、AppInstallation 台帳との関係、Takos
> compatibility deploy surface との関係。

> 現行実装の split status は
> [Current Implementation Note](https://github.com/tako0614/takosumi/blob/master/docs/reference/architecture/index.md#deploy-shell)
> を参照

## Group / Installation / Primitive の階層

Takos / Takosumi の deploy model は次の 3 階層で考えると整理しやすいです。

| 階層                           | 表すもの                                                                                  | 所有者 / ownership ledger                |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| **AppInstallation**            | Takosumi Account に install された app 1 件                                               | AppInstallation 台帳 (Takosumi Accounts) |
| **Group**                      | Deployment record を順序付ける scope                                                      | `groups` row + GroupHead                 |
| **Primitive / Shape resource** | worker / web-service / database / custom-domain などの Shape resource と route projection | `Deployment.desired` の field            |

**Installation は group の一種ではありません**。`.takosumi/app.yml` (`kind: InstallableApp`) で declaration された app
を Takosumi Account に install すると、AppInstallation 台帳が ownership / billing / grant / launch token
を提供し、installer がその install に対応する Deployment / group inventory を 作ることがあります。つまり:

- AppInstallation 台帳: 「誰の Takosumi Account に install されたか」 「どの Space に紐づくか」 「どの binding
  が承認されたか」 を持つ ownership ledger
- Group: その installation または unmanaged deploy が apply した primitive の集合と、deployment history / rollback /
  uninstall の compatibility state scope
- Primitive: group inventory に projection される実 record

詳細は
[AppInstallation アーキテクチャ](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/app-installation.md)
を参照して ください。

なお、manifest を `takosumi deploy <manifest>` または kernel `POST /v1/deployments` に直接投下する flow
では、AppInstallation 台帳を介さない unmanaged deployment として扱われます。group は installation を伴わない primitive
集合としても扱えます。

Takos の group は **Deployment record を順序付ける compatibility state scope** です。Shape resource / route projection
は group に所属していても、 所属していなくても同じ Deployment record (`Deployment` / `ProviderObservation`)
を通ります。group inventory は authoring/API の projection であり、Core が 新しい built-in kind
を持つという意味ではありません。

group に所属することで変わるのは、その primitive を含む Deployment が GroupHead 経由で履歴・rollback
の対象になることだけです。

- inventory: group に属する primitive を一覧できる
- resolve / apply: manifest や repository から複数 primitive を 1 つの Deployment にまとめて resolve + apply できる
- deployment history: GroupHead 経由で applied Deployment と、その `previous_deployment_id` をたどれる
- rollback: GroupHead を retained Deployment へ切り替えられる
- uninstall: group に属する manifest-managed primitive をまとめて削除できる
- updates: repository / catalog source と照合して更新候補を見られる

group は runtime backend、resource provider、routing layer ではありません。group なしの primitive も、group 所属
primitive も、個別 API / runtime / resource binding 上は同じ扱いです。

## group とは

group は `groups` row として保存される optional scope です。group 自体は workload を実行せず、primitive
の集合と、その集合に対する GroupHead / Deployment 履歴 state を持ちます。

- 構成要素: 0..N 個の Shape resource / route projection / binding report
- 所属: primitive は `group_id` を持つことで group inventory に入る
- 入力: manifest / repository / catalog install / API から Deployment を resolve
  - apply できる
- 境界: group 所属は runtime の特権や resource の特別処理を意味しない

manifest は group 専用ファイルではありません。manifest に書かれた primitive declaration を resolve するとき、既定では
manifest の `name` が所属先 group 名になります。`--group` や API の `group` body field は override として使います。
group を指定しない primitive は、同じ primitive API で個別に管理できます。

## group の作成

group は明示的に作成できます。Takos compatibility deploy surface で group 名を指定した場合、対象 group がなければ apply
時に GroupHead 初期化と一緒に 作成されます。

```bash
takos deploy --env staging --space SPACE_ID --group my-app
```

group 名は manifest の `name` から暗黙解決されます。`--group` は同じ manifest を別 group
名で展開したい場合にだけ指定します。

```bash
takos deploy --env staging --space SPACE_ID --group my-custom-group
```

::: info Takos compatibility deploy surface は GroupHead を advance します。 manifest の `name` が group
名になり、`--group` は override です。group なし primitive は個別 primitive API で管理します。 :::

## group の管理

### 一覧

```bash
takos group list --space SPACE_ID
```

### 詳細表示

```bash
takos group show my-app --space SPACE_ID
```

### Deployment 履歴

GroupHead と applied Deployment 履歴は Takos compatibility API で確認できます。

```text
GET /api/public/v1/groups/:group_id/head
GET /api/public/v1/deployments?group=GROUP_ID&status=applied
```

### 削除

```bash
takos group delete my-app --space SPACE_ID
```

::: danger group を削除すると、group inventory と GroupHead が消えます。 稼働中の workload がある場合は先に
`takos uninstall GROUP_NAME --space SPACE_ID` で停止・削除してください。 :::

## deploy / install と group の関係

| 観点               | local manifest flow                                                     | repo URL deploy / legacy `takos install`                                |
| ------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| source             | local working tree                                                      | repository URL / catalog metadata                                       |
| group 作成         | group 指定時、未作成なら apply 時に GroupHead と一緒に作成              | group 指定時、未作成なら apply 時に GroupHead と一緒に作成              |
| group 指定         | `--group`                                                               | `--group` または API body の `group`                                    |
| Deployment.input   | CLI / takosumi-git が compiled manifest snapshot / artifacts を送る     | Deployment service が repo source から Deployment.input を組む          |
| Deployment.desired | Deployment.desired に Shape resources / routes / bindings report を pin | Deployment.desired に Shape resources / routes / bindings report を pin |
| rollback           | GroupHead を retained Deployment に切り替え                             | GroupHead を retained Deployment に切り替え (commit 再解決)             |

どちらの経路でも、manifest は Deployment.input.manifest_snapshot の入力です。 `source.kind` は local manifest flow では
`manifest`、repo URL / install では `git_ref` で、Deployment.input の出どころを示す metadata です。Deployment.desired の
構造の差ではありません。

## マルチテナント構成での group

同じ primitive declaration を複数の group に apply することで、テナントごとに 独立した GroupHead と Deployment
履歴を作れます。

```bash
takos deploy --env production --space SPACE_ID --group tenant-a
takos deploy --env production --space SPACE_ID --group tenant-b
```

tracked reference Workers backend では worker の実配置先として dispatch namespace が使われますが、それは operator-only
backend detail です。public CLI に `--namespace` option はありません。

## マイクロサービス構成での group

サービスごとに独立した group を作ることも、複数 service を 1 つの group inventory に入れることもできます。どちらの場合も
service primitive 自体の runtime は同じです。

### サービスごとに分離

```bash
cd api-service && takos deploy --env staging --space SPACE_ID --group api
cd job-worker && takos deploy --env staging --space SPACE_ID --group jobs
```

### 1 つの group にまとめる

```yaml
apiVersion: '1.0'
kind: Manifest
metadata:
  name: full-stack
resources:
  - shape: web-service@v1
    name: api
    provider: '@takos/self-hosted-process'
    spec:
      image: ghcr.io/acme/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      port: 8080
      scale:
        min: 1
        max: 3
      env:
        DATABASE_URL: ${secret-ref:DATABASE_URL}
  - shape: worker@v1
    name: jobs
    provider: '@takos/cloudflare-workers'
    spec:
      artifact:
        kind: js-bundle
        hash: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
      compatibilityDate: '2026-05-09'
```

1 回の deploy で複数 workload を 1 つの Deployment にまとめ、同じ group inventory に入れられます。`api` は digest-pinned
image を直接使う service です。`jobs` のような worker bundle は takosumi-git が `workflowRef` を解決し、 kernel
に届く前に concrete artifact hash を materialize します。

## Primitive と group の関係

control plane は Shape resource / route projection / binding report を Deployment.desired の field として扱います。group
はこれらを順序付けて 履歴・rollback できる optional scope です。

```text
group "my-app":
  groups row:
    inventory / source metadata / GroupHead pointer / reconcile status
  GroupHead:
    current_deployment_id / previous_deployment_id / generation
  group features:
    resolve / apply / deployment history / rollback / uninstall / updates
  inventory:
    resource: web (web-service@v1)
    resource: jobs (worker@v1)
    resource: shared-cache

group なし primitive:
  resource: background-worker (worker@v1)
  resource: shared-db
  route/custom-domain: redirect
```

既存 service / resource を group inventory に入れたい場合は `PATCH /api/services/:id/group` /
`PATCH /api/resources/:id/group` を使います。 所属を外しても primitive 自体の record と runtime model は変わりません。

詳細は [Deploy System](https://github.com/tako0614/takosumi/blob/master/docs/reference/architecture/deploy-system.md)
を参照してください。

## API

group + Deployment lifecycle で使う Takos compatibility public API です。takosumi kernel の public surface
ではありません。

```text
GET    /api/public/v1/deployments?group=GROUP_ID&status=
GET    /api/public/v1/groups/:group_id/head
POST   /api/public/v1/groups/:group_id/rollback
```

advanced な group inventory 管理は次の HTTP API で行えます。

```text
GET    /api/spaces/:spaceId/groups
POST   /api/spaces/:spaceId/groups
POST   /api/spaces/:spaceId/groups/uninstall
GET    /api/spaces/:spaceId/groups/:groupId
PATCH  /api/spaces/:spaceId/groups/:groupId/metadata
DELETE /api/spaces/:spaceId/groups/:groupId
GET    /api/spaces/:spaceId/groups/:groupId/resources
GET    /api/spaces/:spaceId/groups/:groupId/services
GET    /api/spaces/:spaceId/groups/:groupId/updates
```

## ユースケース

| パターン         | group 構成                       | 向いているケース                  |
| ---------------- | -------------------------------- | --------------------------------- |
| 単一 group       | 1 manifest を明示 group に apply | 小〜中規模の product              |
| マルチテナント   | 同一 declaration × N group       | SaaS でテナントごとに隔離         |
| マイクロサービス | service ごとに group             | 独立した deploy cycle             |
| モノリス         | 全 workload を 1 group           | 密結合で共有 lifecycle が多い場合 |

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- `takos deploy URL` / `takos install`
- [Dispatch Namespace](/deploy/namespaces) --- tracked reference Workers backend 側の namespace detail
- [ロールバック](/deploy/rollback) --- rollback の手順
