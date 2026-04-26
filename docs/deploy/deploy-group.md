# Deploy Group

> このページでわかること: group の役割、group に所属した primitive
> が使える機能、`takos deploy` / `takos install` との関係。

Takos の group は **primitive を任意に束ねる state scope** です。service /
resource / route / publication は group に所属していても、所属していなくても同じ
primitive record として存在します。

group に所属することで変わるのは、primitive が group
の機能を使えることだけです。

- inventory: group に属する primitive を一覧できる
- plan / apply: manifest や repository から複数 primitive をまとめて preview /
  apply できる
- deployment history: group に属する deployable primitive の applied state
  と source metadata を履歴として保存できる
- rollback: 前回成功 deployment record へ戻せる
- uninstall: group に属する manifest-managed primitive をまとめて削除できる
- updates: repository / catalog source と照合して更新候補を見られる

group は runtime backend、resource provider、routing layer ではありません。group
なしの primitive も、group 所属 primitive も、個別 API / runtime / resource
binding 上は同じ扱いです。

## group とは

group は `groups` row として保存される optional scope です。group 自体は
workload を実行せず、primitive の集合と、その集合に対する group 機能の state
を持ちます。

- 構成要素: 0..N 個の service / resource / route / publication / consume edge
- 所属: primitive は `group_id` を持つことで group inventory に入る
- 入力: manifest / repository / catalog install / API から primitive declaration
  を apply できる
- 境界: group 所属は runtime の特権や resource の特別処理を意味しない

manifest は group 専用ファイルではありません。manifest に書かれた primitive
declaration を apply するとき、既定では manifest の `name` が所属先 group
名になります。`--group` や API の `group_name` は override として使います。
group を指定しない primitive は、同じ primitive API で個別に管理できます。

## group の作成

group は明示的に作成できます。`takos deploy` / `takos install` で group
名を指定した場合、対象 group がなければ apply 時に作成されます。

```bash
takos deploy --env staging --space SPACE_ID --group my-app
```

group 名は manifest の `name` から暗黙解決されます。`--group` は同じ manifest
を別 group 名で展開したい場合にだけ指定します。

```bash
takos deploy --env staging --space SPACE_ID --group my-custom-group
```

::: info `takos deploy` / `takos install` は group deployment history を使います。
manifest の `name` が group 名になり、`--group` は override です。group なし
primitive は個別 primitive API で管理します。
:::

## group の管理

### 一覧

```bash
takos group list --space SPACE_ID
```

### 詳細表示

```bash
takos group show my-app --space SPACE_ID
```

### declaration の取得・置換

group-scoped declaration の直接取得・置換は advanced API surface です。通常は
`takos deploy --plan` / `takos deploy` を使って preview / apply します。

### 削除

```bash
takos group delete my-app --space SPACE_ID
```

::: danger group を削除すると、group inventory と group-scoped state
が消えます。稼働中の workload がある場合は先に
`takos uninstall GROUP_NAME --space SPACE_ID` で停止・削除してください。
:::

## deploy / install と group の関係

| 観点          | local manifest flow                      | repo URL deploy / `takos install`           |
| ------------- | ---------------------------------------- | ------------------------------------------- |
| source        | local working tree                       | repository URL / catalog metadata           |
| group 作成    | group 指定時、未作成なら apply 時に作成  | group 指定時、未作成なら apply 時に作成     |
| group 指定    | `--group`                                | `--group` または API body の `group_name`   |
| declaration   | manifest の primitive declaration を保存 | repo source から解決した declaration を保存 |
| deployment record | group 指定時は manifest / artifacts を記録 | group 指定時は repository URL / ref / commit を記録 |
| rollback      | 前回成功 record の manifest / artifacts を使う | 前回成功 record の commit を source redeploy |

どちらの経路でも、manifest は primitive declaration の入力です。source kind は
local manifest flow では `manifest`、repo URL / install では `git_ref`
で、manifest の出どころを示す metadata です。lifecycle の差ではありません。

## マルチテナント構成での group

同じ primitive declaration を複数の group に apply することで、テナントごとに
独立した inventory と deployment history を作れます。

```bash
takos deploy --env production --space SPACE_ID --group tenant-a
takos deploy --env production --space SPACE_ID --group tenant-b
```

Cloudflare backend では worker の実配置先として dispatch namespace
が使われますが、それは operator-only backend detail です。public CLI に
`--namespace` option はありません。

## マイクロサービス構成での group

サービスごとに独立した group を作ることも、複数 service を 1 つの group
inventory に入れることもできます。どちらの場合も service primitive 自体の
runtime は同じです。

### サービスごとに分離

```bash
cd api-service && takos deploy --env staging --space SPACE_ID --group api
cd job-worker && takos deploy --env staging --space SPACE_ID --group jobs
```

### 1 つの group にまとめる

```yaml
name: full-stack

env:
  DATABASE_URL: postgres://example.local/main

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
```

1 回の `takos deploy --group full-stack` で複数 workload を同じ group inventory
に入れられます。

## Primitive と group の関係

control plane は worker / service / resource / route / publication / consume
を個別 primitive として扱います。group はこれらをまとめる optional scope です。

```text
group "my-app":
  groups row:
    inventory / source metadata / current deployment pointer / reconcile status
  group features:
    plan / apply / deployment history / rollback / uninstall / updates
  inventory:
    service: web
    route: /
    publication: files
    resource: shared-cache

group なし primitive:
  service: cron-job
  resource: shared-db
  route/custom-domain: redirect
```

既存 service / resource を group inventory に入れたい場合は
`PATCH /api/services/:id/group` / `PATCH /api/resources/:id/group` を使います。
所属を外しても primitive 自体の record と runtime model は変わりません。

詳細は [Deploy System](/architecture/deploy-system) を参照してください。

## API

group 機能に使う API です。

```text
GET    /api/spaces/:spaceId/groups
POST   /api/spaces/:spaceId/groups
POST   /api/spaces/:spaceId/groups/plan        # group_name 指定の preview
POST   /api/spaces/:spaceId/groups/apply       # group_name 指定の apply
POST   /api/spaces/:spaceId/groups/uninstall
POST   /api/spaces/:spaceId/groups/by-name/:groupName/rollback
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
POST   /api/spaces/:spaceId/groups/:groupId/rollback
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
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- `takos deploy URL` /
  `takos install`
- [Dispatch Namespace](/deploy/namespaces) --- Cloudflare backend 側の namespace
  detail
- [ロールバック](/deploy/rollback) --- rollback の手順
