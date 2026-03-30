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

`autoEnv: true` にすると、以下の環境変数が Worker / Container に自動注入される。

| 環境変数名 | 内容 |
| --- | --- |
| `OAUTH_CLIENT_ID` | 登録された OAuth client ID |
| `OAUTH_CLIENT_SECRET` | 登録された OAuth client secret |

## metadata

OAuth client に追加のメタデータを設定できる。ロゴ画像や利用規約・プライバシーポリシーの URL など。

```yaml
spec:
  oauth:
    clientName: My App
    redirectUris: [https://example.com/callback]
    scopes: [threads:read]
    autoEnv: true
    metadata:
      logoUri: https://example.com/logo.png
      tosUri: https://example.com/terms
      policyUri: https://example.com/privacy
```

| field | 説明 |
| --- | --- |
| `logoUri` | OAuth 認可画面に表示するロゴ画像の URL |
| `tosUri` | 利用規約ページの URL |
| `policyUri` | プライバシーポリシーページの URL |

## よく使うスコープ

| スコープ | 説明 |
|---|---|
| threads:read | スレッド閲覧 |
| threads:write | スレッド作成・更新 |
| runs:read | 実行結果閲覧 |
| runs:write | 実行開始 |

## 次のステップ

- [MCP Server](/apps/mcp)
