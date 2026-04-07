# takos-storage

ファイル管理 / blob ストレージ。

```yaml
name: takos-storage

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
  files: object-store

routes:
  - path: /
    target: web

publish:
  - type: UiSurface
    path: /
    title: Files
    icon: folder
  - type: SpaceFiles
    path: /api/files
  - type: Api
    path: /api
```

## 役割

- space 内のファイル管理（upload / download / list / delete）
- blob ストレージ
- UiSurface でファイルブラウザ UI を提供

## 所有する data

- accountStorageFiles
- file metadata, chunks

## Resources

| resource | 用途 |
| --- | --- |
| sql | storage DB (file metadata) |
| object-store | file blob storage |
