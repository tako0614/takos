# Store 経由デプロイ

> このページでわかること: `takos deploy` / app-deployments の設計上の contract。

`takos deploy` は CLI 上に残っているものの、このリポジトリの current implementation では control plane 側の app-deployments パスに end-to-end で接続されていません。Store に公開する app deploy は、今は「今後の surface」として読むのが正確です。

::: warning current status
`takos deploy` と `/api/spaces/:spaceId/app-deployments` は docs と route 定義はありますが、現行コードでは service 実装が未接続です。実運用では `takos apply` を使ってください。
:::

## 基本的な使い方

```bash
takos deploy --space SPACE_ID --repo REPO_ID --ref main
```

## apply との違い

| 観点 | `takos deploy` | `takos apply` |
| --- | --- | --- |
| 状態 | current では未接続 | current |
| 用途 | Store 経由の将来 surface | ローカルから直接デプロイ |
| 対象 | repo/ref に紐づく artifact | `.takos/app.yml` のグループ定義 |
| 認証 | Takos の認証 | Cloudflare API トークン |
| 主な利用場面 | 将来の CI/CD surface | 開発・検証環境 |
| ロールバック | 将来の contract | 以前のコードで再 apply |
| rollout | 将来の contract | なし |

## デプロイ前の検証

デプロイ前に manifest だけ検証できます。

```bash
takos plan
```

以下の項目が検証されます。

- `.takos/app.yml` が `kind: App` であること
- `build.fromWorkflow.path` が `.takos/workflows/` 配下であること
- service / resource / route の参照が整合していること

## デプロイ状態の確認

```bash
# space 内のデプロイ一覧
takos deploy status --space SPACE_ID

# 特定のデプロイの詳細
takos deploy status APP_DEPLOYMENT_ID --space SPACE_ID
```

## Rollout 制御

将来の Store 経由デプロイでは、段階的公開（rollout）を制御できます。

- UI からも trigger 可能
- CI/CD パイプラインに組み込める
- 一時停止、再開、中止、即時完了を API で操作

## API

`takos deploy` が内部で使う予定の API です。UI 連携や CI/CD から直接叩く contract としては残っていますが、current implementation では未接続です。

```text
POST   /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/{pause|resume|abort|promote}
DELETE /api/spaces/:spaceId/app-deployments/:appDeploymentId
```

## API リクエスト・レスポンス例

### デプロイの作成

```bash
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repo_id": "repo_abc123", "ref": "main"}'
```

レスポンス:

```json
{
  "id": "deploy_xxx",
  "status": "pending",
  "created_at": "2026-03-28T00:00:00.000Z"
}
```

### デプロイ一覧の取得

```bash
curl https://takos.example.com/api/spaces/{spaceId}/app-deployments \
  -H "Authorization: Bearer $TOKEN"
```

### 特定デプロイの詳細

```bash
curl https://takos.example.com/api/spaces/{spaceId}/app-deployments/{appDeploymentId} \
  -H "Authorization: Bearer $TOKEN"
```

### ロールバック

```bash
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments/{appDeploymentId}/rollback \
  -H "Authorization: Bearer $TOKEN"
```

### Rollout 制御

```bash
# 一時停止
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments/{appDeploymentId}/rollout/pause \
  -H "Authorization: Bearer $TOKEN"

# 再開
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments/{appDeploymentId}/rollout/resume \
  -H "Authorization: Bearer $TOKEN"

# 中止
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments/{appDeploymentId}/rollout/abort \
  -H "Authorization: Bearer $TOKEN"

# 即時完了（全トラフィックを新バージョンに切り替え）
curl -X POST https://takos.example.com/api/spaces/{spaceId}/app-deployments/{appDeploymentId}/rollout/promote \
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
