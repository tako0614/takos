# takos-git

> Internal service of [Takos](../README.md). 公開 product overview と Quickstart
> は親 README を参照してください。

Takos 所有の内部 Git ホスティングサービスです。

`takos-git` は汎用フォージではありません。公開プロフィール、カタログ、課金、
OAuth セマンティクスは持たず、Takos の Git 基盤として bare リポジトリ
ストレージ、refs、オブジェクト、Smart HTTP、source スナップショット、Takos PR
メタデータを担当します。ブラウザ / API client は `takos-worker` 経由でアクセスし、
`takos-worker` がユーザーを認証した上で、Git 固有の capability を伴う署名付き 内部
RPC 要求を転送します。デプロイライフサイクルは `takosumi` の source
スナップショット API 経由でアクセスします。

`TAKOS_GIT_REPOSITORY_ROOT` が bare リポジトリのディレクトリを指している場合、
サービスは Git CLI 経由で実 refs / オブジェクトを読み、`git http-backend` 経由で
Smart HTTP を配信します。リポジトリ ID は
`${TAKOS_GIT_REPOSITORY_ROOT}/<repositoryId>.git` にマップされ、`.git` で終わる
ID はそのまま root 下で使われます。

Git objects are stored directly on the filesystem under
`TAKOS_GIT_REPOSITORY_ROOT/<repositoryId>.git`. The service does not use an
object-store component binding; all object operations use Git CLI plumbing
commands against the bare repository on disk.

本番の `takos-git` は永続ストレージが必須です。 `TAKOS_GIT_REPOSITORY_ROOT`
が設定されている場合、`POST /internal/repositories` は bare
リポジトリをディスク上に初期化し、SQLite にメタデータを保存します。 デフォルトの
DB パスは `${TAKOS_GIT_REPOSITORY_ROOT}/.takos/containers/git.sqlite` です。
`TAKOS_GIT_DATABASE_URL` で `sqlite:///absolute/path.sqlite` を指定して
上書きできます。`${TAKOS_GIT_REPOSITORY_ROOT}/.takos/repositories.json`
が存在する場合、SQLite ストアが空のとき 1 度だけ移行ソースとして読み込みます。
スキーマ migration は `schema_migrations` に記録されます。プロセスローカル
メタデータは `TAKOS_GIT_DEV_IN_MEMORY_METADATA=true` の dev/test のみ存在し、
本番でストレージ未設定の場合は安定した not-configured エラーを返します。

Takos 固有の Git 認可は 2 層で行います。すべての内部ルートは Takos の内部 RPC
署名と、そのルートが必要とする Git capability を持つ必要があり、リポジトリ
スコープのルートでは加えて、署名された actor アカウント / space がリポジトリの
`ownerSpaceId` と一致する必要があります。書き込み操作は
`owner`、`admin`、`maintainer`、`write` などの書き込み可能ロールを要します。

ブラウザ / API client は内部ルートを直接呼び出さず、`takos-worker`
がユーザーを検証して署名付き内部要求を転送します。デプロイの正本セマンティクスは
`takosumi` が所有し、`takos-git` はデプロイ層が消費する source / snapshot
プリミティブだけを公開します。

## レイアウト

```text
apps/git                 内部 Git サービスのエントリポイント
packages/git-contract    内部 / 公開 Git DTO, パス, capability
```

## 環境変数

- `TAKOS_INTERNAL_SERVICE_SECRET`: 署名付き内部エンドポイントに必須
- `TAKOS_GIT_INTERNAL_CALLERS`: デフォルト `takos-worker,takosumi,takos-agent`
- `TAKOS_GIT_INTERNAL_URL`: 呼び出し元がこのシェルにルーティングする際に使用
- `TAKOS_GIT_REPOSITORY_ROOT`: bare リポジトリの refs / オブジェクト読み取りと
  Smart HTTP ホスティングを有効化。Smart HTTP 要求も Takos の内部署名要求
  ヘッダーが必要なので、通常の Git クライアントから直接呼ぶことはできない
- `TAKOS_GIT_DATABASE_URL`: SQLite メタデータ DB を
  `sqlite:///absolute/path.sqlite` で指定 (任意)。未設定時はリポジトリ root 配下
- `TAKOS_GIT_DEV_IN_MEMORY_METADATA=true`: dev/test 専用のプロセスローカル
  メタデータ。本番では使わない
- 本番 `Dockerfile` は `git` CLI をインストールし、Bun でサービスを起動します。
  Smart HTTP と Git オブジェクト読み取りが Git にシェルアウトする間、この依存は外さないこと

## 本番ストレージ立ち上げ

1. ランタイムイメージに `git` CLI をインストール。Smart HTTP は
   `git http-backend` を、リポジトリ読み取りは
   `git for-each-ref`、`git
   cat-file`、`git ls-tree` などのプランビング
   コマンドを呼びます。
2. bare リポジトリ用に永続ファイルシステムを用意 (例:
   `/var/lib/takos-git/repositories`)。`takos-git` のプロセスユーザーが所有
3. `TAKOS_GIT_REPOSITORY_ROOT=/var/lib/takos-git/repositories` を設定。 本番では
   `TAKOS_GIT_DEV_IN_MEMORY_METADATA` は未設定のまま
4. `TAKOS_GIT_DATABASE_URL` を未設定にして
   `${TAKOS_GIT_REPOSITORY_ROOT}/.takos/containers/git.sqlite` を使うか、
   `sqlite:///var/lib/takos-git/metadata/git.sqlite` のような絶対パスを指定
5. `takos-git` を起動し、署名付き内部 API (`POST /internal/repositories`) から
   `takos-worker` 経由でリポジトリを作成。サービスがマップ先の bare repo
   を初期化し、SQLite にメタデータを記録
6. 最初のリポジトリを
   `git --git-dir "$TAKOS_GIT_REPOSITORY_ROOT/<id>.git" fsck
   --no-dangling`
   と署名付き `GET /internal/repositories/<id>/refs` で検証

API 呼び出し元無しでローカルストレージを試す場合:

```sh
bun run seed:dev local/demo
export TAKOS_GIT_REPOSITORY_ROOT="$PWD/.takos-git/repositories"
unset TAKOS_GIT_DATABASE_URL
bun run dev
```

seed タスクは bare リポジトリを作成して `.takos/repositories.json` を書きます。
SQLite が空の状態で起動すると `takos-git` がこのメタデータを取り込み、
リポジトリを active として配信します。

## 内部 API

- `GET /internal/repositories`: リポジトリサマリーを一覧 (SQLite から。
  ストレージ未設定時はプロセスメモリから)
- `POST /internal/repositories`: リポジトリメタデータを作成し、マップ先の bare
  リポジトリを初期化。デフォルトは空の initial commit、
  `refs/heads/<defaultBranch>`、`HEAD` を作成。`initialization.mode: "bare"`
  で空 bare リポジトリ
- `GET /internal/repositories/:repositoryId`: リポジトリメタデータと refs を取得
- `PATCH /internal/repositories/:repositoryId`: メタデータを更新。`refs`
  が指定されていれば `git update-ref` で Git refs も置き換え
- `DELETE /internal/repositories/:repositoryId`: メタデータレコードを削除。 bare
  リポジトリのディレクトリは削除しないが、refs / オブジェクト / Smart HTTP
  アクセスはアクティブなメタデータでゲートされる
- `POST /internal/source/resolve`: リポジトリ root が未設定なら commit ID
  をそのまま解決。設定済みでリポジトリが存在する場合は Git で commit
  として検証してから返す。`main` / `refs/heads/main` / tag / その他 refs
  も配信される bare リポジトリから優先的に解決し、ストレージ未設定時のみ
  in-memory メタデータからもフォールバック。リクエスト body は `repositoryId` と
  `sourceRef` のみで、actor context は署名済み内部ヘッダーで運ばれる
- `GET /internal/repositories/:repositoryId/refs`: bare リポジトリから refs
  を一覧 (ストレージ未設定でメタデータがあれば in-memory から)
- `GET /internal/repositories/:repositoryId/branches`: ローカルブランチ refs を
  commit ID とタイムスタンプ付きで一覧
- `GET /internal/repositories/:repositoryId/tags`: tag refs を一覧
- `GET /internal/repositories/:repositoryId/tree?ref=<ref>&path=<path>`: bare
  リポジトリから tree を一覧
- `GET /internal/repositories/:repositoryId/blob?ref=<ref>&path=<path>`: blob
  の内容を UTF-8 / base64 で返す
- `GET /internal/repositories/:repositoryId/commits?ref=<ref>&limit=<n>&offset=<n>&path=<path>`:
  bare リポジトリから commit サマリーを一覧。`offset` は `git log --skip=<n>`
  に変換され、不正値は 0 にクランプ
- `GET /internal/repositories/:repositoryId/commits/:commitish`: 1 つの commit
  サマリーを取得
- `GET /internal/repositories/:repositoryId/compare?base=<ref>&head=<ref>`:
  ahead / behind 数と変更ファイルメタデータを返す
- `GET /internal/objects/:repositoryId/:objectId`: Git オブジェクトを bare
  リポジトリから読み、`git cat-file -p` の整形出力を返す。
  `x-takos-git-object-*` ヘッダーと
  `x-takos-git-object-format:
  git-cat-file-pretty` 付き
- `GET /internal/objects/:repositoryId/:objectId/raw`: Git オブジェクトを bare
  リポジトリから読み、`git cat-file <type>` のコンテンツを返す
  (`x-takos-git-object-format: git-cat-file-raw`)
- `GET /internal/repositories/:repositoryId/pull-requests`: SQLite ベースの PR
  レコードを一覧 (`?status=open|closed|merged` でフィルタ可)
- `POST /internal/repositories/:repositoryId/pull-requests`: head / base
  ブランチペアの PR メタデータを作成
- `GET` / `PATCH /internal/repositories/:repositoryId/pull-requests/:number`: PR
  メタデータの読み取り / 更新 (closed / merged ステータス含む)
- `GET /internal/repositories/:repositoryId/pull-requests/:number/diff`:
  ハンク単位の PR diff と統計を返す
- `POST /internal/repositories/:repositoryId/pull-requests/:number/comments` /
  `/reviews`: PR ディスカッション / レビューメタデータを追加
- `POST /internal/source/snapshot`: ref を不変な Git source snapshot に解決し、
  commit SHA、tree ファイルリスト、マニフェスト内容 (任意)、ダイジェスト、
  キャプチャ時刻を返す。これが PaaS 向けの source snapshot プリミティブ
- Smart HTTP 形式のパス (`/owner/repo.git/info/refs`、
  `/owner/repo.git/git-upload-pack`、`/owner/repo.git/git-receive-pack`)
  は、`TAKOS_GIT_REPOSITORY_ROOT` が設定済みで、リクエストが有効な v3 Takos 内部
  RPC envelope を持つ場合に `git http-backend` が配信。アクティブな
  リポジトリメタデータでもゲートされ、Git プロトコル v2 ヘッダーを
  `git http-backend` に転送。署名なしの clone / fetch / push は `401`。 公開 Git
  クライアントの入口は `takos-worker` で、ユーザー認証後に `git.repo.read` /
  `git.repo.write` で転送

## ローカルコマンド

```sh
bun run check
bun run test
bun run dev
bun run seed:dev
bun run smoke:live
```

`bun run smoke:live` はデプロイ済み / 稼働中サービス向けのオプトインです。
`TAKOS_GIT_INTERNAL_URL` が未設定だとスキップし、設定されていれば `GET /health`
を確認します。`TAKOS_INTERNAL_SERVICE_SECRET` があれば 署名付き
`GET /internal/repositories` も実行します。
