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

### `Error: target "compute.xxx" not found in manifest`

`--target` で指定した workload 名が `.takos/app.yml` に存在するか確認してください。

```bash
# app.yml に compute.web がある場合
takos deploy --env staging --target compute.web    # OK
takos deploy --env staging --target compute.api    # NG（存在しない）
```

## ストレージ作成失敗

### `Error: Failed to create sql storage`

- Takos 側の deploy 権限を持つアカウントで `takos login` しているか確認してください
- 利用 plan の sql storage クォータに空きがあるか確認してください
- backend 固有のクォータ / 名前制約は [Hosting / Cloudflare](/hosting/cloudflare) などの provider docs を参照してください

### `Error: Failed to create object-store storage`

- Takos 側の deploy 権限を持つアカウントで `takos login` しているか確認してください
- ストレージ名の正規化規則に従っているか確認してください

## デプロイ失敗

### `Error: Worker deploy failed`

1. まず plan を確認しましょう:

```bash
takos deploy --plan
```

2. 変更対象を絞って切り分けます:

```bash
takos deploy --env staging --target compute.web
```

3. よくある原因:
   - storage bind の参照先リソースが存在しない
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
takos deploy --plan
```

以下の項目が検証されます。

- `.takos/app.yml` にトップレベルの `name` があること
- `build.fromWorkflow.path` が `.takos/workflows/` 配下であること
- compute / storage / routes の参照が整合していること
- `--target` で指定した compute / storage / routes が manifest 内に存在すること

## それでも解決しない場合

1. `takos deploy --plan` で manifest の解釈結果と差分を確認
2. `takos deploy status --space SPACE_ID` で control plane 側の deployment 状態を確認
3. `takos group show GROUP_NAME` で group inventory を確認
4. provider 固有の問題は [Hosting / Cloudflare](/hosting/cloudflare) などの provider docs を参照

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [ロールバック](/deploy/rollback) --- ロールバックの手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド
