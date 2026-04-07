# takos-store

パッケージカタログ / マーケットプレイス / ActivityPub federation。

```yaml
name: takos-store

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

storage:
  db: sql

routes:
  - path: /
    target: web

publish:
  - type: UiSurface
    path: /
    title: Store
    icon: store
  - type: Api
    path: /api
```

## 役割

- パッケージ / app の検索と発見
- catalog browsing
- `takos install` の backend
- ActivityPub federation による分散カタログ
- UiSurface でカタログ UI を提供

## 所有する data

- storeRegistry
- storeInventoryItems
- ActivityPub followers

## Resources

| resource | 用途 |
| --- | --- |
| sql | store DB (catalog, inventory, AP) |
