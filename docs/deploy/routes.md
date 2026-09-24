# ルーティング

Takos は `takos/deploy/opentofu/cloudflare` と 1 回の wrangler artifact upload で
デプロイします。立ち上がった worker が Takos の product route を公開し、外部の
Takosumi Accounts / deploy-control / dashboard / OpenTofu runner を利用します。
実行記録は Takosumi が Run / StateVersion / Output として残します。

## 流れ

1. Takos の OpenTofu module を実行し、worker artifact を upload します。
2. 外部の Takosumi Accounts / deploy-control から Workspace とアプリの Capsule を
   作ります。
3. provider の所有者を選んで plan を実行し、`plan` Run の差分と警告を確認します。
4. 確認した plan を apply します。成功した `apply` Run が StateVersion と
   Output を記録します。
5. 課金、OIDC client、ドメイン、dashboard は Takos の product 面ではなく
   Takosumi Accounts plane の管轄です。

## install の形

```json
{
  "spaceId": "space_1",
  "module": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

apply の要求は plan 段階で確認済みの `plan` Run を参照します。Takos と Takosumi の
分担は [Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
