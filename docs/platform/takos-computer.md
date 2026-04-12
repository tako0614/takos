# takos-computer

ブラウザ自動化 / Linux サンドボックス app。

::: info 現行 OSS local stack
`compose.local.yml` で直接配線されているのは `browser-host` / `browser`
です。`sandbox-host` / `sandbox` / `sandbox-proxy` は takos-computer app 側の
manifest surface で、sandbox 実装を同梱する private/external deployment で有効化します。
:::

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
browser-host:
  /gui                               → ブラウザ GUI (UiSurface)
  /gui/api/browser-sessions          → ブラウザセッション一覧/管理
  /gui/api/browser-create            → ブラウザセッション作成
  /gui/api/browser-session/:id       → ブラウザセッション詳細
  /session/:id/mcp                   → ブラウザ MCP Server endpoint

sandbox-host:
  /gui/api/sandbox-sessions          → サンドボックスセッション一覧/管理
  /gui/api/sandbox-create            → サンドボックスセッション作成
  /gui/api/sandbox-session/:id       → サンドボックスセッション詳細
  /session/:id/mcp                   → サンドボックス MCP Server endpoint
  /gui/api/sandbox-session/:id/mcp   → browser-host 経由の sandbox MCP proxy
```

### Workload 構成

takos-computer は flat manifest schema で以下の compute を宣言します:

| compute name | kind | 用途 |
| --- | --- | --- |
| `browser-host` | Worker (`build` あり) | ブラウザ操作 routing。`containers.browser` で Playwright container を attach |
| `sandbox-host` | Worker (`build` あり) | Linux sandbox routing。`containers.sandbox` で sandbox container を attach |

`browser-host` Worker は `sandbox-host` へ接続し、
ブラウザ操作からサンドボックスへの連携が可能です。

## Publications

```yaml
publish:
  - name: computer-ui
    type: UiSurface
    path: /gui
    title: Computer
  - name: browser
    type: McpServer
    path: /session/:id/mcp
  - name: sandbox-proxy
    type: McpServer
    path: /gui/api/sandbox-session/:id/mcp
```

`browser-host` は `/gui` と browser MCP を公開し、`sandbox-host` は `/session/:id/mcp` で sandbox MCP を公開する。
browser-host は必要に応じて sandbox MCP を `/gui/api/sandbox-session/:id/mcp` へプロキシする。
このページの `publish` は browser-host 側の公開面を表し、sandbox-host の直公開は別ホスト側の責務として扱う。

## 他 app からの利用

kernel 等がブラウザ操作やコード実行を行いたい場合:

1. env injection で takos-computer の URL を得る
2. `name: browser` または `name: sandbox-proxy` で目的の MCP Server を選択
3. MCP プロトコルで接続し tool を呼び出す

## 所有する data

takos-computer はユーザー生成データを保持しない。
セッション自体は一時的なコンテナインスタンスとして扱うが、proxy token /
active session slot / browser checkpoint などのセッション管理状態は host 側で
保持される。

## Resources

| resource | manifest 上の宣言 | 用途 |
| --- | --- | --- |
| MCP auth token | host / deploy environment (`MCP_AUTH_TOKEN`) | MCP 認証トークン |
| browser | `compute.browser-host.containers.browser` (Attached Container, kind: 'attached-container') | Playwright ブラウザ (standard-2, max 25) |
| sandbox | `compute.sandbox-host.containers.sandbox` (Attached Container, kind: 'attached-container') | Linux サンドボックス (basic, max 100) |

## Scopes

| scope | 用途 |
| --- | --- |
| `mcp:invoke` | 自身および他 group の MCP server を呼ぶ |
| `events:subscribe` | event bus の subscribe |
| `files:read` | kernel Storage からの artifact 読み取り |
| `files:write` | kernel Storage への artifact 書き込み |
