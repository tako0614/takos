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
  - id: mcp
    target: web
    path: /mcp

publish:
  - name: search
    type: takos.mcp-server.v1
    display:
      title: Search MCP
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      transport: streamable-http
```

## Manifest route publication

`routes` が実際の ingress で、`publish` は MCP endpoint を共有する typed outputs
catalog です。`takos.mcp-server.v1` は platform / agent 側が解釈する standard route
publication type です。legacy alias として `McpServer` も受け付けます。MCP route publication は deploy manifest の `publish`
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
| publication       | deploy manifest の `publish: type: takos.mcp-server.v1` | Takos app / group が公開する MCP endpoint   |
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
        inject:
          env:
            url: SEARCH_MCP_URL
```

この例では `agent` に `SEARCH_MCP_URL` が入ります。

## auth.bearer.secretRef

`auth.bearer.secretRef` は platform-managed behavior です。MCP client に bearer auth
が必要なことと、「publisher service のどの env/secret 名から token
を解決するか」を伝えるために使います。

```yaml
publish:
  - name: search
    type: takos.mcp-server.v1
    display:
      title: Search MCP
    outputs:
      url:
        kind: url
        routeRef: mcp
    auth:
      bearer:
        secretRef: MCP_AUTH_TOKEN
    spec:
      transport: streamable-http
```

group-managed deploy では、publisher service に同名の env/secret
がまだ無い場合、 Takos が secret service env を生成します。既に service env /
common env / secret binding がある場合は既存値を優先します。manifest 外の
standalone deploy では同名の secret を別途用意してください。Takos の MCP client
は publication の owner service からその値を解決して `Authorization: Bearer ...`
を送ります。 worker 側の `/mcp` endpoint も同じ token
を検証する実装にしておく必要があります。

## 実 URL

route publication の main output は慣例的に `url` です。値は assigned hostname
と `outputs.url.routeRef` が参照する route の `path` から生成されます。route が template の場合は
template URL のまま consumer に渡ります。default env 名は publication 名から決まり、`search` なら
`PUBLICATION_SEARCH_URL` になります。
