# takos-computer

ブラウザ自動化 / Linux サンドボックス app。

## 役割

- ブラウザ自動化（Playwright ベースのコンテナ）
- Linux サンドボックス（コード実行・シェル操作用コンテナ）
- MCP Server でブラウザ操作・サンドボックス操作をエージェントに公開
- UiSurface でブラウザ画面を GUI 表示
- standalone でも動作可能

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

例: `team-a-my-computer.app.example.com` or `computer.mycompany.com`

```text
{hostname}
  /gui              → ブラウザ GUI (UiSurface)
  /session          → ブラウザセッション管理
  /mcp              → ブラウザ MCP Server endpoint
  /sandbox/session  → サンドボックスセッション管理
  /sandbox/mcp      → サンドボックス MCP Server endpoint
```

### コンテナ構成

| コンテナ | worker | 用途 |
| --- | --- | --- |
| browser | browser-host | Playwright ブラウザインスタンス |
| sandbox | sandbox-host | Linux サンドボックス |

browser-host worker は sandbox-host サービスへのバインディングを持ち、
ブラウザ操作からサンドボックスへの連携が可能。

## Publications

```yaml
publish:
  - type: UiSurface
    path: /gui
    title: Computer
  - type: McpServer
    path: /mcp
    name: browser
  - type: McpServer
    path: /sandbox/mcp
    name: sandbox
```

## 他 app からの利用

kernel 等がブラウザ操作やコード実行を行いたい場合:

1. env injection で takos-computer の URL を得る
2. `name: browser` または `name: sandbox` で目的の MCP Server を選択
3. MCP プロトコルで接続し tool を呼び出す

## 所有する data

takos-computer は永続データを持たない。
セッションは一時的なコンテナインスタンスとして管理される。

## Resources

| resource | manifest 上の宣言 | 用途 |
| --- | --- | --- |
| mcp-auth-secret | `storage.<name>.type: secret` (`generate: true`) | MCP 認証トークン (自動生成) |
| browser | `compute.<host>.containers.browser` (Attached Container) | Playwright ブラウザ (standard-2, max 25) |
| sandbox | `compute.<host>.containers.sandbox` (Attached Container) | Linux サンドボックス (basic, max 100) |
