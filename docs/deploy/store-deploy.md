# Store 経由デプロイ

> このページでわかること: `takos deploy` / `takos install` / `app-deployments` の current contract。

Takos では app deployment を source kind で 2 つに分けます。

- `takos deploy`: repo/ref を source にデプロイする
- `takos install`: Store package release を source にデプロイする

どちらも control plane 上では `/api/spaces/:spaceId/app-deployments` を使い、結果は `group` に反映されます。

## 基本的な使い方

```bash
takos deploy --space SPACE_ID --repo REPO_ID --ref main
```

```bash
takos install takos/takos-agent --space SPACE_ID --version v1.0.0
```

## apply との違い

| 観点 | `takos deploy` / `takos install` | `takos apply` |
| --- | --- | --- |
| source | repo/ref または package release | local working tree |
| 解決場所 | control plane | CLI が manifest / artifact を読んで upload |
| 用途 | CI/CD, Store install, remote source deploy | 開発中の app を直接 apply |
| group 作成 | apply 時に必要なら作成 | apply 時に必要なら作成 |
| ロールバック | `app-deployments.rollback` | 以前のコードで再 apply |
| rollout control | v1 では未提供 (`410 Gone`) | なし |

## デプロイ前の検証

デプロイ前に manifest だけ検証できます。

```bash
takos plan
```

`takos plan` は non-mutating preview です。group が未作成でも DB row は作りません。

## デプロイ状態の確認

```bash
# space 内のデプロイ一覧
takos deploy status --space SPACE_ID

# 特定のデプロイの詳細
takos deploy status APP_DEPLOYMENT_ID --space SPACE_ID
```

## Rollout 制御

`rollout` 系 endpoint は互換 surface として URL だけ残っていますが、current v1 では `410 Gone` を返します。現時点の rollback は「前の成功 deployment source を使って再 deploy する」方式です。

## API

`takos deploy` / `takos install` が内部で使う API です。UI 連携や CI/CD からも直接利用できます。

```text
POST   /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback
DELETE /api/spaces/:spaceId/app-deployments/:appDeploymentId
```

## API リクエスト・レスポンス例

### repo/ref デプロイ

```bash
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "group_name": "my-app",
    "env": "staging",
    "source": {
      "kind": "repo_ref",
      "repo_id": "repo_abc123",
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
      "kind": "repo_ref",
      "repo_id": "repo_abc123",
      "ref": "main",
      "ref_type": "branch",
      "commit_sha": "abc123def456"
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

### Store package install

```bash
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {
      "kind": "package_release",
      "owner": "takos",
      "repo_name": "takos-agent",
      "version": "v1.0.0"
    }
  }'
```

### ロールバック

```bash
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments/{appDeploymentId}/rollback \
  -H "Authorization: Bearer $TOKEN"
```

### デプロイの削除

```bash
curl -X DELETE https://takos.example.com/api/spaces/{spaceId}/app-deployments/{appDeploymentId} \
  -H "Authorization: Bearer $TOKEN"
```

## 次のステップ

- [apply](/deploy/apply) --- `takos apply` による直接デプロイ
- [ロールバック](/deploy/rollback) --- ロールバックの手順
- [API リファレンス](/reference/api) --- API の詳細
