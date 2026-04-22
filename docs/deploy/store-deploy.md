# Repository / Catalog デプロイ

> このページでわかること: `takos deploy` / `takos install` の current surface
> と、ローカル deploy / repo deploy / catalog install の役割分担。Store は発見と
> source 解決を担当し、deploy pipeline は primitive declaration を apply する。

Takos の deploy 入口はシンプルです。

- `takos deploy`: ローカル manifest（primary）または repository URL から
  manifest の `name` で決まる group inventory へ primitive declaration を apply する
- `takos install owner/repo --version TAG`: catalog (Store) が
  owner/repo + version/tag を repository URL + Git tag に解決し、内部的には
  `takos deploy` と同じ pipeline を通る

両者はどちらも同じ group-scoped `takos deploy` pipeline を通ります。manifest
の `name` または `--group` override で決まる group に、作成・更新された primitive
が所属し、group snapshot などの group 機能を使えます。`takos install` は catalog
で発見した package を楽に呼び出すための薄いラッパーです。

## Store の役割

Store は ActivityPub ベースのリポジトリ発見 SNS。

- リポジトリを検索・発見する
- フォロー先のリポジトリがフィードに流れてくる
- リポジトリに deploy manifest (`.takos/app.yml` / `.takos/app.yaml`) がある =
  installable マーク

Store は発見と source 解決を担当します。install / update / rollback の実行は
deploy pipeline と group 機能が担当します。

## 基本的な使い方

```bash
# local manifest から deploy（primary）
takos deploy --space SPACE_ID
takos deploy --env staging --space SPACE_ID
takos deploy --plan --space SPACE_ID
```

```bash
# repository URL から deploy
takos deploy https://github.com/acme/my-app.git --space SPACE_ID --ref main
```

```bash
# catalog で発見した repo を install
takos install owner/repo --space SPACE_ID
takos install owner/repo --space SPACE_ID --version v1.0.0
```

`--version v1.0.0` を使って version を指定します。

## local deploy と repo deploy / install の違い

ローカル manifest 由来でも repo URL / catalog 由来でも、`takos deploy` の
lifecycle は同じです。違いは「manifest がどこから来るか」という provenance
だけです。

repo URL / `takos install` を使う場合、**CLI は repository URL を control plane
に渡す。control plane が repo を fetch し、manifest を parse し、deploy pipeline
を実行する。CLI 側で repo を clone することはない。** CLI は thin client として
振る舞います。

| 観点            | local manifest flow                                     | repo URL deploy / `takos install`                                                        |
| --------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| source          | local working tree                                      | repo URL deploy: `repository_url + ref/ref_type`; install: catalog version/tag → Git tag |
| source 解決     | CLI が manifest / artifact を読む                       | control plane が repo を fetch して manifest を parse する（CLI は URL を渡すだけ）      |
| primitive apply | worker / service / route / publication / grant を apply | worker / service / route / publication / grant を apply                                  |
| group snapshot  | group 指定時に作る                                      | group 指定時に作る                                                                       |
| rollback        | group snapshot がある場合に再適用                       | group snapshot がある場合に再適用                                                        |
| API source kind | `manifest`                                              | `git_ref`                                                                                |
| 表示名          | `local`                                                 | `repo:owner/repo@ref`                                                                    |
| 主な用途        | 開発中の manifest 反映                                  | release / catalog install / repo-based deploy                                            |

API source kind は `manifest` / `git_ref` で分かれますが、これは manifest
の出どころを示す metadata です。lifecycle の差ではありません。

## `takos deploy`

`takos deploy` はローカル manifest からの deploy（primary）と repository URL
からの deploy（alternative）の両方を扱います。

```bash
# local manifest から deploy
takos deploy --env staging --space SPACE_ID

# repository URL から deploy
takos deploy https://github.com/acme/my-app.git \
  --space SPACE_ID \
  --ref main \
  --env staging

# dry-run preview
takos deploy --plan --space SPACE_ID
```

positional argument を省略するとローカルの `.takos/app.yml` または
`.takos/app.yaml` を source にします。repo URL を指定した場合、ref を省略すると
repository 側の既定 branch 解決に従います。

## `takos install`

`takos install OWNER/REPO --version TAG` は `takos deploy` の
sugar です。catalog (Store) が owner/repo + version/tag を repository URL + Git
tag に解決し、`source.kind = "git_ref"` / `ref_type = "tag"` として同じ call
path を通ります。CLI 自身は repo を clone せず、control plane が repo source
を解決します。

```bash
# 以下は等価
takos install owner/repo --version v1.2.0 --space SPACE_ID
takos deploy https://github.com/owner/repo.git --ref v1.2.0 --ref-type tag --space SPACE_ID
```

target space に Store app-label / package が install
されている必要はありません。Store は発見に使えますが、install
の実行には不要です。

## `takos rollback`

rollback は group snapshot を再適用する group 機能です。

```bash
takos rollback my-app --space SPACE_ID
```

- 引数は group 名
- code + config + consume declarations が snapshot の状態に戻る
- consumed publication output values は rollback 実行時に再解決される
- DB data は戻らない（forward-only migration）
- group がすでに削除されている場合は失敗し、deleted group を再生成しない

## デプロイ前の検証

manifest 由来の差分確認には
`takos deploy --plan --space SPACE_ID` を使います。

```bash
takos deploy --plan --space SPACE_ID
```

`takos deploy --plan --space SPACE_ID` は non-mutating preview
です。group が未作成でも DB row は作りません。

ローカル manifest 経路では、CLI が `source.kind = "manifest"` payload を作る前に
worker bundle の build output を確認します。`artifactPath` は public manifest
schema では optional の local/private build metadata ですが、local deploy で
workflow artifact から worker bundle を収集する場合は、単一 bundle file、または
`.js` / `.mjs` / `.cjs` が 1 つだけに定まる directory artifact
を指す必要があります。 repo/committed bundle 経路では `build.artifact` や
committed bundle discovery に fallback します。`--target` は `--plan`
時だけ使え、指定した target に一致する compute workload の artifact
だけを確認します。apply では `--target` を使えません。

## デプロイ状態の確認

```bash
takos deploy status --space SPACE_ID
takos deploy status GROUP_DEPLOYMENT_SNAPSHOT_ID --space SPACE_ID
takos group show my-app --space SPACE_ID
```

## Source tracking

group は source 情報を持てます。

- `local`: ローカル manifest を `takos deploy` で手元から deploy
- `repo:owner/repo@v1.2.0`:
  `takos install owner/repo --version v1.2.0 --space SPACE_ID`
  または `takos deploy URL --space SPACE_ID` で repo から deploy

どちらの source の group も、新しい code を反映するには
`takos deploy --space SPACE_ID` を再実行します。別名 group へ反映したい場合は
`--group NAME` を override として指定します。

## イメージ参照の制約

`compute.<name>` の image-backed workload を online deploy するときは `image` に
digest pin (64-hex `sha256` digest) が必要です。mutable tag (`:latest` など)
は受け付けません。

## public repo の取得

public HTTPS repo の deploy は、通常は git smart protocol で source
を解決します。まず bounded/configurable な full pack を試し、pack size / object
count / inflated size のような content-size・pack-limit 系の失敗だけを blobless
partial fetch の対象にします。任意の fetch error で次段へ fall through
するわけではありません。remote が `filter` と `allow-reachable-sha1-in-want` を
advertise している場合だけ blobless partial fetch に進みます。GitHub / GitLab の
public repo では、archive download も host-specific な取得経路の 1 つとして
使います。

## API

local / repo / catalog source の snapshot history には、HTTP API path family
`group-deployment-snapshots` を使います。扱う対象は group snapshot です。

```text
POST   /api/spaces/:spaceId/group-deployment-snapshots/plan
POST   /api/spaces/:spaceId/group-deployment-snapshots
GET    /api/spaces/:spaceId/group-deployment-snapshots
GET    /api/spaces/:spaceId/group-deployment-snapshots/:groupDeploymentSnapshotId
POST   /api/spaces/:spaceId/group-deployment-snapshots/:groupDeploymentSnapshotId/rollback
DELETE /api/spaces/:spaceId/group-deployment-snapshots/:groupDeploymentSnapshotId
```

group 機能には advanced HTTP API として group API もあります。public CLI の通常
path は `takos deploy` / `takos deploy --plan`
です。

```text
GET    /api/spaces/:spaceId/groups
GET    /api/spaces/:spaceId/groups/:groupId/desired
PUT    /api/spaces/:spaceId/groups/:groupId/desired
POST   /api/spaces/:spaceId/groups/:groupId/plan
POST   /api/spaces/:spaceId/groups/:groupId/apply
GET    /api/spaces/:spaceId/groups/:groupId/deployments
```

## アンインストール

稼働中 group の uninstall は `takos uninstall GROUP_NAME --space SPACE_ID`
または `POST /api/spaces/:spaceId/groups/uninstall` を使います。uninstall は
group を削除する terminal 操作で、rollback で group
を再生成することはできません。

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Deploy Group](/deploy/deploy-group) --- group 機能と inventory
- [ロールバック](/deploy/rollback)
