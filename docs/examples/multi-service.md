# マルチサービス構成

複数のサービスを 1 つの graph として持つ module の例です。リポジトリ内の module
path を指定して、対象の module を正確に選びます。

## 流れ

1. OpenTofu module を持つ Git リポジトリの URL / ref / module path を選びます。
2. Capsule を作り plan を実行します。module と ProviderConnection /
   ProviderBinding / policy に対する `plan` Run が記録されます。
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
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "deploy/opentofu/cloudflare"
  }
}
```

Capsule の作成は module 参照を記録し、以後の typed Run が ProviderConnection /
ProviderBinding / policy に対する `plan` / `apply` の記録を積み上げます。
Takos と Takosumi の分担は [Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
