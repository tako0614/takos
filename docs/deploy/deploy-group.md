# Run の履歴

Takosumi は install から destroy までの実行を、Capsule に紐づく typed Run として
記録します。plan、apply、destroy はそれぞれ別の Run 種別で、履歴は追記のみです。

## 流れ

1. Git URL / ref から Capsule を作ります。
2. `plan` を実行すると **`plan` Run** が記録され、差分・警告・policy 結果を
   確認できます。
3. 確認した plan を apply すると **`apply` Run** が記録され、成功すると
   StateVersion と Output が更新されます。
4. destroy は **`destroy_plan` → 承認 → `destroy_apply`** の 2 段階で、同じ
   Capsule の履歴に追記されます。

接続 (credential) は ProviderConnection が参照を持ち、ProviderBinding が provider
ごとに接続を解決します。policy は provider の許可リスト、state backend、実行
image / リソース上限、Cloudflare Container 実行を解決します。credential の発行、
OIDC client、課金、ドメイン、dashboard は Takosumi Accounts plane の管轄です。

## install の形

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "deploy/opentofu/cloudflare"
  }
}
```

apply は確認済みの `plan` Run を対象にし、`apply` Run として記録されます。
Takos と Takosumi の分担は [Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
