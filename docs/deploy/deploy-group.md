# Deploy Group

> このページでわかること: deploy group
> の概念、作成方法、管理コマンド、`takos apply` / `takos deploy` との関係。

Deploy group は Takos のデプロイ単位です。1 つの group が 1
つのアプリケーションに対応し、workers・resources・routes・services
をまとめて管理します。`takos apply` や `takos deploy` の結果はすべて group
に反映されます。

## group とは

group は以下を束ねる論理的なコンテナです。

- **desired state**: `app.yml` から apply された宣言的な desired app manifest
- **observed state**: 実際に deploy された workload / resource
  の状態スナップショット
- **inventory**: group に属する worker・resource・route・service の一覧

group を使うことで、複数の worker や resource を 1
つの単位としてデプロイ・ロールバック・削除できます。

## group の作成

group は明示的に作成する必要はありません。`takos apply` を実行したとき、対象の
group が存在しなければ自動的に作成されます。

```bash
# group "my-app" が存在しなければ初回 apply 時に作成される
takos apply --env staging
```

group 名は `--group` で明示指定するか、省略時は `metadata.name` が使われます。

```bash
# group 名を明示指定
takos apply --env staging --group my-custom-group
```

::: info group 名の解決順

1. `--group` オプションで指定された名前
2. `.takos/app.yml` の `metadata.name` :::

## group の管理

### 一覧

```bash
takos group list
```

Space 内のすべての group を表示します。

### 詳細表示

```bash
takos group show my-app
```

group に属する worker・resource・route・service のインベントリを表示します。

### desired manifest の取得・置換

```bash
# desired app manifest を取得
takos group desired get my-app

# desired app manifest を置換
takos group desired put my-app --file app.yml
```

### 削除

```bash
takos group delete my-app
```

::: danger group を削除すると、紐づく desired state
とインベントリが消えます。稼働中の workload
がある場合は先に個別に削除してください。 :::

## apply / deploy と group の関係

| 観点         | `takos apply`                    | `takos deploy` / `takos install`                  |
| ------------ | -------------------------------- | ------------------------------------------------- |
| source       | local working tree               | repository URL + ref                              |
| group 作成   | 未作成なら初回 apply 時に作成    | 未作成なら初回 apply 時に作成                     |
| group 指定   | `--group` または `metadata.name` | `--group` または API body の `group_name`         |
| desired 更新 | manifest を group desired に保存 | control plane が source を解決して desired に保存 |

どちらの経路でも、最終的には group の desired state
が更新され、差分が計算されて反映されます。

## マルチテナント構成での group

同じ manifest を複数の group
にデプロイすることで、テナントごとに独立した環境を作れます。

```bash
# テナント A
takos apply --env production \
  --namespace production-tenants \
  --group tenant-a

# テナント B
takos apply --env production \
  --namespace production-tenants \
  --group tenant-b
```

`--namespace` と組み合わせると、Worker 名に group
名がプレフィックスとして付き、同じ dispatch namespace 内で複数テナントの Worker
を共存させられます。

## マイクロサービス構成での group

サービスごとに独立した group を作る方法と、1 つの group
にまとめる方法があります。

### サービスごとに分離

```bash
# API サービス
cd api-service && takos apply --env staging --group api

# Worker サービス
cd job-worker && takos apply --env staging --group jobs
```

サービスごとに独立してデプロイ・ロールバックできます。依存関係がゆるい場合に適しています。

### 1 つの group にまとめる

```yaml
# .takos/app.yml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: full-stack
spec:
  version: 1.0.0
  workers:
    api:
      build: ...
    jobs:
      build: ...
  resources:
    main-db:
      type: d1
      binding: DB
```

1 回の `takos apply` で全 workload
をまとめてデプロイできます。密結合なサービスや共有 resource
がある場合に適しています。

## API

group の管理に使う API です。

```text
GET    /api/spaces/:spaceId/groups                      # 一覧
POST   /api/spaces/:spaceId/groups                      # 作成
GET    /api/spaces/:spaceId/groups/:groupId              # 詳細
PATCH  /api/spaces/:spaceId/groups/:groupId/metadata     # metadata 更新
GET    /api/spaces/:spaceId/groups/:groupId/desired      # desired manifest 取得
PUT    /api/spaces/:spaceId/groups/:groupId/desired      # desired manifest 置換
DELETE /api/spaces/:spaceId/groups/:groupId              # 削除
GET    /api/spaces/:spaceId/groups/:groupId/resources    # リソース一覧
GET    /api/spaces/:spaceId/groups/:groupId/services     # サービス一覧
GET    /api/spaces/:spaceId/groups/:groupId/deployments  # デプロイ一覧
POST   /api/spaces/:spaceId/groups/:groupId/plan         # プラン
POST   /api/spaces/:spaceId/groups/:groupId/apply        # 適用
```

## ユースケース

| パターン         | group 構成               | 向いているケース                 |
| ---------------- | ------------------------ | -------------------------------- |
| 単一アプリ       | 1 manifest = 1 group     | 小〜中規模のアプリ               |
| マルチテナント   | 同一 manifest × N group  | SaaS でテナントごとに隔離        |
| マイクロサービス | サービスごとに独立 group | 独立したデプロイサイクル         |
| モノリス         | 全 workload を 1 group   | 密結合で共有 resource が多い場合 |

## 次のステップ

- [apply](/deploy/apply) --- `takos apply` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- `takos deploy` /
  `takos install`
- [Namespace](/deploy/namespaces) --- マルチテナントの namespace 分離
- [ロールバック](/deploy/rollback) --- ロールバックの手順
