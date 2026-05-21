# MCP Server

> このページでわかること: Takos に MCP ツールを公開するアプリの作り方。

> **Wave N planned (2026-05-21 RFC stage)**: 本ドキュメントの AppSpec 例で使う
> `build:` field と `kind: worker` は、 takosumi Wave N で削除/再定義予定 (=
> kernel pure contract executor 化、 build は別 `kind: build` component に移管、
> worker kind は operator distribution が JSON-LD + plugin で持ち込む)。 詳細
> design は takosumi
> [RFC 0001](https://takosumi.com/docs/rfc/0001-kernel-kind-agnostic) を参照。

MCP エンドポイントは通常の HTTP ワークロードとしてデプロイします。 MCP
カタログとクライアントディスカバリは Takos のアプリレイヤーで管理されます。

## AppSpec

```yaml
apiVersion: v1
metadata:
  id: com.example.my-tools
  name: My Tools
components:
  mcp:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    routes:
      - tools.example.com/*
interfaces:
  mcp:
    target: mcp
    path: /mcp
```

Takosumi installer は `components.mcp.build` を実行し、build output の digest と
route を Deployment record に残します。

## App Metadata

Takos app に MCP server として見せる metadata は kernel manifest の top-level
field ではありません。App metadata、Takos app catalog、または runtime
registration が次のような MCP endpoint descriptor を持ちます。

```yaml
mcp:
  endpoints:
    - name: search
      transport: streamable-http
      url: ${ref:mcp.url}
      auth:
        kind: bearer
        tokenRef: mcp-auth-token
      description: Search MCP server
```

`url` は deploy 後の resource output / route output から materialize されます。
MCP metadata の update / visibility / enable state は Takos app 側の registry
で扱い、takosumi kernel はこの metadata の意味を解釈しません。

## MCP Server Registry

`GET /api/mcp/servers` や `mcp_list_servers` tool は space-scoped な MCP server
registry を返します。HTTP 呼び出しでは `spaceId` または `space_id` query が
必要です。

登録元は次のように分かれます。

| source kind       | 作り方                                      | 主な用途                                    |
| ----------------- | ------------------------------------------- | ------------------------------------------- |
| app metadata      | App / Takos app catalog metadata            | installed app が公開する managed endpoint   |
| service           | service 側の managed registration           | service-backed MCP endpoint                 |
| bundle deployment | bundle deployment 側の managed registration | bundle-backed MCP endpoint                  |
| external          | `/api/mcp/servers` または `mcp_add_server`  | 外部 HTTPS MCP server を agent tools に追加 |

`POST /api/mcp/servers` と `mcp_add_server` は external MCP server を space
に登録 する入口です。deploy 済み workload を MCP endpoint
として公開する場合は、kernel manifest ではなく app metadata / registry entry
を更新します。

dynamic MCP tools の実行は space role で gate されます。owner / admin / editor
の run だけが MCP server 由来 tool を実行でき、viewer は一覧や metadata
参照に限ら れます。external MCP server 由来 tool は outbound HTTP
を伴うため、run capability に `egress.http` が必要です。managed endpoint は同じ
role gate を受けますが、 external MCP 用の追加 egress gate は不要です。

## Bearer Auth

MCP client に bearer auth を要求する場合、token は secret ref として workload
に渡し、metadata 側には token reference だけを置きます。

```yaml
apiVersion: v1
metadata:
  id: com.example.my-tools
  name: My Tools
components:
  mcp:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    routes:
      - tools.example.com/*
interfaces:
  mcp:
    target: mcp
    path: /mcp
permissions:
  requested:
    - mcp.call
```

worker 側は `Authorization: Bearer ...` を検証します。client side は MCP
metadata の `auth.tokenRef` から token source を解決します。

## Related

- [MCP Server Example](/examples/mcp-server)
- [AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
