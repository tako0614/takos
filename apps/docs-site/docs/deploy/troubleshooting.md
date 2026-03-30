# トラブルシューティング

> このページでわかること: デプロイ時のよくあるエラーと対処法。

## バリデーションエラー

### `Error: app.yml must have kind: App`

`.takos/app.yml` の `kind` フィールドが `App` になっているか確認してください。

```yaml
# OK
kind: App

# NG
kind: app
kind: Application
```

### `Error: workflow path must be under .takos/workflows/`

`build.fromWorkflow.path` が `.takos/workflows/` 配下を指しているか確認してください。

```yaml
# OK
build:
  fromWorkflow:
    path: .takos/workflows/deploy.yml

# NG
build:
  fromWorkflow:
    path: workflows/deploy.yml
```

### `Error: target "workers.xxx" not found in manifest`

`--target` で指定した workload 名が `.takos/app.yml` に存在するか確認してください。

```bash
# app.yml に workers.web がある場合
takos apply --env staging --target workers.web    # OK
takos apply --env staging --target workers.api    # NG（存在しない）
```

## リソース作成失敗

### `Error: Failed to create D1 database`

- Cloudflare API トークンに D1 の権限があるか確認してください
- アカウントの D1 クォータに空きがあるか確認してください
- `--account-id` が正しいか確認してください

### `Error: Failed to create R2 bucket`

- Cloudflare API トークンに R2 の権限があるか確認してください
- R2 のバケット名制約（英小文字、ハイフン、63 文字以内）に従っているか確認してください

## デプロイ失敗

### `Error: wrangler deploy failed`

1. まず plan を確認しましょう:

```bash
takos plan
```

2. 変更対象を絞って切り分けます:

```bash
takos apply --env staging --target workers.web
```

3. よくある原因:
   - binding の参照先リソースが存在しない
   - Worker のコードにシンタックスエラーがある
   - compatibility date が古すぎる

### `Error: Authentication failed`

```bash
# 環境変数を確認
echo $CLOUDFLARE_ACCOUNT_ID
echo $CLOUDFLARE_API_TOKEN

# または明示的に指定
takos apply --env staging \
  --account-id YOUR_ACCOUNT_ID \
  --api-token YOUR_API_TOKEN
```

## テンプレート変数のエラー

<div v-pre>

### `Error: template variable "routes.xxx.url" references unknown route`

`env.inject` で参照しているルート名が `routes` セクションに存在するか確認してください。

```yaml
# routes に browser-api が定義されていない場合
env:
  inject:
    URL: "{{routes.browser-api.url}}"    # エラー
```

</div>

## デプロイ前の検証

デプロイ前に manifest だけ検証したい場合:

```bash
takos plan
```

以下の項目が検証されます。

- `.takos/app.yml` が `kind: App` であること
- `build.fromWorkflow.path` が `.takos/workflows/` 配下であること
- service / resource / route の参照が整合していること
- `--target` で指定した resource / workload / route が manifest 内に存在すること

## それでも解決しない場合

1. Cloudflare ダッシュボードで Worker やリソースの状態を確認
2. `takos plan` で manifest の解釈結果と差分を確認
3. 生成された wrangler.toml を手動で `wrangler deploy` してエラーを切り分け

## 次のステップ

- [apply](/deploy/apply) --- `takos apply` の詳細
- [ロールバック](/deploy/rollback) --- ロールバックの手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド
