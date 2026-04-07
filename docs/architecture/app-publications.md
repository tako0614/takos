# App Publications

[Kernel](./kernel.md) で定めた通り、Takos kernel は infra を提供し、app
はその上で動く。

> ここでの「app」は group の user-facing な呼び方。内部的には group が実体。

このページは app が外部 interface を公開する仕組みを定める。

## 原則

- publication は generic object にする
- kernel platform layer (data store) は publication の `type` を解釈しない
- object の schema を固定しない
- publication は manifest metadata であり、deploy 時に env として inject される

### Type interpretation の境界

kernel が publication の `type` に触れる境界を明確にする:

- **kernel platform layer (data store)**: publication の `type` を解釈しない。
  文字列として保存し、env に URL として inject するだけ
- **kernel UI client (kernel SPA)**: convention として `UiSurface` を読み
  sidebar を構築する。これは client 側の解釈であり enforcement ではない
- **group 同士**: convention に従って type を解釈する（例: MCP client が
  `McpServer` publication の URL を env から読み、MCP protocol で接続する）

kernel platform が type を強制したり validate したりすることはない。
`UiSurface` や `McpServer` などの type 名はすべて convention であり、
kernel はそれらの意味論を知らない。

## Publication object

publication は ActivityPub の object と同じ考え方を取る。

必須 field は `type` と `path` の 2 つ。残りは自由。
すべての publication は URL を持つため、`path` は必須。

```typescript
type Publication = {
  type: string;
  path: string;
  [key: string]: unknown;
};
```

例:

```yaml
- type: McpServer
  path: /mcp

- type: Api
  path: /api/v1

- type: Feed
  path: /feed
  format: atom

- type: OAuth
  path: /oauth
  clientId: abc123
  scopes: [read, write]

- type: UiSurface
  path: /
  title: Files
  icon: folder
```

`type` が何であるかを語り、残りの field がどこにあるか・どういう性質かを語る。
kernel はこの object を保存するが、中身は読まない。

publication の `path` は group のドメインルートからの相対 path（必須）。group は auto hostname `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}` で分離される（custom slug / custom domain もオプション）。

## Manifest での宣言

`.takos/app.yml` に `publish` を加える。

```yaml
name: takos-computer
version: 0.1.0

compute:
  main:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: main
        artifactPath: dist/worker

routes:
  - target: main
    path: /mcp
  - target: main
    path: /gui

storage:
  sessions:
    type: sql

publish:
  - type: McpServer
    path: /mcp
    name: browser
  - type: UiSurface
    path: /gui
    title: Computer
```

`publish` は publication object の配列。kernel は deploy 時に各 object を読み取り、
**space 内のすべての group の env に inject する**（scoping や dependency declaration なし）。

上の例では:

- group の auto hostname: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`（routing layer が自動生成）
- `McpServer` の実 URL: `https://{auto-hostname}/mcp`
- `UiSurface` の実 URL: `https://{auto-hostname}/gui`

例: space-slug が `team-a`、group-slug が `my-computer`、TENANT_BASE_DOMAIN が `app.example.com` の場合:
- `https://team-a-my-computer.app.example.com/mcp`
- `https://team-a-my-computer.app.example.com/gui`

## Kernel の責務

kernel が publication について行うのは次だけ。

1. manifest の `publish` を読む
2. deploy DB に publication を保存する
3. deploy 時に space 内の **すべての** publication を解決し、**すべての** group の env に inject する

kernel は `type` の意味を知らない。`McpServer`
が何かを理解するのは利用する group の role。

scoping や dependency declaration は存在しない。kernel は単純に「全 publication × 全 group」で env を inject する。

## Env injection

deploy 時に kernel は space 内のすべての publication を解決し、
**すべての group の env に inject する**。dependency declaration は不要。

### 命名規則

publication URL は env var として inject される:

- 1 publication per type per group: `TAKOS_{GROUP}_{TYPE}_URL`
- 同 group が同 type を複数 publish する場合: `name` field 必須。
  `TAKOS_{GROUP}_{TYPE}_{NAME}_URL`
- group 名と type 名はハイフン→アンダースコア + 大文字化
- 既存の env と衝突する場合: deploy fail

group A が以下を publish:

```yaml
publish:
  - type: McpServer
    path: /mcp
```

space 内のすべての group の env に以下が inject される:

```
TAKOS_GROUP_A_MCPSERVER_URL=https://{auto-hostname}/mcp
例: TAKOS_MYAPP_MCPSERVER_URL=https://team-a-my-app.app.example.com/mcp
```

env 変数名の規則: `TAKOS_{GROUP_NAME}_{TYPE}_URL`
GROUP_NAME と TYPE は uppercase + underscore に正規化される。

すべての publication が URL を持つため `path` が必須。
URL は group の hostname + publication の `path` で構成される。

kernel 自身（agent）は deploy DB から全 publication を知っているため、env injection 不要。

同一 group が同じ type を複数 publish している場合（例: takos-computer が 2 つの McpServer を持つ）、
`name` field が必須。`name` を省略すると deploy は fail する:

```yaml
publish:
  - type: McpServer
    path: /mcp
    name: browser
  - type: McpServer
    path: /sandbox/mcp
    name: sandbox
```

env:

```
TAKOS_{GROUP_NAME}_MCPSERVER_BROWSER_URL=https://{auto-hostname}/mcp
TAKOS_{GROUP_NAME}_MCPSERVER_SANDBOX_URL=https://{auto-hostname}/sandbox/mcp
例: TAKOS_MYCOMPUTER_MCPSERVER_BROWSER_URL=https://team-a-my-computer.app.example.com/mcp
```

## Publication lifecycle

publication は group の lifecycle に連動する。

- **登録**: group deploy 時に manifest の `publish` から登録
- **更新**: group 再 deploy 時に上書き
- **削除**: group 削除時に deploy DB から除去

publication に TTL はない。group が存在する限り publication は有効。
group が unhealthy でも publication は残る（graceful degradation で対処）。

## Graceful degradation

publication は存在を保証しない。
利用する app は、依存先が見つからない・応答しない場合を想定して実装する。

- env に該当変数がない → 該当機能を無効化する
- 依存先が 5xx を返す → retry + fallback UI を表示する
- 依存先が削除された → 次回 deploy 時に env から消える

kernel は依存の enforcement を行わない。
app が依存先の不在を検知し、ユーザーに適切に伝えるのは app の責務。

例: sidebar の Files タブが利用不可の場合、グレーアウトし「Files app がインストールされていません」と表示する。

## UiSurface

group が UI を持つ場合、`type: UiSurface` で公開する。

```yaml
publish:
  - type: UiSurface
    path: /
    title: Files
    icon: folder
```

UiSurface は group が提供する Web UI の入口。

- `path`: UI の入口 path（group ルートからの相対）
- `title`: 表示名
- `icon`: アイコン識別子（optional）

kernel SPA（kernel が提供する UI）が env vars 経由で UiSurface 情報を読み取り、
sidebar を構築する。kernel platform 自体は publication の `type` を解釈しない
（platform = data layer：publication を保存し、URL を env として inject するだけ）。
UiSurface の解釈は client 側（kernel SPA や他の group）の責務であり、enforcement ではない。
UiSurface を持つ group は kernel SPA の sidebar に表示される。

## Space scope

publication は space 内で公開される。space 内のすべての group の env に、space 内の
すべての publication が inject される（scoping や dependency declaration なし）。

kernel features (Agent / Chat, Git, Storage, Store, Auth) は kernel API として直接提供される。publication ではない。
publication の宣言と env injection はユーザー / third-party の group が対象。

```text
space: example-space
  kernel: {KERNEL_DOMAIN}
    (agent, git, storage, store は kernel API として直接提供)

  publications (hostname は各 group の auto hostname {space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}):
    computer-group (auto: team-a-my-computer.app.example.com):
      - { type: UiSurface, path: /gui, title: Computer } → {auto-hostname}/gui
      - { type: McpServer, path: /mcp, name: browser }   → {auto-hostname}/mcp
      - { type: McpServer, path: /sandbox/mcp, name: sandbox } → {auto-hostname}/sandbox/mcp
    docs-group (auto: team-a-my-docs.app.example.com):
      - { type: UiSurface, path: /, title: Docs }     → {auto-hostname}/
      - { type: McpServer, path: /mcp }                → {auto-hostname}/mcp
    excel-group (auto: team-a-my-excel.app.example.com):
      - { type: UiSurface, path: /, title: Excel }    → {auto-hostname}/
      - { type: McpServer, path: /mcp }                → {auto-hostname}/mcp
    slide-group (auto: team-a-my-slide.app.example.com):
      - { type: UiSurface, path: /, title: Slide }    → {auto-hostname}/
      - { type: McpServer, path: /mcp }                → {auto-hostname}/mcp
```

space 内のすべての group の env に、space 内のすべての publication が inject される。
dependency declaration や scoping はない。
app の実 URL は group の auto hostname (`{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`) + publication の `path`（必須）で構成される。custom slug / custom domain でも同じ group に到達する。

## Versioning

publication object に `version` field を含めることで API の互換性を示せる。

```yaml
publish:
  - type: Api
    path: /api
    version: "1"
```

`version` は convention であり kernel が enforce するものではない。
利用側が env 経由で取得した URL にアクセスし、version を判断する。

breaking change がある場合は新しい publication を追加する:

```yaml
publish:
  - type: Api
    path: /api/v1
    version: "1"
  - type: Api
    path: /api/v2
    version: "2"
```

## Platform publications

kernel 自身が提供する surface も同じ publication model で扱う。
詳しくは [Kernel - Platform publications](./kernel.md#platform-publications)
を参照。
