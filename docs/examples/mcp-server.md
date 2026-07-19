# MCP サーバー

この例は、MCP サーバーを普通の OpenTofu Capsule として install し、Takosumi が管理する Interface を通じて
Takos に公開する方法を示します。リポジトリには Takos 専用の MCP manifest も、runtime 宣言用の Output も
含まれません。

## 現在のフロー

1. OpenTofu Capsule リポジトリを指す Git URL/ref を選びます。
2. Capsule を作り、`plan` Run を開始して、その diff と policy の結果を確認します。
3. 承認した plan を apply します。成功すると StateVersion と module の通常の Output が記録されます。
4. `InstallConfig.interfaceBlueprints` から、`inputs.endpoint` を Capsule の公開 endpoint Output へ明示的に
   mapping する service-side の `mcp.server` Interface を materialize します。Form-backed Resource として実現する
   サービスなら、verified な Takoform Form Definition の `interfaces[]` descriptor から portable な宣言を
   materialize する経路もあります。
5. 意図した Principal に `mcp.invoke` を許可する InterfaceBinding を作ります。
6. Takos は、解決され認可された Interface を Workspace の tool catalog に一覧表示します。

## OpenTofu Module

module が返すのは deploy の事実だけです。

```hcl
output "mcp_url" {
  description = "Public Streamable HTTP endpoint"
  value       = "${cloudflare_worker_deployment.app.url}/mcp"
}
```

`mcp_url` は module が決めた通常の名前にすぎません。別の module が同じ値を `endpoint` や `url` など別の名前
で返してもかまいません。service-side の mapping がその名前を明示的に選びます。

## Takosumi の Interface

```json
{
  "workspaceId": "ws_1",
  "name": "researchTools",
  "ownerRef": { "kind": "Capsule", "id": "cap_1" },
  "spec": {
    "type": "mcp.server",
    "version": "2025-11-25",
    "document": {
      "transport": "streamable-http",
      "display": { "title": "Research tools" }
    },
    "inputs": {
      "endpoint": {
        "source": "capsule_output",
        "capsuleId": "cap_1",
        "outputName": "mcp_url"
      }
    },
    "access": {
      "visibility": "workspace",
      "resourceUriInput": "endpoint"
    }
  }
}
```

現在 Takos が実装している managed path 向けには、認証不要の Ready な binding で Principal を認可します。

```json
{
  "subjectRef": { "kind": "Principal", "id": "account_1" },
  "permissions": ["mcp.invoke"],
  "delivery": { "type": "none" }
}
```

保護された Capsule の場合は、`delivery.type` を `oauth2` にし、`spec.access.resourceUriInput` をその
HTTPS endpoint に mapping します。Binding が Ready になるのは、host の issuer が設定されていて、かつ
Takosumi が Capsule がその hostname を所有していることを証明できたときだけです。Takos は、自分の
delegated Accounts credential を、最大 60 秒の audience 限定 Bearer と交換します。どちらの credential も
OpenTofu Output や Interface の input にはなりません。外部の MCP Connections は、引き続き別の OAuth と
token 保存のフローを持ちます。

## 境界

provider の認証情報とリソースの apply は、Takosumi の ProviderConnection / CredentialRecipe /
ProviderBinding / policy に留まります。Takosumi は Interface の解決と InterfaceBinding の認可を持ちます。
Takos は MCP discovery の表示、tool のレビュー、呼び出し policy、agent のユーザー体験を持ちます。

## 関連ページ

- [OpenTofu Output と runtime Interface](/deploy/runtime-interfaces)
- [Takos アプリの Interface](/architecture/app-interface)
- [Capsule の runtime Interface](/architecture/capsule-runtime-projection)
