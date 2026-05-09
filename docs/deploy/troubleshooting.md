# トラブルシューティング

> このページでわかること: Deployment 時のよくあるエラーと対処法。

## バリデーションエラー

### `Invalid manifest: metadata.name is required`

deploy manifest (`.takosumi/manifest.yml`) の `metadata.name` があるか確認して
ください。current kernel-bound manifest は `apiVersion: "1.0"` +
`kind: Manifest` + `resources[]` の Shape manifest です。

```yaml
# OK
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
resources: []

# NG（metadata.name がない）
```

### `group is required when the deploy manifest does not provide metadata.name`

`takos deploy` / `takos install` は GroupHead を advance します。通常は manifest
の `metadata.name` が group 名として使われます。このエラーは manifest に
`metadata.name` がなく、かつ `--group` / API body の `group` override もない
場合に出ます。

```bash
takos deploy --space SPACE_ID --group my-app
takos install owner/repo --space SPACE_ID --group my-app
```

### `compute.<name>.build is no longer supported by the Takos app manifest parser`

これは legacy `.takos/app.yml` / old AppSpec parser のエラーです。current
`.takosumi/manifest.yml` では `compute.<name>` を使わず、`resources[]` に
`web-service@v1` または `worker@v1` resource を書きます。image-backed service は
digest-pinned image を `spec.image` に書きます。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: api
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/acme/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      port: 8080
```

worker bundle は `worker@v1` の `spec.artifact.hash` に concrete digest を入れ
ます。authoring manifest では `workflowRef` を併記できますが、`takosumi-git` が
workflow を実行して `spec.artifact.hash` を埋め、`workflowRef` を strip してから
kernel に渡します。

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

## binding / service import 解決失敗

### `Error: ... provider publication request ...`

このエラーは旧 publication / consume model の互換 surface で出ることがあります。
current `.takosumi/manifest.yml` では app binding は `.takosumi/app.yml` の
`bindings:`、cross-instance service dependency は `.takosumi/manifest.yml` の
`imports[]` / `serviceResolvers[]` で表現します。

- `publication: takos.api-key` は retired です。Takos API access は Takosumi
  Accounts の AppGrant/AppBinding credential として installer 側で materialize
  してください
- OIDC consumer 統合 (`identity.oidc@v1` AppBinding 経由、Takosumi Accounts
  発行) の設定不足の場合は、`.takosumi/app.yml` の `bindings.auth.redirectPaths`
  / `allowedScopes` を確認してください。 `redirectUris` 等の解決済み値は
  [Binding Catalog](/reference/binding-catalog#_1-identity-oidc-v1) の output
  placeholders に従って compile されます。 install 直後の owner session
  bootstrap は `/_takosumi/launch?token=...` (one-time launch token JWS、
  `install-launch-token@v1` binding) であり、通常ログインの `/auth/oidc/login` →
  `/auth/oidc/callback` (OIDC consumer flow) とは 別経路です。token verify
  エラーは launch token の鍵 (`INSTALL_LAUNCH_PUBLIC_KEY`) と audience
  (`INSTALL_LAUNCH_AUDIENCE`) を、ログイン redirect エラーは `OIDC_REDIRECT_URI`
  と AppBinding の `redirectPaths` を確認してください
- `imports[]` がある場合は `serviceResolvers[]` の anchor URL と public key
  が設定されているか確認してください
- binding / import の shape は [Binding Catalog](/reference/binding-catalog) と
  [Manifest Reference](/reference/manifest-spec) を参照してください

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

- `imports[]` が未知の service identifier を参照している、または anchor が
  ServiceDescriptor を返せない
- `spec.env` / injected env が既存 env と衝突している
- Worker のコードにシンタックスエラーがある
- readiness probe (`GET /`、または provider 固有の health check) が 200 を返さ
  ない
- `Deployment.conditions[]` に `provider.materialize` の operation 失敗が記録
  されている (CLI / API の Deployment 詳細から見える)。各 condition の reason /
  fix hint は
  [Condition Reason Catalog](/takosumi/tests/condition-reason-catalog) を参照

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

- deploy manifest (`.takosumi/manifest.yml`) に `metadata.name` があること
- `web-service@v1` の `spec.image` が digest-pinned (`@sha256:...`) であること
- `worker@v1` の `spec.artifact.hash` が compile 後に concrete digest になって
  いること
- resources / routes / imports / serviceResolvers の参照が整合していること
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
