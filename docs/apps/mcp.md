# MCP Server

MCP endpoint を公開するには route publication を `publish` に書きます。

## 基本

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    readiness: /mcp

routes:
  - target: web
    path: /mcp

publish:
  - name: search
    type: McpServer
    publisher: web
    path: /mcp
    title: Search MCP
    spec:
      transport: streamable-http
```

## Manifest route publication

`routes` が実際の ingress で、`publish` は MCP endpoint を共有する information
catalog です。`McpServer` は platform / agent 側が解釈する custom route
publication type です。MCP route publication は deploy manifest の `publish`
entry で管理します。

control plane は deploy 後に managed MCP server catalog entry を保存・参照します
が、manifest 外で route publication を作る入口ではありません。`publish` は
generic plugin resolver ではなく、宣言済み route の metadata を共有する catalog
です。

## MCP server registry

`GET /api/mcp/servers` や `mcp_list_servers` tool は、external registry entry
だけでなく manifest publication 由来の managed MCP server
も返します。`/api/mcp/servers*` family は space-scoped で、HTTP 呼び出しでは
`spaceId` または `space_id` query が必要です。manifest publication 由来の server
は `source_type: publication`、external entry は
`source_type: external`、service-backed managed server は
`source_type: service`、bundle deployment managed server は
`source_type: bundle_deployment` です。

`POST /api/mcp/servers` や `mcp_add_server` tool は external MCP server を space
に登録するための入口です。deployed group の route publication を manifest 外で
作る API ではありません。

dynamic MCP tools の実行は space role で gate されます。owner / admin / editor
の run だけが MCP server 由来 tool を実行でき、viewer は一覧や metadata
参照に限られます。さらに `source_type: external` の MCP server 由来 tool は
outbound HTTP を伴うため、run capability に `egress.http` が必要です。manifest
publication / service / bundle deployment 由来の managed MCP server は同じ role
gate を受けますが、external MCP 用の `egress.http` gate は追加されません。

| source_type       | 作り方                                        | 主な用途                                    |
| ----------------- | --------------------------------------------- | ------------------------------------------- |
| publication       | deploy manifest の `publish: type: McpServer` | Takos app / group が公開する MCP endpoint   |
| service           | service / worker 側の managed registration    | service-backed MCP endpoint                 |
| bundle_deployment | bundle deployment 側の managed registration   | bundle-backed MCP endpoint                  |
| external          | `/api/mcp/servers` または `mcp_add_server`    | 外部 HTTPS MCP server を agent tools に追加 |

managed publication entry の name / URL / enabled state は manifest と deploy
state が基準です。`PATCH /api/mcp/servers/:id` は external entry の name /
enabled を更新できますが、managed / publication server の name
は変更できません。`DELETE /api/mcp/servers/:id` は external entry
だけを削除します。managed / publication server を消すには、元の manifest
publication を変更して deploy します。対応する tool は `mcp_update_server` と
`mcp_remove_server` です。

## consume で使う

publication は自動で space 全体へ注入されません。必要な compute が明示的に
`consume` します。

```yaml
compute:
  agent:
    build: ...
    consume:
      - publication: search
        env:
          url: SEARCH_MCP_URL
```

この例では `agent` に `SEARCH_MCP_URL` が入ります。

## authSecretRef

`authSecretRef` は `spec` 内の custom metadata です。MCP client に「どの env
名の token を送ればよいか」を伝えたいときに使います。

```yaml
publish:
  - name: search
    type: McpServer
    publisher: web
    path: /mcp
    title: Search MCP
    spec:
      transport: streamable-http
      authSecretRef: MCP_AUTH_TOKEN
```

実際の `MCP_AUTH_TOKEN` の値は manifest では自動生成されません。service env
settings か secret resource / runtime binding から供給してください。

## 実 URL

route publication の output は `url` です。値は assigned hostname と宣言した
`path` から生成されます。path が template の場合は template URL のまま consumer
に渡ります。default env 名は publication 名から決まり、`search` なら
`PUBLICATION_SEARCH_URL` になります。
