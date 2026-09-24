# ロールバック

Takosumi の rollback は、Capsule が保持している成功済みの StateVersion を基準に、
新しい reviewed な Run / StateVersion / Output を作る control-plane の操作です。
provider data copy / schema migration の巻き戻しは、rollback の現在の保証に
含まれません。

## 流れ

1. Git URL / ref から Capsule を作ります。
2. `plan` Run を実行し、plan の概要・差分・policy 結果を確認します。
3. 確認した plan を承認すると `apply` Run が始まり、成功すると StateVersion と
   Output が更新されます。rollback も同じ reviewed な Run の形で行われます。

接続 (credential) は ProviderConnection が参照を持ち、ProviderBinding が provider
ごとに接続を解決します。policy は provider の許可リスト、state backend、
Cloudflare Container 実行を解決します。インフラの lifecycle、credential、
OIDC client、課金、ドメインは Takosumi Accounts plane の管轄で、Takosumi が
実行履歴と監査の記録を残します。

## install の形

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

`plan` Run は、plan が承認されて `apply` Run になる前に確認するためのものです。
Takos と Takosumi の分担は [Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
