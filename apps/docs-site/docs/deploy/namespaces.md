# Dispatch Namespace

> このページでわかること: dispatch namespace を使ったマルチテナントデプロイの仕組み。

`--namespace` を指定すると、Worker は Cloudflare の dispatch namespace 内にデプロイされます。テナントごとに Worker を論理分離する場合に使います。

## 基本的な使い方

```bash
takos deploy-group --env staging --namespace takos-staging-tenants
```

## namespace あり / なしの違い

<div v-pre>

| 項目 | namespace なし | namespace あり |
| --- | --- | --- |
| Worker 名 | `{workerName}` | `{groupName}-{workerName}` |
| service binding の参照先 | `{targetName}` | `{groupName}-{targetName}` |
| wrangler.toml | 通常 | `dispatch_namespace` field が追加 |

</div>

## マルチテナントの構成例

テナントごとに同じアプリを namespace 内にデプロイする場合:

```bash
# テナント A
takos deploy-group --env production \
  --namespace production-tenants \
  --group tenant-a

# テナント B
takos deploy-group --env production \
  --namespace production-tenants \
  --group tenant-b
```

`--group` でグループ名を指定すると、Worker 名のプレフィックスが変わります。これにより、同じ namespace 内で複数テナントの Worker を共存させられます。

## wrangler.toml との組み合わせ

`--wrangler-config` と `--namespace` を組み合わせると、既存の wrangler.toml に `dispatch_namespace` field を注入してからデプロイします。

```bash
takos deploy-group --wrangler-config wrangler.toml \
  --env staging \
  --namespace takos-staging-tenants
```

## 注意点

- namespace 内の Worker は、namespace 外から直接アクセスできません。dispatcher Worker 経由でアクセスします
- namespace の作成自体は Cloudflare ダッシュボードまたは API で事前に行う必要があります
- namespace を使う場合、service binding の参照先も namespace 内の名前に変わります

## 次のステップ

- [deploy-group](/deploy/deploy-group) --- デプロイコマンドの詳細
- [Store 経由デプロイ](/deploy/store-deploy) --- Store 経由のデプロイ
- [トラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処
