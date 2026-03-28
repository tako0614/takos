# deploy-group

`.takos/app.yml` で定義したアプリを Cloudflare に直接デプロイします。ローカル開発・テスト向け。

## 基本的な使い方

```bash
takos deploy-group --env staging
```

これだけで、`.takos/app.yml` の定義に従って staging 環境にデプロイされます。

## オプション一覧

| オプション | 必須 | 説明 |
| --- | --- | --- |
| `--env <name>` | yes | デプロイ先環境（`staging`, `production`） |
| `--manifest <path>` | no | マニフェストパス（デフォルト: `.takos/app.yml`） |
| `--worker <name...>` | no | 特定の Worker のみデプロイ（複数指定可） |
| `--container <name...>` | no | 特定の Container のみデプロイ（複数指定可） |
| `--namespace <name>` | no | dispatch namespace にデプロイ |
| `--group <name>` | no | グループ名（デフォルト: `metadata.name`） |
| `--wrangler-config <path>` | no | wrangler.toml を直接デプロイ |
| `--base-domain <domain>` | no | テンプレート変数のベースドメイン |
| `--account-id <id>` | yes* | Cloudflare アカウント ID |
| `--api-token <token>` | yes* | Cloudflare API トークン |
| `--compatibility-date <date>` | no | Worker の compatibility date（デフォルト: `2025-01-01`） |
| `--dry-run` | no | デプロイせずに内容を表示 |
| `--json` | no | JSON 形式で出力 |

\* 環境変数 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` で指定する場合はフラグ不要です。

## よく使うパターン

### ステージング環境にデプロイ

```bash
takos deploy-group --env staging
```

### dry-run で確認だけ

```bash
takos deploy-group --env production --dry-run
```

### 特定の Worker / Container だけデプロイ

```bash
# 特定の Worker のみ
takos deploy-group --env staging --worker web --worker api

# 特定の Container のみ
takos deploy-group --env staging --container browser
```

フィルタ指定時は、対象 Worker が参照するリソースのみプロビジョニングされます。

### dispatch namespace にデプロイ

```bash
takos deploy-group --env staging --namespace takos-staging-tenants
```

### wrangler.toml を直接デプロイ

```bash
takos deploy-group --wrangler-config wrangler.toml --env staging
```

::: warning
`--wrangler-config` は `--manifest`、`--worker`、`--container` とは同時に使えません。
:::

## 処理フロー

`deploy-group` を実行すると、以下の順番で処理が進みます。

```text
1. .takos/app.yml を読み込み → バリデーション
2. リソースを作成（D1, R2, KV, secretRef）
   → 既存リソースがあれば再利用
3. Worker をデプロイ
   → wrangler.toml を動的生成
   → リソースの binding を注入
4. Container をデプロイ（定義がある場合）
   → CF Containers の設定を自動生成
5. Secrets を設定
6. テンプレート変数を解決 → 環境変数として注入
→ 結果: アプリが動いている
```

## デプロイ後のリソース

<div v-pre>

デプロイが完了すると、以下のリソースが Cloudflare 上に作成されます。

| コンポーネント | 実行環境 | 命名規則 |
| --- | --- | --- |
| Worker | Cloudflare Workers | `{groupName}-{workerName}` |
| Container | CF Containers (Durable Object) | Worker に紐づいてデプロイ |
| DB | Cloudflare D1 | `{groupName}-{env}-{resourceName}` |
| Storage | Cloudflare R2 | `{groupName}-{env}-{resourceName}` |
| KV | Cloudflare KV Namespace | `{groupName}-{env}-{resourceName}` |
| Route | Cloudflare Workers Routes | manifest の routes 定義に従う |

</div>

## `deploy` との使い分け

| ケース | コマンド |
| --- | --- |
| Store に公開するアプリ | `takos deploy` |
| 開発中・テスト | `takos deploy-group` |
| control plane 自体のデプロイ | `takos deploy-group --wrangler-config` |

詳しくは [Store 経由デプロイ](/deploy/store-deploy) を参照してください。

## 次のステップ

- [Store 経由デプロイ](/deploy/store-deploy) --- `takos deploy` の使い方
- [Dispatch Namespace](/deploy/namespaces) --- マルチテナントデプロイ
- [ロールバック](/deploy/rollback) --- ロールバックの手順
- [トラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処
