# Repository / Catalog デプロイ

> このページでわかること: `takos deploy` / `takos install` / `app-deployments`
> の current contract。

Takos では app deployment の canonical source を `repository_url + ref/ref_type`
に統一しています。

- `takos deploy`: canonical HTTPS git repository URL を source にデプロイする
- `takos install`: catalog metadata から `repository_url + release tag`
  を解決して、そのまま deploy する

どちらも control plane 上では `/api/spaces/:spaceId/app-deployments`
を使い、結果は `group` に反映されます。

## 基本的な使い方

```bash
takos deploy https://github.com/acme/my-app.git --space SPACE_ID --ref main
```

```bash
takos install takos/takos-agent --space SPACE_ID --version v1.0.0
```

## apply との違い

| 観点            | `takos deploy` / `takos install`                   | `takos apply`                                            |
| --------------- | -------------------------------------------------- | -------------------------------------------------------- |
| source          | repository URL + ref                               | local working tree                                       |
| 解決場所        | control plane                                      | CLI が manifest / artifact を読んで upload               |
| 用途            | CI/CD, catalog install alias, remote source deploy | 開発中の app を直接 apply                                |
| group 作成      | apply 時に必要なら作成                             | apply 時に必要なら作成                                   |
| ロールバック    | immutable deployment snapshot を再適用             | 以前のローカル state で再 apply                          |
| deployment 履歴 | app deployment record と snapshot を残す           | source projection は更新するが deployment 履歴は作らない |
| rollout control | current public surface には含まれない              | なし                                                     |

## デプロイ前の検証

デプロイ前に manifest だけ検証できます。

```bash
takos plan
```

`takos plan` は non-mutating preview です。group が未作成でも DB row
は作りません。

## デプロイ状態の確認

```bash
# space 内のデプロイ一覧
takos deploy status --space SPACE_ID

# 特定のデプロイの詳細
takos deploy status APP_DEPLOYMENT_ID --space SPACE_ID
```

## イメージ参照の制約

`services` / `containers` を deploy するときの `imageRef` は digest pin
(`@sha256:...`) 必須です。mutable tag (`:latest` など) は immutable rollback
を壊すので受け付けません。

## public repo の取得

public HTTPS repo の deploy は、通常は git smart protocol で source
を解決します。まず bounded/configurable な full pack を試し、pack size / object
count / inflated size のような content-size・pack-limit 系の失敗だけを blobless
partial fetch の対象にします。任意の fetch error で次段へ fall through
するわけではありません。remote が `filter` と `allow-reachable-sha1-in-want` を
advertise している場合だけ blobless partial fetch に進みます。GitHub / GitLab の
public repo では、それでも解決できないときだけ archive download を host-specific
な 最後の fallback として使います。

上限は `TAKOS_APP_DEPLOY_REMOTE_*` 環境変数で調整できます。代表例は
`TAKOS_APP_DEPLOY_REMOTE_PACKFILE_MAX_BYTES`,
`TAKOS_APP_DEPLOY_REMOTE_OBJECTS_MAX`,
`TAKOS_APP_DEPLOY_REMOTE_BLOB_PACKFILE_MAX_BYTES`,
`TAKOS_APP_DEPLOY_REMOTE_BLOB_OBJECTS_MAX`,
`TAKOS_APP_DEPLOY_REMOTE_ARCHIVE_MAX_BYTES` です。

## API

`takos deploy` / `takos install` が内部で使う API です。UI 連携や CI/CD
からも直接利用できます。

```text
POST   /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback
DELETE /api/spaces/:spaceId/app-deployments/:appDeploymentId
```

## API リクエスト・レスポンス例

### repository URL デプロイ

```bash
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "group_name": "my-app",
    "env": "staging",
    "source": {
      "kind": "git_ref",
      "repository_url": "https://github.com/acme/my-app.git",
      "ref": "main",
      "ref_type": "branch"
    }
  }'
```

レスポンス:

```json
{
  "app_deployment": {
    "id": "deploy_xxx",
    "group": { "id": "grp_xxx", "name": "my-app" },
    "source": {
      "kind": "git_ref",
      "repository_url": "https://github.com/acme/my-app.git",
      "ref": "main",
      "ref_type": "branch",
      "commit_sha": "abc123def456",
      "resolved_repo_id": null
    },
    "snapshot": {
      "state": "available",
      "rollback_ready": true,
      "format": "takopack-v1"
    },
    "status": "applied",
    "manifest_version": "1.0.0",
    "hostnames": ["my-app.example.com"],
    "rollback_of_app_deployment_id": null,
    "created_at": "2026-03-28T00:00:00.000Z",
    "updated_at": "2026-03-28T00:00:00.000Z"
  },
  "apply_result": {
    "applied": [],
    "skipped": []
  }
}
```

### Catalog package install

`takos install OWNER/REPO --version ...` は catalog metadata から
`repository_url` と release tag を解決し、上と同じ `git_ref` request
を作ります。target workspace に Store app が install
されている必要はありません。 `package_release` は current write contract
では使いません。

### ロールバック

```bash
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments/{appDeploymentId}/rollback \
  -H "Authorization: Bearer $TOKEN"
```

rollback は snapshot に保存された source / artifact / provider / env
を再適用します。現在の group metadata より snapshot 側の execution context
を優先します。対象 deployment の group row が既に削除されている場合は rollback
できません。

### デプロイの削除

```bash
curl -X DELETE https://takos.example.com/api/spaces/{spaceId}/app-deployments/{appDeploymentId} \
  -H "Authorization: Bearer $TOKEN"
```

`DELETE /app-deployments/:id` は deployment history record の削除です。稼働中
app の uninstall は `takos uninstall GROUP_NAME` または
`POST /api/spaces/:spaceId/groups/uninstall` を使います。uninstall は group
を削除する terminal 操作で、rollback で group を再生成することはできません。

## 次のステップ

- [apply](/deploy/apply) --- `takos apply` による直接デプロイ
- [ロールバック](/deploy/rollback) --- ロールバックの手順
- [API リファレンス](/reference/api) --- API の詳細
