# MCP Server

app が MCP endpoint を公開するには route publication を `publish` に書きます。

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
  - name: browser
    type: McpServer
    path: /mcp
    transport: streamable-http
```

`routes` が実際の ingress で、`publish` は discovery metadata です。

## consume で使う

publication は自動で space 全体へ注入されません。必要な compute が明示的に
`consume` します。

```yaml
compute:
  agent:
    build: ...
    consume:
      - publication: browser
        env:
          url: BROWSER_MCP_URL
```

この例では `agent` に `BROWSER_MCP_URL` が入ります。

## authSecretRef

`authSecretRef` は route publication の optional metadata です。MCP client に
「どの env 名の token を送ればよいか」を伝えたいときに使います。

```yaml
publish:
  - name: browser
    type: McpServer
    path: /mcp
    transport: streamable-http
    authSecretRef: MCP_AUTH_TOKEN
```

実際の `MCP_AUTH_TOKEN` の値は manifest では自動生成されません。service env
settings か別の provider publication から供給してください。

## 実 URL

route publication の output は `url` です。default env 名は publication 名から
決まり、`browser` なら `PUBLICATION_BROWSER_URL` になります。
