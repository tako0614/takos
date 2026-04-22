# トラブルシューティング

> このページでわかること: デプロイ時のよくあるエラーと対処法。

## バリデーションエラー

### `Invalid manifest: name is required`

deploy manifest (`.takos/app.yml`) のトップレベルに `name` フィールドがあるか
確認してください。

```yaml
# OK
name: my-app

# NG（name がない、または apiVersion/kind/metadata でラップしている）
```

### `group_name is required when the deploy manifest does not provide name`

`takos deploy` / `takos install` は group snapshot 機能を使います。通常は
manifest の `name` が group 名として使われます。このエラーは manifest に
`name` がなく、かつ `--group` / API の `group_name` override もない場合に出ます。

```bash
takos deploy --space SPACE_ID --group my-app
takos install owner/repo --space SPACE_ID --group my-app
```

### `Invalid manifest: compute.<name>.build.fromWorkflow.path must be under .takos/workflows/`

`build.fromWorkflow.path` が `.takos/workflows/`
配下を指しているか確認してください。

```yaml
# OK
build:
  fromWorkflow:
    path: .takos/workflows/deploy.yml
    job: bundle
    artifact: web
    artifactPath: dist/worker

# NG
build:
  fromWorkflow:
    path: workflows/deploy.yml
    job: bundle
    artifact: web
    artifactPath: dist/worker
```

### `Build output ... contains multiple JavaScript bundle candidates`

`compute.<name>.build.fromWorkflow.artifactPath` は repository relative path
で、絶対パスや `..` は使えません。値は単一 bundle file か、`.js` / `.mjs` /
`.cjs` が 1 つだけに定まる directory artifact を指します。directory 内に複数の
JavaScript file がある場合、現行の tenant runtime deployment path では module
graph として扱わず失敗します。

```yaml
# OK: exact bundle file
build:
  fromWorkflow:
    path: .takos/workflows/deploy.yml
    job: bundle
    artifact: web
    artifactPath: dist/worker.js

# OK: directory 内に worker.js だけがある場合
build:
  fromWorkflow:
    path: .takos/workflows/deploy.yml
    job: bundle
    artifact: web
    artifactPath: dist/worker
```

複数 file に分かれる build output
は、`esbuild --bundle --outfile=dist/worker.js` のように単一 bundle
にまとめ、`artifactPath` をその file に向けてください。

### `--target` は plan でだけ使う

`--target` は `takos deploy --plan` / `takos install --plan` の diff entry
filter です。workload は compute 名、route は `${target}:${path}` 形式です。
`web`, `web:/` のような canonical entry 名に加えて、`workers.web`,
`routes.web:/` のような dotted category key も受け付けます。publication は
target filter の対象外で、manifest catalog として同期されます。

```bash
# deploy manifest に compute.web と routes: [{ target: web, path: "/" }] がある場合
takos deploy --plan --env staging --space SPACE_ID --target web       # workload
takos deploy --plan --env staging --space SPACE_ID --target 'web:/'   # route
takos deploy --plan --env staging --space SPACE_ID --target workers.web
takos deploy --plan --env staging --space SPACE_ID --target routes.web:/
```

## publication / capability 解決失敗

### `Error: ... provider publication request ...`

このエラーは `takos.api-key` / `takos.oauth-client` の `request` が足りない、
または未知 field を含む場合に出ます。SQL / object-store / queue などの resource
type は publish / consume に入れません。

- `publication: takos.api-key` なら `request.scopes` があるか確認してください
- `publication: takos.oauth-client` なら `request.redirectUris` と
  `request.scopes` があるか確認してください
- route publication の場合、`publisher` が route の `target`
  と一致しているか確認してください
- publish / consume の shape は [Manifest Reference](/reference/manifest-spec)
  を参照してください

## デプロイ失敗

### `Error: Worker deploy failed`

1. まず plan を確認しましょう:

```bash
takos deploy --plan --space SPACE_ID
```

2. 変更対象を絞って切り分けます:

```bash
takos deploy --plan --env staging --space SPACE_ID --target web
```

3. よくある原因:

- `consume` が存在しない publication または未知の built-in provider publication を参照している
- `consume.env` が既存 env と衝突している
- Worker のコードにシンタックスエラーがある
- readiness probe (`GET /` または `compute.<name>.readiness`) が 200 を返さない

### `Error: Authentication failed`

```bash
takos whoami
takos login
takos endpoint show
```

## デプロイ前の検証

デプロイ前に manifest だけ検証したい場合:

```bash
takos deploy --plan --space SPACE_ID
```

以下の項目が検証されます。

- deploy manifest (`.takos/app.yml`) にトップレベルの `name` があること
- `build.fromWorkflow.path` が `.takos/workflows/` 配下であること
- worker bundle が単一 file、または一意に解決できる directory artifact
  であること
- compute / routes / publication の参照が整合していること
- `--target` を使う場合は `--plan` が必要で、指定した workload / route の diff
  entry 名が plan と一致すること

## それでも解決しない場合

1. `takos deploy --plan --space SPACE_ID` で manifest
   の解釈結果と差分を確認
2. `takos deploy status --space SPACE_ID` で control plane 側の deployment
   状態を確認
3. `takos group show GROUP_NAME --space SPACE_ID` で group inventory を確認
4. backend 固有の問題は operator-only の [Hosting docs](/hosting/) を参照

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [ロールバック](/deploy/rollback) --- ロールバックの手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド
