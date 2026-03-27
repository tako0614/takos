# Package / Ecosystem

Takos の ecosystem は、`.takos/app.yml` を持つ repo を workspace/space に持ち込み、app deploy・MCP・file handler・OAuth をまとめて扱う仕組みです。

## package とは

Takos でいう package は、現在は **single-document `kind: App` manifest** を持つ Git repository です。

- deploy の正本: `.takos/app.yml`
- source provenance の正本: repo ID + ref
- build artifact の正本: `.takos/workflows/*` が出す workflow artifact

旧 docs にあった multi-document `Package` / `Workload` / `Binding` manifest は current contract ではありません。

## seed repositories

初回セットアップでは `GET /api/seed-repositories` から seed repo の一覧を取得し、workspace に導入する repo を選びます。seed repository は「最初に入れる候補」であり、store registry や explore と同じものではありません。

## ecosystem で自動化されるもの

manifest と deploy を通じて、Takos は次を関連づけます。

- app identity
- service / route / hostname
- resource binding
- OAuth client
- MCP server registration
- file handler matcher

つまり package は「コードだけ」ではなく、workspace に持ち込む integration contract 全体を表します。

## MCP 統合

Takos では repo がツールを公開する主要な方法として MCP を使います。

```yaml
spec:
  routes:
    - name: app
      service: web
      path: /
  mcpServers:
    - name: notes
      route: /mcp
      transport: streamable-http
```

deploy 後は control plane が MCP endpoint を登録し、agent 実行側は登録済み server をロードします。`mcpServers[].route` は app 側の route contract と結びつき、`endpoint` は外部 MCP server を直接登録するときに使います。

## file handler 統合

storage/file 系 UI から app を開く contract は `spec.fileHandlers` で宣言します。

```yaml
spec:
  fileHandlers:
    - name: markdown
      mimeTypes: [text/markdown]
      extensions: [.md]
      openPath: /files/:id
```

これにより space storage と app UI が loose coupling のまま連携できます。

## 認証の 3 レイヤ

### 1. User auth

CLI / browser / third-party app は session cookie, PAT, OAuth token で Takos API を呼びます。

### 2. Takos-managed token

```yaml
spec:
  env:
    required: [TAKOS_ACCESS_TOKEN]
  takos:
    scopes: [threads:read, runs:write]
```

deploy された service が Takos API を呼ぶための managed token です。用途は Worker から control plane を呼ぶことです。

### 3. MCP server auth

MCP server 自身の auth は manifest の `mcpServers` 宣言先で処理します。Takos-managed token と同じものではありません。

## package deploy の流れ

```text
repo/ref
  -> resolve .takos/app.yml
  -> validate manifest
  -> resolve workflow artifacts
  -> create/update app + services + resources
  -> register routes + MCP + file handlers + OAuth
  -> create app deployment + rollout state
```

current CLI では `takos deploy --repo ... --ref ...` がこの流れの入口です。

## takos-computer の位置づけ

`takos-computer` は browser automation と executor runtime を提供する ecosystem package 群です。Takos 本体から見ると「browser-host / executor-host / runtime-host と、それらがつなぐ runtime contract」を提供する代表例です。

package の詳細な記述方法は [`.takos/app.yml`](/specs/app-manifest) を参照してください。
