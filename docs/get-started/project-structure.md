# プロジェクト構成

Takos は AI workspace distribution です。ユーザー向けの主な構成要素は Workspace、
chat、agent、memory、Git、app launcher、MCP tools です。アプリや追加の runtime
service は Git URL から入る OpenTofu Capsule として install され、外部の Takosumi
control plane が Capsule / Run / StateVersion / Output / Capsule output projection を
管理します。

## 動く流れ

1. Workspace を作り、chat・memory・Git・tool を使う。
2. アプリや service は Git URL / ref と module path を選んで OpenTofu Capsule として install する。
3. Takosumi の `plan` Run を確認し、保存された plan を承認してから `apply` する。
4. Takos は非 secret の output と Capsule output projection の記録を読み、
   app launcher の項目、MCP tool、file handler、storage、Git、agent runtime の
   capability を表示する。
5. account、billing、OIDC client、dashboard、provider credential、state、
   audit evidence は外部の Takosumi control plane に残る。

## Capsule の形

Capsule は deploy する OpenTofu module を参照します。

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

plan / apply のリクエストは Capsule と reviewed `plan` Run を参照します。
Takos product routes は Takosumi deploy-control API または Takosumi Accounts の
dashboard flow を呼び、product 固有の deployment surface を別に持ちません。
境界の全体像は [Takos の概念](/platform/) を参照してください。

## 次に読む

- [セルフホスト概要](/deploy/)
- [インストール方法](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
