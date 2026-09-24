# プロジェクト構成

Takos は AI workspace の配布です。利用者が触る主な要素は Workspace、chat、agent、
memory、Git、アプリの起動、MCP tools です。アプリや追加の runtime service は
Git URL から入る OpenTofu Capsule として install され、外部の Takosumi control
plane が Capsule / Run / StateVersion / Output / Capsule output projection を管理します。

## 使い方の流れ

1. Workspace を作り、chat、memory、Git、tool を使います。
2. アプリやサービスは、OpenTofu Capsule の Git URL / ref / module path を選んで
   install します。
3. Takosumi の `plan` Run を確認し、保存された plan を承認してから `apply` します。
4. Takos は秘密でない Output と Capsule output projection の記録を読み、アプリの
   起動項目、MCP tool、file handler、ストレージ、Git、agent runtime の capability を
   表示します。
5. アカウント、課金、OIDC client、dashboard、provider credential、state、監査の
   記録は外部の Takosumi control plane に残ります。

## Capsule の形

Capsule はデプロイする OpenTofu module を指します。

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "path": "deploy/opentofu/cloudflare"
  }
}
```

plan / apply の要求は Capsule と確認済みの `plan` Run を参照します。Takos と
Takosumi の分担は [Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
