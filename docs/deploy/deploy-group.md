# Deployment Group

Deployment group は複数の Shape resources を 1 つの lifecycle として扱う scope
です。GroupHead は current Deployment pointer を持ち、rollback はこの pointer
を retained Deployment に切り替える操作として実装されます。

## AppInstallation との関係

| 階層 | 表すもの | 所有者 |
| --- | --- | --- |
| AppInstallation | Account に install された app 1 件 | Takosumi Accounts |
| Deployment group | apply された resource set の履歴 scope | Takosumi kernel |
| Shape resource | `web-service@v1` / `worker@v1` / `database-postgres@v1` など | provider / runtime-agent |

Installation は group の一種ではありません。AppInstallation ledger は ownership、
billing、grant、launch token を持ち、kernel group は runtime apply の履歴を持ちます。

## 何が group で変わるか

- resources をまとめて履歴化できる
- current / previous Deployment を追跡できる
- rollback の単位になる
- inventory や status を app 単位で表示できる

group は runtime backend、resource provider、routing layer ではありません。
group に属していても、resource の Shape contract は変わりません。

## Manifest との対応

manifest の `metadata.name` は group 名の既定値として使われます。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: full-stack
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/self-hosted-process"
    spec:
      image: ghcr.io/acme/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      port: 8080
      scale: { min: 1, max: 3 }
  - shape: worker@v1
    name: jobs
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
      compatibilityDate: "2026-05-09"
```

この manifest は `full-stack` group の current Deployment として扱えます。

## GroupHead

```text
GroupHead:
  group_id
  current_deployment_id
  previous_deployment_id
  generation
  advanced_at
```

新しい Deployment が apply されると `current_deployment_id` が進み、直前の
Deployment が `previous_deployment_id` に残ります。rollback は retained
Deployment を指すように pointer を切り替えます。

## 関連ページ

- [Direct manifest deploy](/deploy/deploy)
- [ロールバック](/deploy/rollback)
- [Takosumi Deploy System](https://github.com/tako0614/takosumi/blob/master/docs/reference/architecture/deploy-system.md)
