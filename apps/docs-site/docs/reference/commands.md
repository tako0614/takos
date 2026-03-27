# CLI command reference

## auth

```bash
takos login
takos whoami
takos logout
```

## endpoint

```bash
takos endpoint use test
takos endpoint use prod
takos endpoint use https://api.takos.dev
takos endpoint show
```

## workspace / repo

```bash
takos workspace list
takos workspace create --body '{"name":"my-workspace"}'
takos repo list
takos repo create --body '{"name":"my-repo"}'
```

## thread / run

```bash
takos thread create /THREAD_ID/messages --body '{"content":"hello"}'
takos run list /THREAD_ID
takos run follow RUN_ID --transport ws
takos run follow RUN_ID --transport sse
```

## deploy

```bash
takos deploy --space SPACE_ID --repo REPO_ID --ref main
takos deploy validate
takos deploy status --space SPACE_ID
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID
```

## build / publish / promote

```bash
# ローカルビルド (CI workflow 経由)
takos build --space SPACE_ID --repo REPO_ID

# バンドルをアップロード
takos publish --space SPACE_ID --file bundle.tar.gz

# staged rollout を次のステージに進める
takos promote APP_DEPLOYMENT_ID --space SPACE_ID

# ロールバック
takos rollback APP_DEPLOYMENT_ID --space SPACE_ID
```

## mcp

```bash
# MCP サーバー一覧
takos mcp list --space SPACE_ID

# MCP サーバー登録
takos mcp add --name my-tools --url https://my-mcp-server.example/mcp

# MCP サーバー削除
takos mcp remove SERVER_ID
```

## personal-access-token

```bash
# PAT 一覧
takos pat list

# PAT 作成
takos pat create --name "my-token" --scopes "*"

# PAT 無効化
takos pat revoke TOKEN_ID
```

## 使わない surface

Takos CLI では、次は canonical ではありません。

- `takos api ...`
- HTTP verb style subcommands
- 古い legacy command group
