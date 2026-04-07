# takos-git

Git リポジトリホスティング。

```yaml
name: takos-git

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
  objects: object-store

routes:
  - path: /
    target: web

publish:
  - type: UiSurface
    path: /
    title: Repos
    icon: git-branch
  - type: GitSmartHttp
    path: /git
  - type: Api
    path: /api
```

## 役割

- Git smart HTTP protocol
- リポジトリ管理（create / fork / delete）
- branch, tag, release 管理
- Pull Request
- UiSurface でリポジトリブラウザ UI を提供

## 所有する data

- repositories, commits, branches
- blobs, files, trees
- pullRequests, tags, releases

## Resources

| resource | 用途 |
| --- | --- |
| sql | git DB (repos, commits, PRs) |
| object-store | git objects (blob/tree/commit storage) |
