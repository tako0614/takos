# takos-agent

主 UI + Agent/Chat。他 app の UiSurface を env injection で発見し iframe で統合表示する。

```yaml
name: takos-agent

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

storage:
  db:
    type: sql
  artifacts:
    type: object-store
  embeddings:
    type: vector-index
    vectorIndex:
      dimensions: 1536
      metric: cosine

routes:
  - target: web
    path: /

publish:
  - type: McpServer
    path: /mcp
```

## 役割

- Agent/Chat の実行と UI
- env injection から他 app の endpoint を取得
- sidebar に他 app（takos-storage, takos-store, takos-git 等）を表示
- iframe で各 app の UI を統合表示
- standalone app としても動作可能

## 所有する data

- threads, messages
- runs, artifacts
- skills, memories
- agent tasks
- LangGraph checkpoints

## Resources

| resource | 用途 |
| --- | --- |
| sql | agent DB (threads, runs, skills, memories) |
| object-store | agent artifacts, offload data |
| vector-index | semantic search embeddings |
