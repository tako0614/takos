# Worker + Container

Container 実行を伴う module の例です。実行環境そのものは module の宣言ではなく、
policy が provider の許可リスト、state backend、Cloudflare Container 実行を解決します。

## 流れ

1. OpenTofu module を持つ Git リポジトリ (URL / ref / module path) を選びます。
2. Capsule を作り plan を実行し、`plan` Run の差分・警告・policy 結果を確認します。
3. 確認した plan を apply します。`apply` Run として記録され、成功すると
   StateVersion と Output が更新されます。

接続 (credential) は ProviderConnection が参照を持ち、ProviderBinding が module の
provider ごとに接続を解決します。アカウントの policy、credential、OIDC client、
課金、ドメインは Takosumi Accounts plane の管轄です。

## install の形

```json
{
  "spaceId": "space_1",
  "module": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "."
  }
}
```

plan は `plan` Run を作り、確認した plan が `apply` Run として適用されます。
Takos と Takosumi の分担は [Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
