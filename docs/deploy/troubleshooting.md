# トラブルシューティング

> このページでわかること: Deployment 時のよくあるエラーと対処法。

## バリデーションエラー

### `Invalid manifest: name is required`

deploy manifest (`.takos/app.yml`) のトップレベルに `name` フィールドがあるか
確認してください。

```yaml
# OK
name: my-app

# NG（name がない、または apiVersion/kind/metadata でラップしている）
```

### `group is required when the deploy manifest does not provide name`

`takos deploy` / `takos install` は GroupHead を advance します。通常は manifest
の `name` が group 名として使われます。このエラーは manifest に `name` がなく、
かつ `--group` / API body の `group` override もない場合に出ます。

```bash
takos deploy --space SPACE_ID --group my-app
takos install owner/repo --space SPACE_ID --group my-app
```

### `compute.<name>.build is no longer supported by the Takos app manifest parser`

Takos app manifest は workflow / build pipeline を持ちません。service は
digest-pinned image を `compute.<name>.image` に書きます。

```yaml
compute:
  api:
    image: ghcr.io/acme/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    port: 8080
```

worker は manifest 側では `kind: worker` とし、bundle artifact は `takosumi-git`
が生成して Takos の `source.kind="manifest"` deploy に添えます。

```bash
takosumi-git init
takosumi-git push
```

### `Worker compute (...) requires worker bundle artifacts`

`source.kind="git_ref"` の Takos repo deploy は legacy workflow build metadata
を解決しません。worker を含む app は `takosumi-git` 経由で build / artifact
解決を済ませるか、API caller が `source.kind="manifest"` の `artifacts` に
`worker_bundle` file を添えてください。image-backed service だけの manifest
であれば git_ref deploy でもそのまま resolve できます。

### `Manifest artifact ... contains multiple JavaScript bundle candidates`

`source.kind="manifest"` の worker bundle artifact input は、単一 bundle file
か、`.js` / `.mjs` / `.cjs` が 1 つだけに定まる files entry にしてください。
複数 file に分かれる build output
は、`esbuild --bundle --outfile=dist/worker.js` のように単一 bundle
にまとめます。

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

1. まず in-memory preview で manifest だけ検証します。

```bash
takos deploy --preview --space SPACE_ID
```

2. reviewer flow で resolved Deployment を確認したい場合は `--resolve-only`
   を使い、`takos diff <id>` で expansion / GroupHead diff を見ます。

```bash
takos deploy --resolve-only --space SPACE_ID
takos diff dep_abc123 --space SPACE_ID
```

3. よくある原因:

- `consume` が存在しない publication または未知の built-in provider publication
  を参照している
- `consume.inject.env` が既存 env と衝突している
- Worker のコードにシンタックスエラーがある
- readiness probe (`GET /` または `compute.<name>.readiness`) が 200 を返さない
- `Deployment.conditions[]` に `provider.materialize` の operation 失敗が記録
  されている (CLI / API の Deployment 詳細から見える)

### `Error: Authentication failed`

```bash
takos whoami
takos login
takos endpoint show
```

## Approval 待ちの Deployment

PolicySpec が `require-approval` decision を出した resolved Deployment は
`takos apply` で「approval required」エラーになります。次のいずれかで approval
を添付してから apply します。

```bash
takos approve dep_abc123 --space SPACE_ID
takos apply dep_abc123 --space SPACE_ID
```

`Deployment.policy_decisions[]` で policy decision id を確認できます。

## デプロイ前の検証

deploy 前に manifest だけ検証したい場合:

```bash
takos deploy --preview --space SPACE_ID
```

以下の項目が検証されます。

- deploy manifest (`.takos/app.yml`) にトップレベルの `name` があること
- service compute の `image` が digest-pinned (`@sha256:...`) であること
- worker compute に対応する worker bundle artifact input があること
- compute / routes / publication の参照が整合していること
- descriptor 解決と Deployment.desired の構造的整合 (resolve gate)

reviewer に渡したい場合は `--resolve-only` で resolved Deployment を作って
`takos diff <id>` を共有してください。

## それでも解決しない場合

1. `takos deploy --preview --space SPACE_ID` で manifest の解釈結果を確認
2. `takos deploy --resolve-only --space SPACE_ID` で resolved Deployment
   を作り、 `takos diff <id>` で expansion + GroupHead 差分を確認
3. `takos deploy status --space SPACE_ID` で Deployment service 側の状態を確認
4. `takos group show GROUP_NAME --space SPACE_ID` で group inventory と
   GroupHead を確認
5. backend 固有の問題は operator-only の [Hosting docs](/hosting/) を参照

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [ロールバック](/deploy/rollback) --- rollback の手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド
