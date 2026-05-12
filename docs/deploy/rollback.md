# ロールバック

rollback は利用者視点では AppInstallation の version を戻す操作、kernel 視点では
GroupHead を retained Deployment に切り替える操作です。

## AppInstallation rollback

install された app は source commit、`.takosumi/app.yml` digest、compiled manifest
digest を AppInstallation ledger に pin しています。rollback は以前の pinned
version を選び、install preview と同じ確認を通してから runtime を戻します。

```bash
takosumi-git rollback inst_abc --to v1.2.3
```

成功すると AppInstallation は `ready` に戻り、InstallationEvent ledger に rollback
event が残ります。

## Kernel rollback

kernel は group ごとに GroupHead を持ちます。

```text
current_deployment_id  -> dep_new
previous_deployment_id -> dep_old
```

rollback は `current_deployment_id` を retained Deployment に切り替える pointer
move です。新しい Deployment record は作りません。

## 戻るもの

- workload code
- compiled manifest の env
- route / custom-domain desired state
- resource desired state
- retained artifact digest

## 戻らないもの

- database の data
- object store / key-value の data
- 外部 API で発生した副作用
- Accounts 側で現在有効な issuer / billing / grant policy

DB migration は expand-only にし、destructive change は段階的に進めます。

## Retention requirements

rollback target には次が残っている必要があります。

- manifest snapshot
- descriptor closure
- desired state
- artifact digest
- status / conditions

これらが GC された Deployment は rollback target にできません。

## Next

- [Deployment Group](/deploy/deploy-group)
- [Git / Store install](/deploy/store-deploy)
- [トラブルシューティング](/deploy/troubleshooting)
