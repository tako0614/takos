# Deployment History

> このページでわかること: Installation に紐づく Deployment 履歴と rollback の単位。

Takosumi v1 の public concept は AppSpec / Installation / Deployment の 3 つです。
複数 component の apply 結果は、Installation に紐づく 1 つの Deployment として
履歴化されます。

## Installation との関係

| 階層 | 表すもの | 所有者 |
| --- | --- | --- |
| AppSpec | source root の `.takosumi.yml` | app author |
| Installation | Space に install された app 1 件 | operator account plane |
| Deployment | 1 回の apply / rollback の結果 | Takosumi installer / kernel |
| Component | extensible kind catalog (`worker` / `postgres` / `object-store` / `custom-domain` / 拡張 kind) | provider / runtime-agent |

Installation は ownership、billing、grant、launch token、current Deployment pointer を
持ちます。Deployment は source commit、manifest digest、materialized resources、
outputs、audit event を持ちます。

## 何が履歴化されるか

- source commit / manifest digest
- created / updated / deleted component
- build artifact digest
- provider resource ID と output
- apply status と observation
- rollback の元になった Deployment ID

## AppSpec との対応

```yaml
apiVersion: v1
metadata:
  id: example.full-stack
  name: Full Stack
components:
  api:
    kind: worker
    build:
      command: npm ci && npm run build:api
      output: dist/api.mjs
    routes:
      - api.example.com/*
    listen:
      example.full-stack.db:
        as: env
        prefix: DB_
  jobs:
    kind: worker
    build:
      command: npm ci && npm run build:jobs
      output: dist/jobs.mjs
    listen:
      example.full-stack.db:
        as: env
        prefix: DB_
  db:
    kind: postgres
    publish:
      - example.full-stack.db
```

この AppSpec を apply すると、`api` / `jobs` / `db` の materialization が同じ
Deployment record に保存されます。

## Rollback

rollback は過去 Deployment を改竄せず、その Deployment の source / manifest digest
を元に新しい Deployment を作る forward-only 操作です。

```bash
takosumi rollback "$INSTALLATION_ID" --to "$DEPLOYMENT_ID"
```

## 関連ページ

- [Git / Store install](/deploy/store-deploy)
- [ロールバック](/deploy/rollback)
- [Takosumi installer API](https://github.com/tako0614/takosumi/blob/master/docs/reference/installer-api.md)
