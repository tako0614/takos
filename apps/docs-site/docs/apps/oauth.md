# OAuth

app.yml に `spec.oauth` を書くと、OAuth client が自動登録される。

## 設定

```yaml
spec:
  oauth:
    clientName: My App
    redirectUris:
      - https://example.com/callback
    scopes:
      - threads:read
      - runs:write
    autoEnv: true
```

`autoEnv: true` にすると、client ID と secret が環境変数に自動注入される。

## よく使うスコープ

| スコープ | 説明 |
|---|---|
| threads:read | スレッド閲覧 |
| threads:write | スレッド作成・更新 |
| runs:read | 実行結果閲覧 |
| runs:write | 実行開始 |

## 次のステップ

- [MCP Server](/apps/mcp)
