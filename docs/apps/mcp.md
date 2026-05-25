# MCP Server

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: Takos に MCP ツールを公開するアプリの作り方。

MCP エンドポイントは通常の HTTP ワークロードとしてデプロイします。 MCP カタログとクライアントディスカバリは Takos
のアプリレイヤーで管理されます。

## AppSpec

```yaml
apiVersion: v1
metadata:
  id: com.example.my-tools
  name: My Tools
components:
  mcp:
    kind: worker
    spec:
      entrypoint: src/worker.ts
    publish:
      http:
        as: http-endpoint
  public:
    kind: gateway
    listen:
      upstream:
        from: mcp.http
        as: upstream
    publish:
      public:
        as: http-endpoint
    spec:
      listeners:
        public:
          protocol: https
          host: tools.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

Takosumi installer は AppSpec を evaluate し、gateway descriptor spec と source file reference を Deployment record
に残します。build が必要な source は build service / CI が prepared source archive にして Installer API へ渡します。

adopted gateway/ingress component は public endpoint を作ります。MCP の `/mcp` runtime path は Takos product 内部 MCP registry
metadata と worker 実装で扱います。

## App Metadata

Takos app に MCP server として見せる metadata は App metadata / Takos app catalog
/ runtime registration に置きます。MCP endpoint descriptor は Deployment output
の public endpoint publication と runtime path を参照します。

```yaml
mcp:
  endpoints:
    - name: search
      transport: streamable-http
      endpoint:
        from: public.public
        path: /mcp
      auth:
        kind: bearer
        tokenRef: mcp-auth-token
      description: Search MCP server
```

`endpoint.from` は Takos registry が Deployment output の public endpoint publication
に紐づける app metadata です。MCP metadata の update / visibility / enable state
は Takos app 側の registry が扱います。

## MCP Server Registry

`GET /api/mcp/servers` や `mcp_list_servers` tool は space-scoped な MCP server registry を返します。HTTP 呼び出しでは
`spaceId` または `space_id` query が必要です。

登録元は次のように分かれます。

| source kind       | 作り方                                      | 主な用途                                    |
| ----------------- | ------------------------------------------- | ------------------------------------------- |
| app metadata      | App / Takos app catalog metadata            | installed app が公開する managed endpoint   |
| service           | service 側の managed registration           | service-backed MCP endpoint                 |
| bundle deployment | bundle deployment 側の managed registration | bundle-backed MCP endpoint                  |
| external          | `/api/mcp/servers` または `mcp_add_server`  | 外部 HTTPS MCP server を agent tools に追加 |

`POST /api/mcp/servers` と `mcp_add_server` は external MCP server を space に登録する入口です。deploy 済み workload を
MCP endpoint として公開する場合は、app metadata / registry entry を更新します。

dynamic MCP tools の実行は space role で gate されます。owner / admin / editor の run だけが MCP server 由来 tool
を実行でき、viewer は一覧や metadata 参照に限られます。external MCP server 由来 tool は outbound HTTP を伴うため、run
capability に `egress.http` が必要です。managed endpoint は同じ role gate を受けますが、 external MCP 用の追加 egress
gate は不要です。

## Bearer Auth

MCP client に bearer auth を要求する場合、token は secret ref として workload に渡し、metadata 側には token reference
だけを置きます。

```yaml
apiVersion: v1
metadata:
  id: com.example.my-tools
  name: My Tools
components:
  mcp:
    kind: worker
    spec:
      entrypoint: src/worker.ts
    publish:
      http:
        as: http-endpoint
  public:
    kind: gateway
    listen:
      upstream:
        from: mcp.http
        as: upstream
    publish:
      public:
        as: http-endpoint
    spec:
      listeners:
        public:
          protocol: https
          host: tools.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

MCP call の access control は Takos product 内部 MCP registry の role gate / bearer auth と worker 側 `Authorization`
header 検証で表現します。

worker 側は `Authorization: Bearer ...` を検証します。client side は MCP metadata の `auth.tokenRef` から token source
を解決します。

## Related

- [MCP Server Example](/examples/mcp-server)
- [AppSpec](https://takosumi.com/docs/reference/manifest)
