# Repository / Catalog デプロイ

> このページでわかること: `takos deploy` / `takos install` の current surface と、
> ローカル deploy / repo deploy / catalog install の役割分担。
> Store は発見のみ。lifecycle は Group + Git が担当。

Takos の deploy 入口はシンプルです。

- `takos deploy`: 唯一の deploy entrypoint。ローカル manifest（primary）または
  repository URL（alternative）から deploy する
- `takos install owner/repo@TAG`: `takos deploy https://github.com/owner/repo.git --ref TAG`
  の sugar。catalog (Store) が owner/repo + version を repo URL に解決し、
  内部的には `takos deploy` と同じ pipeline を通る

両者はどちらも同じ `takos deploy` pipeline を通り、同じ immutable snapshot を作ります。
`takos install` は catalog で発見したパッケージを楽に呼び出すための薄いラッパーです。

## Store の役割

Store は ActivityPub ベースのリポジトリ発見 SNS。

- リポジトリを検索・発見する
- フォロー先のリポジトリがフィードに流れてくる
- リポジトリに `.takos/app.yml` がある = installable マーク

Store は発見のみ。install / update / rollback の実行は Group + Git の deploy lifecycle が担当する。

## 基本的な使い方

```bash
# local manifest から deploy（primary）
takos deploy                          # from local .takos/app.yml
takos deploy --env staging            # with environment
takos deploy --plan                   # dry-run preview
```

```bash
# repository URL から deploy（alternative）
takos deploy https://github.com/acme/my-app.git --space SPACE_ID --ref main
```

```bash
# catalog で発見した repo を install
takos install owner/repo --space SPACE_ID
takos install owner/repo --version v1.0.0    # explicit flag
takos install owner/repo@v1.0.0              # shorthand
```

`--version v1.0.0` と `owner/repo@v1.0.0` は等価です。どちらを使っても同じ挙動に
なります。

## local deploy と repo deploy / install の違い

ローカル manifest 由来でも repo URL / catalog 由来でも、`takos deploy` の
lifecycle は同じです。どちらも kernel に manifest を渡して immutable snapshot を
作り、`takos rollback GROUP_NAME` で巻き戻せます。違いは「manifest がどこから
来るか」という provenance だけです。

repo URL / `takos install` を使う場合、**CLI は repository URL を control plane
に渡す。control plane が repo を fetch し、manifest を parse し、deploy pipeline
を実行する。CLI 側で repo を clone することはない。** CLI は thin client として
振る舞います。

| 観点 | local manifest deploy | repo URL deploy / `takos install` |
| --- | --- | --- |
| source | local working tree | `repository_url + ref/ref_type` |
| source 解決 | CLI が manifest / artifact を読む | control plane が repo を fetch して manifest を parse する（CLI は URL を渡すだけ） |
| snapshot 作成 | immutable snapshot を作る | immutable snapshot を作る |
| rollback | `takos rollback GROUP_NAME` で前回 snapshot を再適用 | `takos rollback GROUP_NAME` で前回 snapshot を再適用 |
| source 表記 | `local` | `repo:owner/repo@ref` |
| 主な用途 | 開発中の manifest 反映 | release / catalog install / repo-based deploy |

ローカル deploy も repo deploy も同じ pipeline を通り、同じ snapshot を作ります。
`source` field は manifest の出どころを示す metadata であり、lifecycle の差では
ありません。

## `takos deploy`

`takos deploy` はローカル manifest からの deploy（primary）と repository URL からの
deploy（alternative）の両方を扱います。`takos apply` は廃止されました。

```bash
# local manifest から deploy
takos deploy --env staging --group my-app

# repository URL から deploy
takos deploy https://github.com/acme/my-app.git \
  --space SPACE_ID \
  --ref main \
  --group my-app \
  --env staging

# dry-run preview
takos deploy --plan
```

positional argument を省略するとローカルの `.takos/app.yml` を source にします。
repo URL を指定した場合、ref を省略すると repository 側の既定 branch 解決に従います。

## `takos install`

`takos install OWNER/REPO@TAG` は `takos deploy` の sugar です。catalog (Store)
が owner/repo + version を repository URL に解決し、内部的には
`takos deploy https://github.com/owner/repo.git --ref TAG` と同じ call path を通ります。
CLI 自身は repo を clone せず、control plane が repo source を解決します。

```bash
# 以下は等価
takos install owner/repo@v1.2.0 --space SPACE_ID
takos deploy https://github.com/owner/repo.git --ref v1.2.0 --space SPACE_ID
```

target space に Store app が install されている必要はありません。
Store は発見に使えるが、install の実行には不要。

## `takos rollback`

deploy は snapshot を持つ。rollback は snapshot を再適用する。

```bash
takos rollback my-app               # 直前の snapshot に戻す
```

- 引数は group 名
- code + config + bindings が戻る
- DB data は戻らない（forward-only migration）
- group がすでに削除されている場合は失敗し、deleted group を再生成しない

## 更新と pin（future / not in current surface）

`takos update` / `takos pin` / `takos unpin` / `takos config` は current CLI surface
には含まれません（design only）。新しい release を反映したい場合は
`takos deploy URL --ref <new-ref>` または `takos install owner/repo@<new-version>`
を再実行してください。

## デプロイ前の検証

manifest 由来の差分確認には `takos deploy --plan` を使います。

```bash
takos deploy --plan
```

`takos deploy --plan` は non-mutating preview です。group が未作成でも DB row
は作りません。standalone の `takos plan` コマンドはありません。

## デプロイ状態の確認

```bash
takos deploy status --space SPACE_ID
takos deploy status APP_DEPLOYMENT_ID --space SPACE_ID
takos group show my-app
```

## Source tracking

group は source 情報を持つ:
- `local`: ローカル manifest を `takos deploy` で手元から deploy
- `repo:owner/repo@v1.2.0`: `takos install` または `takos deploy URL` で repo から deploy

どちらの source の group も、新しい code を反映するには `takos deploy` を再実行する。
（`takos update` / `takos pin` は current CLI surface には含まれない。design only。）

## イメージ参照の制約

`compute.<name>` の image-backed workload を online deploy するときは
`image` に digest pin (`@sha256:...`) が必要です。mutable tag (`:latest` など)
は受け付けません。

## public repo の取得

public HTTPS repo の deploy は、通常は git smart protocol で source
を解決します。まず bounded/configurable な full pack を試し、pack size / object
count / inflated size のような content-size・pack-limit 系の失敗だけを blobless
partial fetch の対象にします。任意の fetch error で次段へ fall through
するわけではありません。remote が `filter` と `allow-reachable-sha1-in-want` を
advertise している場合だけ blobless partial fetch に進みます。GitHub / GitLab の
public repo では、それでも解決できないときだけ archive download を host-specific
な最後の fallback として使います。

## API

repo / catalog source の deployment history には app deployment API を使います。

```text
POST   /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback
DELETE /api/spaces/:spaceId/app-deployments/:appDeploymentId
```

manifest-driven deploy / desired state 管理には group API を使います。

```text
GET    /api/spaces/:spaceId/groups
GET    /api/spaces/:spaceId/groups/:groupId/desired
PUT    /api/spaces/:spaceId/groups/:groupId/desired
POST   /api/spaces/:spaceId/groups/:groupId/plan
POST   /api/spaces/:spaceId/groups/:groupId/apply
GET    /api/spaces/:spaceId/groups/:groupId/deployments
```

## アンインストール

稼働中 app の uninstall は `takos uninstall GROUP_NAME` または
`POST /api/spaces/:spaceId/groups/uninstall` を使います。uninstall は group を削除
する terminal 操作で、rollback で group を再生成することはできません。

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Deploy Group](/deploy/deploy-group) --- group の管理と desired state
- [ロールバック](/deploy/rollback) --- rollback の手順
