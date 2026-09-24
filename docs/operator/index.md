# オペレーター向けガイド

Takos を運用する側が知っておくことの入口です。アプリの install から destroy までの
実行は Takosumi が typed Run として記録し、Takos 側は Workspace の体験を受け持ちます。

## 実行の流れ

1. OpenTofu Capsule の Git URL / ref と、ProviderConnection / ProviderBinding /
   policy を選びます。
2. plan を実行すると、`plan` Run として差分・警告・policy 結果が記録されます。
3. 確認した plan を apply すると `apply` Run が記録され、成功すると
   StateVersion と Output が残ります。
4. destroy は `destroy_plan` → 承認 → `destroy_apply` の順で、同じ Capsule の
   履歴に追記されます。

接続 (credential) は ProviderConnection が参照を持ち、ProviderBinding が module の
provider ごとに接続を解決します。policy は provider の許可リスト、state backend、
実行 image / リソース上限、Cloudflare Container 実行を解決します。アカウントの
policy、OIDC client、課金、ドメインは Takosumi Accounts plane の管轄です。

## install の形

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

plan は `plan` Run を作り、確認した plan の apply が `apply` Run として
StateVersion と Output を記録します。Takos と Takosumi の分担は
[Takos の概念](/platform/)を参照してください。

## 関連ページ

- [OIDC の設定](/operator/oidc-setup)
- [アカウントモデル](/operator/account-model)
- [Deploy overview](/deploy/)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
