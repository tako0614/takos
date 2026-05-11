# Repository / Catalog デプロイ

> このページでわかること: Installable App Model の canonical install path と、 migration window 中に残る `takos deploy`
> / `takos install` compatibility surface の役割分担。Store は発見と source 解決を担当し、takosumi-git が workflow /
> artifact / manifest compile を担う。

> 現行実装の split status は
> [Current Implementation Note](https://github.com/tako0614/takosumi/blob/master/docs/reference/architecture/index.md#deploy-shell)
> を参照

Takos の deploy 入口はシンプルです。

- **Installable App Model (canonical install path)**: `POST /v1/installations`
  ([Install API](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/install-api.md)) が Git URL +
  ref を受け取り、Takosumi Accounts が AppInstallation を作り、takosumi-git installer pipeline が `.takosumi/app.yml` /
  `.takosumi/manifest.yml` を parse / compile する **正本 install API**。Takos の bundled / third-party app の install
  はこの経路を通り、所有権は Takosumi Account 配下の AppInstallation 台帳に置かれます。Takos product 自体は Takosumi の
  unique top consumer で、 通常の InstallableApp ではありません。Phase 1.3a/1.3b の Installable App Model 経由 install
  では `.takosumi/app.yml` parser が **install preview** (`POST /v1/install/preview`) を返し、ユーザーの approve
  なしには pipeline が進みません
- `takos deploy`: ローカル manifest または repository URL から Deployment record を resolve + apply する legacy
  compatibility surface。 manifest の `name` で決まる group の GroupHead が advance される
- `takos install owner/repo --version TAG`: **catalog-based legacy sugar**。 `POST /v1/installations` が canonical
  になる **以前の install 入口** で、 catalog (Store) が owner/repo + version/tag を repository URL + Git tag に
  解決し、内部的には `takos deploy` と同じ Deployment endpoint (`POST /api/public/v1/deployments`)
  を通る薄いラッパー。canonical install と 別 surface ですが、現在も legacy 互換のために動作します。新規 install は
  Installable App Model の `POST /v1/installations` を選んでください

`takos deploy` / legacy `takos install` はどちらも同じ Takos compatibility API `POST /api/public/v1/deployments`
を通ります。これは takosumi kernel の public surface ではありません。kernel へ届く正本 payload は takosumi-git が
compile した Shape manifest を `POST /v1/deployments` に渡す経路です。

## Store の役割

Store は repository reference を共有する Store Network ベースの発見 surface。

- リポジトリを検索・発見する
- remote store の inventory / repo event を feed で取得する
- リポジトリに `.takosumi/app.yml` と `.takosumi/manifest.yml` がある = InstallableApp として preview 可能

Store は発見と source metadata の解決を担当します。canonical install lifecycle は Takosumi Accounts の AppInstallation
API と takosumi-git installer pipeline が担当します。legacy group Deployment lifecycle (resolve / apply / rollback) は
Takos compatibility API の責務です。

## 基本的な使い方

```bash
# local manifest から resolve + apply (compatibility)
takos deploy --space SPACE_ID
takos deploy --env staging --space SPACE_ID
takos deploy --preview --space SPACE_ID         # in-memory preview
takos deploy --resolve-only --space SPACE_ID    # resolved Deployment のみ
```

```bash
# repository URL から resolve + apply
takos deploy https://github.com/acme/my-app.git --space SPACE_ID --ref v1.2.0 --ref-type tag
```

```bash
# catalog で発見した repo を legacy deploy sugar で反映
takos install owner/repo --space SPACE_ID
takos install owner/repo --space SPACE_ID --version v1.0.0
```

`--version v1.0.0` を使って version を指定します。

## local deploy と repo deploy / install の違い

Takos compatibility implementation では、ローカル manifest 由来でも repo URL / catalog 由来でも、`takos deploy` の
Deployment lifecycle は同じです。違いは 「Deployment.input.manifest_snapshot がどこから来るか」という provenance だけ
です。

repo URL / `takos install` を使う場合、**CLI は repository URL を `POST /api/public/v1/deployments` の
`source.kind="git_ref"` として渡す。** repo fetch、manifest parse、resolve、apply は Deployment service の責務です。CLI
側で repo を clone することはありません。

| 観点              | local manifest flow                                                                       | repo URL deploy / legacy `takos install`                                                 |
| ----------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| source            | local working tree                                                                        | repo URL deploy: `repository_url + ref/ref_type`; install: catalog version/tag → Git tag |
| source 解決       | CLI / takosumi-git が compiled manifest / artifact を読み、Takos compatibility API に送る | Deployment service が repo fetch / manifest parse を担当する                             |
| desired apply     | Deployment.desired に Shape resources / routes / bindings report を pin                   | Deployment.desired に Shape resources / routes / bindings report を pin                  |
| Deployment record | Deployment.input に manifest / artifacts を記録                                           | Deployment.input に repository URL / ref / commit / manifest metadata を記録             |
| rollback          | GroupHead を retained Deployment に切り替えて再 apply                                     | GroupHead を retained Deployment に切り替えて再 apply (commit を再解決)                  |
| API source kind   | `manifest`                                                                                | `git_ref`                                                                                |
| 表示名            | `local`                                                                                   | `repo:owner/repo@ref`                                                                    |
| 主な用途          | 開発中の manifest 反映                                                                    | release / catalog install / repo-based deploy                                            |

API `source.kind` は `manifest` / `git_ref` で分かれますが、これは Deployment.input.manifest_snapshot の出どころを示す
metadata です。Takos compatibility implementation では Deployment.desired の構造の差ではありません。

Takos compatibility implementation の repo URL deploy / `takos install` は apply 時に app bundle
を固めて保存しません。更新や rollback に必要な repository URL / ref / 解決済み commit を Deployment.input
に残し、実行時に repository source から再解決します。

## `takos deploy`

`takos deploy` は migration window 中の compatibility surface として、ローカル manifest からの deploy と repository URL
からの deploy の両方を扱います。

```bash
# local manifest から resolve + apply
takos deploy --env staging --space SPACE_ID

# repository URL から resolve + apply
takos deploy https://github.com/acme/my-app.git \
  --space SPACE_ID \
  --ref v1.2.0 \
  --ref-type tag \
  --env staging

# in-memory preview
takos deploy --preview --space SPACE_ID

# resolved Deployment record のみ作成（apply は保留）
takos deploy --resolve-only --space SPACE_ID
```

positional argument を省略すると、Takos compatibility wrapper は takosumi-git-owned authoring convention
(`.takosumi/manifest.yml`) を source として扱います。kernel direct deploy path では explicit compiled Shape manifest を
渡してください。repo URL を指定した場合、ref を省略すると repository 側の既定 branch 解決に従います。Installable App
Model の canonical install path では mutable branch ref を拒否し、tag または commit SHA に pin します。

## `takos install`

`takos install OWNER/REPO --version TAG` は `takos deploy` の legacy sugar です。 Takosumi Accounts の AppInstallation
canonical path ではありません。catalog (Store) が owner/repo + version/tag を repository URL + Git tag に解決し、
`source.kind = "git_ref"` / `ref_type = "tag"` として同じ `POST /api/public/v1/deployments` を通ります。CLI 自身は repo
を clone せず、 Takos compatibility Deployment service が repo source を解決します。

```bash
# 以下は等価
takos install owner/repo --version v1.2.0 --space SPACE_ID
takos deploy https://github.com/owner/repo.git --ref v1.2.0 --ref-type tag --space SPACE_ID
```

target space に Store app-label / package が install されている必要はありません。Store は発見に使えますが、legacy deploy
sugar の実行には不要です。repo source 解決の実行主体は Takos compatibility Deployment service です。

## `takos rollback`

rollback は Takos compatibility implementation で group の GroupHead を previous Deployment に切り替える pointer move
です。

```bash
takos rollback my-app --space SPACE_ID
```

- 引数は group 名
- code + config + Shape resource declarations が target Deployment.desired の状態に戻る
- AppBinding / namespace export materialization の resolved value は rollback 後の serving 時に policy
  に従って再解決される
- DB data は戻らない（forward-only migration）
- group がすでに削除されている場合は失敗し、deleted group を再生成しない

詳細は [ロールバック](/deploy/rollback) を参照。

## デプロイ前の検証

manifest 由来の差分確認には `takos deploy --preview --space SPACE_ID` を使います。

```bash
takos deploy --preview --space SPACE_ID
```

`takos deploy --preview --space SPACE_ID` は in-memory preview です。Deployment record を持続化しないので、group
が未作成でも DB row は作りません。

reviewer flow が必要な場合は `--resolve-only` を使い、resolved Deployment を 作って `takos diff <id>` で expansion +
GroupHead 差分、`takos approve <id>` で approval 添付、`takos apply <id>` で適用します。

ローカル manifest 経路では、API caller が `source.kind = "manifest"` payload として manifest snapshot と必要な worker
bundle artifacts を渡します。workflow artifact 解決は Takos API / Takos CLI ではなく `takosumi-git init` /
`takosumi-git push` が担当します。旧 `source.kind = "inline"` + workflow artifact payload は API gateway
で拒否されます。

## デプロイ状態の確認

```bash
takos deploy status --space SPACE_ID
takos deploy status DEPLOYMENT_ID --space SPACE_ID
takos group show my-app --space SPACE_ID
```

## Source tracking

group は source 情報を持てます。

- `local`: ローカル manifest を `takos deploy` compatibility path で反映
- `repo:owner/repo@v1.2.0`: `takos install owner/repo --version v1.2.0 --space SPACE_ID` または
  `takos deploy URL --space SPACE_ID` で repo から deploy

どちらの source の group も、新しい code を反映するには `takos deploy --space SPACE_ID` を再実行します（新しい
Deployment が作られて GroupHead が advance されます）。別名 group へ反映したい場合は `--group NAME` を override
として指定します。

## イメージ参照の制約

`web-service@v1` などの image-backed workload を online deploy するときは `spec.image` に digest pin (`sha256` digest)
が必要です。mutable tag (`:latest` など) は受け付けません。

## public repo の取得

Takos compatibility implementation の public HTTPS repo deploy は、通常は git smart protocol で source
を解決します。まず bounded/configurable な full pack を試し、pack size / object count / inflated size のような
content-size・pack-limit 系の失敗だけを blobless partial fetch の対象にします。任意の fetch error で次段へ fall through
するわけではありません。remote が `filter` と `allow-reachable-sha1-in-want` を advertise している場合だけ blobless
partial fetch に進みます。GitHub / GitLab の public repo では、archive download も host-specific な取得経路の 1 つとして
使います。

## API

CLI / repo deploy / catalog install compatibility path は単一の Takos public Deployment endpoint family を使います。repo
source 由来の Deployment は bundled snapshot ではなく source metadata と resolved commit を Deployment.input に
保存します。

```text
POST   /api/public/v1/deployments
GET    /api/public/v1/deployments/:id
GET    /api/public/v1/deployments?group=&status=
GET    /api/public/v1/deployments/:id/observations
POST   /api/public/v1/deployments/:id/apply
POST   /api/public/v1/deployments/:id/approve
GET    /api/public/v1/groups/:group_id/head
POST   /api/public/v1/groups/:group_id/rollback
```

`POST /api/public/v1/deployments` の body は `{ manifest, mode, source, group?, env? }` で、`mode` は `"preview"` /
`"resolve"` / `"apply"` / `"rollback"` から選びます。 default の `takos deploy` は `mode="apply"` を渡し、resolve
に成功すると同じ 呼び出しの中で apply まで進めます。`mode="resolve"` だけ呼んだ場合は、続けて
`POST /api/public/v1/deployments/:id/apply` を呼ぶことで applied に進めます。

この endpoint family は Takos compatibility API です。takosumi kernel の public surface は compiled manifest を受け取る
`POST /v1/deployments` だけです。

advanced HTTP API として group head の直接読み取りや rollback もあります。 この compatibility surface での CLI path は
`takos deploy` / `takos rollback` です。

```text
GET    /api/public/v1/groups/:group_id/head
POST   /api/public/v1/groups/:group_id/rollback
GET    /api/public/v1/deployments/:id/observations
```

## アンインストール

稼働中 group の uninstall は `takos uninstall GROUP_NAME --space SPACE_ID` を使います。uninstall は group を削除する
terminal 操作で、rollback で group を再生成することはできません。

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Deploy Group](/deploy/deploy-group) --- group 機能と inventory
- [ロールバック](/deploy/rollback)
