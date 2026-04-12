# トラブルシューティング

> このページでわかること: デプロイ時のよくあるエラーと対処法。

## バリデーションエラー

### `Error: app.yml must have a name field`

`.takos/app.yml` のトップレベルに `name` フィールドがあるか確認してください。

```yaml
# OK
name: my-app

# NG（name がない、または apiVersion/kind/metadata でラップしている）
```

### `Error: workflow path must be under .takos/workflows/`

`build.fromWorkflow.path` が `.takos/workflows/`
配下を指しているか確認してください。

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

### `--target` で何も反映されない

`--target` は dotted path ではなく deploy diff entry の `name` に完全一致します。
workload は compute 名、route は `${target}:${path}` 形式です。publication は
target filter の対象外で、manifest catalog として同期されます。

```bash
# app.yml に compute.web と routes: [{ target: web, path: "/" }] がある場合
takos deploy --env staging --space SPACE_ID --target web       # workload
takos deploy --env staging --space SPACE_ID --target 'web:/'   # route
```

## publication/provider 解決失敗

### `Error: publication references unknown Takos ... resource`

- `publish[].spec.resource` が存在するか確認してください
- `publish[].kind` と resource type が一致しているか確認してください
- publish/consume の shape は [Manifest Reference](/reference/manifest-spec)
  を参照してください

### `Error: publication ... provider/kind is unsupported`

- `provider` と `kind` の組み合わせが存在するか確認してください
- `GET /api/publications/providers` で利用可能な provider 一覧を確認してください

## デプロイ失敗

### `Error: Worker deploy failed`

1. まず plan を確認しましょう:

```bash
takos deploy --plan --space SPACE_ID
```

2. 変更対象を絞って切り分けます:

```bash
takos deploy --env staging --space SPACE_ID --target web
```

3. よくある原因:
   - `consume` が存在しない publication を参照している
   - `consume.env` が既存 env と衝突している
   - Worker のコードにシンタックスエラーがある
   - readiness probe (`GET /` または `compute.<name>.readiness`) が 200
     を返さない

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

- `.takos/app.yml` にトップレベルの `name` があること
- `build.fromWorkflow.path` が `.takos/workflows/` 配下であること
- compute / publish / routes の参照が整合していること
- `--target` で指定した workload / route の diff entry 名が plan と一致すること

## それでも解決しない場合

1. `takos deploy --plan --space SPACE_ID` で manifest の解釈結果と差分を確認
2. `takos deploy status --space SPACE_ID` で control plane 側の deployment
   状態を確認
3. `takos group show GROUP_NAME --space SPACE_ID` で group inventory を確認
4. provider 固有の問題は [Hosting / Cloudflare](/hosting/cloudflare) などの
   provider docs を参照

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [ロールバック](/deploy/rollback) --- ロールバックの手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド
