# シンプルな Worker

最小の例です。Worker を 1 つデプロイする OpenTofu module を、Git URL と ref だけ
指定して install します。module 側に Takos 専用の宣言は要りません。

## 流れ

1. OpenTofu module を持つ Git リポジトリの URL と ref を選びます。
2. Capsule を作り、plan を実行します。`plan` Run として差分と警告が記録されるので、
   内容を確認します。
3. 確認した plan を apply します。`apply` Run として記録され、成功すると
   StateVersion と Output が更新されます。
4. 消すときは `destroy_plan` の確認を経て `destroy_apply` まで進み、同じく履歴に残ります。

接続 (credential) は ProviderConnection が参照を持ち、ProviderBinding が module の
provider ごとにどの接続を使うかを解決します。OIDC client、課金、ドメインは
Takosumi Accounts plane の管轄です。

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

これで module を指す Capsule ができます。以後の typed Run が実行記録として
積み上がります。Takos と Takosumi の分担は [Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
