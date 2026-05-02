# MCP Server

MCP endpoint を公開するには `publication.mcp-server@v1` ref の publication
を `publications[]` に declaration します。

## 基本

```yaml
components:
  web:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config:
              workflow: .takos/workflows/deploy.yml
              job: bundle
              artifact: web
              entry: dist/worker.js
          readiness: /mcp
      mcp:
        ref: interface.http@v1

routes:
  - id: mcp
    expose: { component: web, contract: mcp }
    via: { ref: route.https@v1, config: { path: /mcp } }

publications:
  - name: search
    ref: publication.mcp-server@v1
    outputs:
      url: { from: { route: mcp } }
    spec:
      transport: streamable-http
      description: Search MCP server
```

`routes[]` が実際の ingress、 `publications[]` が MCP endpoint を共有する
typed outputs catalog です。 publication 自体は injection を含意せず
(Core invariant 4)、 consumer は `bindings[].from.publication` で明示
consume します。

`publication.mcp-server@v1` の output / spec schema は
[Official Descriptor Set v1 § publication.mcp-server@v1](/takos-paas/descriptors/official-descriptor-set-v1#publicationmcp-serverv1)
を参照。

## MCP server registry

`GET /api/mcp/servers` や `mcp_list_servers` tool は、external registry
entry だけでなく manifest publication 由来の managed MCP server も返します。
`/api/mcp/servers*` family は space-scoped で、 HTTP 呼び出しでは `spaceId`
または `space_id` query が必要です。 manifest publication 由来の server は
`source_type: publication`、 external entry は `source_type: external`、
service-backed managed server は `source_type: service`、 bundle deployment
managed server は `source_type: bundle_deployment` です。

`POST /api/mcp/servers` や `mcp_add_server` tool は external MCP server を
space に登録するための入口です。 deploy された group の route publication
を manifest 外で作る API ではありません。

dynamic MCP tools の実行は space role で gate されます。 owner / admin /
editor の run だけが MCP server 由来 tool を実行でき、 viewer は一覧や
metadata 参照に限られます。 さらに `source_type: external` の MCP server 由来
tool は outbound HTTP を伴うため、 run capability に `egress.http` が必要
です。 manifest publication / service / bundle deployment 由来の managed
MCP server は同じ role gate を受けますが、 external MCP 用の `egress.http`
gate は追加されません。

| source_type       | 作り方                                                                          | 主な用途                                    |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| publication       | deploy manifest の `publications: ref: publication.mcp-server@v1`               | Takos app / group が公開する MCP endpoint   |
| service           | service / component 側の managed registration                                   | service-backed MCP endpoint                 |
| bundle_deployment | bundle deployment 側の managed registration                                     | bundle-backed MCP endpoint                  |
| external          | `/api/mcp/servers` または `mcp_add_server`                                      | 外部 HTTPS MCP server を agent tools に追加 |

managed publication entry の name / URL / enabled state は manifest と
deploy state が基準です。 `PATCH /api/mcp/servers/:id` は external entry の
name / enabled を更新できますが、 managed / publication server の name は
変更できません。 `DELETE /api/mcp/servers/:id` は external entry だけを
削除します。 managed / publication server を消すには、 元の manifest
publication を変更して deploy します。 対応する tool は `mcp_update_server`
と `mcp_remove_server` です。

## bindings で consume する

publication は自動で space 全体へ注入されません。 必要な component が
明示的に `bindings[].from.publication` で consume します。

```yaml
bindings:
  - from: { publication: search }
    to: { component: agent, env: SEARCH_MCP_URL }
```

この例では `agent` component に `SEARCH_MCP_URL` が入ります。

## Bearer auth

MCP client に bearer auth を要求する場合、 secret resource を作って bearer
header source として binding します。

```yaml
resources:
  search-mcp-token:
    ref: resource.secret@v1
    config: { generate: true }

bindings:
  - from: { secret: search-mcp-token }
    to: { component: web, env: MCP_AUTH_TOKEN }
```

publication 側で auth を declarative に宣言する場合は、 `publication.mcp-server@v1`
descriptor の `spec` schema が定義する `auth` field を使います (descriptor
側で受け付ける場合のみ)。 client side は publication metadata から token
source を解決して `Authorization: Bearer ...` を送ります。 worker 側の
`/mcp` endpoint も同じ token を検証する実装にしておく必要があります。

## 実 URL

`from: { route: <id> }` で参照される route の `path` と assigned hostname
から output `url` が生成されます。 path template は template URL のまま
consumer に渡ります。
