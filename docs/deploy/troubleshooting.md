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

## リソース作成失敗

### `Error: Failed to create D1 database`

- Takos 側の deploy 権限を持つアカウントで `takos login` しているか確認してください
- アカウントの D1 クォータに空きがあるか確認してください

### `Error: Failed to create R2 bucket`

- Takos 側の deploy 権限を持つアカウントで `takos login` しているか確認してください
- R2 のバケット名制約（英小文字、ハイフン、63 文字以内）に従っているか確認してください

## デプロイ失敗

### `Error: wrangler deploy failed`

1. まず plan を確認しましょう:

```bash
takos deploy --plan
```

2. 変更対象を絞って切り分けます:

```bash
takos deploy --env staging --target compute.web
```

3. よくある原因:
   - binding の参照先リソースが存在しない
   - Worker のコードにシンタックスエラーがある
   - compatibility date が古すぎる

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

1. Cloudflare ダッシュボードで Worker やリソースの状態を確認
2. `takos deploy --plan` で manifest の解釈結果と差分を確認
3. `takos deploy status --space SPACE_ID` で control plane 側の deployment 状態を確認

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [ロールバック](/deploy/rollback) --- ロールバックの手順
- [CLI コマンド](/reference/cli) --- CLI の全コマンド
