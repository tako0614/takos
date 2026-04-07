# Deploy Group

> このページでわかること: deploy group の概念、作成方法、管理コマンド、
> `takos deploy` / `takos install` との関係。

Takos の deploy system は **二層モデル**:

- **Layer 1 (foundation)**: primitive (compute / storage / route / publish)
  はそれぞれ独立した 1st-class エンティティで、個別の lifecycle を持つ
- **Layer 2 (上位 bundling layer)**: group は複数の primitive を束ねて、bulk
  lifecycle と desired state management を提供する optional な仕組み

このページは Layer 2 (group) を扱います。primitive を個別に操作する場合は
[Deploy System](/architecture/deploy-system) と
[CLI リファレンス](/reference/cli) を参照してください。

## group とは

group は **複数の primitive を束ねた bulk lifecycle unit** です。同じ manifest
から宣言された primitive 群を 1 つの単位として扱い、snapshot / rollback /
uninstall を一括で適用できます。

- 構成要素: 0..N 個の primitive (compute, storage, route, publish)
- manifest authoring: `.takos/app.yml` に宣言した primitive 群が自動的に
  group としてまとめられる
- bulk lifecycle: snapshot / rollback / uninstall は group 単位で実行
- standalone primitive を後から既存 group に所属させることも可能
  (`PATCH /api/services/:id/group` / `PATCH /api/resources/:id/group`)
- primitive を group に所属させない選択肢もある (standalone primitive)。
  その場合は primitive それぞれが独立した lifecycle unit になる

group が束ねる情報:

- desired state: `app.yml` から deploy された宣言的な desired manifest
- observed state: 実際に deploy された workload / resource のスナップショット
- inventory: group に属する compute / storage / route / publish の一覧

primitive が 1st-class で、group は primitive 群の bulk lifecycle を提供する
上位レイヤーです。

## group の作成

group は明示的に作成する必要はありません。`takos deploy` / `takos install` を
実行したとき、対象の group が存在しなければ自動的に作成されます。

```bash
takos deploy --env staging
```

group 名は `--group` で明示指定するか、省略時は manifest の `name` が使われます。

```bash
takos deploy --env staging --group my-custom-group
```

::: info group 名の解決順

1. `--group` オプションで指定された名前
2. `.takos/app.yml` の `name`
:::

## group の管理

### 一覧

```bash
takos group list
```

### 詳細表示

```bash
takos group show my-app
```

### desired manifest の取得・置換

```bash
takos group desired get my-app
takos group desired put my-app --file app.yml
```

### 削除

```bash
takos group delete my-app
```

::: danger
group を削除すると、紐づく desired state と inventory が消えます。稼働中の
workload がある場合は先に `takos uninstall` で停止・削除してください。
:::

## deploy / install と group の関係

| 観点 | local manifest deploy | repo URL deploy / `takos install` |
| --- | --- | --- |
| source | local working tree | repository URL / catalog metadata |
| group 作成 | 未作成なら初回 deploy 時に作成 | 未作成なら初回 deploy 時に作成 |
| group 指定 | `--group` または `name` | `--group` または API body の `group_name` |
| desired 更新 | manifest を group desired に保存 | repo source から解決した manifest を group desired に保存 |
| snapshot 作成 | immutable snapshot を作る | immutable snapshot を作る |
| rollback | `takos rollback GROUP_NAME` | `takos rollback GROUP_NAME` |

どちらの経路でも、最終的には group の desired state が更新され、差分が計算されて
primitive に反映されます。lifecycle は両者で同一であり、`source` field は manifest
の出どころを示す metadata でしかありません。

## マルチテナント構成での group

同じ manifest を複数の group に deploy
することで、テナントごとに独立した環境を作れます。

```bash
takos deploy --env production --group tenant-a
takos deploy --env production --group tenant-b
```

Cloudflare backend では worker の実配置先として dispatch namespace
が使われるが、それは operator / backend 側の detail。current public CLI
に `--namespace` option はありません。

## マイクロサービス構成での group

サービスごとに独立した group を作る方法と、1 つの group
にまとめる方法があります。

### サービスごとに分離

```bash
cd api-service && takos deploy --env staging --group api
cd job-worker && takos deploy --env staging --group jobs
```

### 1 つの group にまとめる

```yaml
name: full-stack

compute:
  api:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-api
        artifact: api
        artifactPath: dist/api.js
  jobs:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-jobs
        artifact: jobs
        artifactPath: dist/jobs.js

storage:
  main-db:
    type: sql
    bind: DB
```

1 回の `takos deploy` で全 workload をまとめて deploy できます。

## standalone primitive と group の関係

primitive (compute / storage / route / publish) は 1st-class エンティティです。
group に所属させずに standalone で作成することも、後から group に所属させる
こともできます。

```text
group "my-app" (bundling layer):
  compute: web    ┐
  storage: db     │ group の lifecycle で一括管理
  storage: files  │ (snapshot / rollback / uninstall)
  route: app      ┘

standalone primitive (group に属さない、それぞれ独立 lifecycle):
  compute: cron-job
  storage: shared-cache
  route: legacy-redirect
```

standalone primitive の作成・操作は CLI の `takos worker` / `takos resource` /
`takos route` などの個別コマンドか、API 直接呼び出しで行います。 既存 standalone
primitive を group に所属させたい場合は `PATCH /api/services/:id/group` /
`PATCH /api/resources/:id/group` を使います。

詳細は [Deploy System](/architecture/deploy-system) を参照してください。

## API

group の管理に使う API です。

```text
GET    /api/spaces/:spaceId/groups
POST   /api/spaces/:spaceId/groups
GET    /api/spaces/:spaceId/groups/:groupId
PATCH  /api/spaces/:spaceId/groups/:groupId/metadata
GET    /api/spaces/:spaceId/groups/:groupId/desired
PUT    /api/spaces/:spaceId/groups/:groupId/desired
DELETE /api/spaces/:spaceId/groups/:groupId
GET    /api/spaces/:spaceId/groups/:groupId/resources
GET    /api/spaces/:spaceId/groups/:groupId/services
GET    /api/spaces/:spaceId/groups/:groupId/deployments
POST   /api/spaces/:spaceId/groups/:groupId/plan
POST   /api/spaces/:spaceId/groups/:groupId/apply
POST   /api/spaces/:spaceId/groups/uninstall
```

## ユースケース

| パターン | group 構成 | 向いているケース |
| --- | --- | --- |
| 単一アプリ | 1 manifest = 1 group | 小〜中規模のアプリ |
| マルチテナント | 同一 manifest × N group | SaaS でテナントごとに隔離 |
| マイクロサービス | サービスごとに独立 group | 独立した deploy cycle |
| モノリス | 全 workload を 1 group | 密結合で共有 resource が多い場合 |

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- `takos deploy URL` /
  `takos install`
- [Dispatch Namespace](/deploy/namespaces) --- Cloudflare backend 側の namespace detail
- [ロールバック](/deploy/rollback) --- rollback の手順
