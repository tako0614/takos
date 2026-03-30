# MCP Server

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: my-tools
spec:
  version: 0.1.0
  capabilities: [mcp]
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker
  routes:
    - name: mcp-endpoint
      target: web
      path: /mcp
  resources:
    mcp-auth-secret:
      type: secret
      binding: MCP_AUTH_TOKEN
      generate: true
  mcpServers:
    - name: my-tools
      route: mcp-endpoint
      transport: streamable-http
      authSecretRef: mcp-auth-secret
```

`authSecretRef` は `type: secret` resource を参照します。
