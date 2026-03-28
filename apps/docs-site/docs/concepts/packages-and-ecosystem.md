# Package / Ecosystem

Takos の ecosystem は、`.takos/app.yml` を持つ repo を workspace/space に持ち込み、app deploy・MCP・file handler・OAuth をまとめて扱う仕組みです。

## package とは

Takos でいう package は、現在は **single-document `kind: App` manifest** を持つ Git repository です。

- deploy の正本: `.takos/app.yml`
- source provenance の正本: repo ID + ref
- build artifact の正本: `.takos/workflows/*` が出す workflow artifact

旧 docs にあった multi-document `Package` / `Workload` / `Binding` manifest は current contract ではありません。

## パッケージ配信の 3 つのチャネル

Takos の package が発見・導入される経路は 3 つあります。

### 1. Store Catalog

DB ベースの動的カタログです。public リポジトリが Release を作成すると自動的に表示されます。ユーザーは Store UI から発見・インストールできます。

### 2. Official Packages

コードで定義された公式パッケージです（`official-packages.ts`）。Store Catalog の先頭に常時表示され、DB 状態に依存しません。`certified: true` バッジが付きます。

### 3. Seed Repositories

新規ワークスペース作成時のポップアップに表示される推奨リポジトリです（`seed-repositories.ts`）。`checked: true` のものはプリチェック済みの状態で表示されます。Store とは無関係で、初回セットアップ専用の導線です。

`GET /api/seed-repositories` から seed repo の一覧を取得し、workspace に導入する repo を選びます。

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

`takos-computer` は browser automation と executor runtime を提供する独立リポジトリです。

- takos 本体との直接依存はありません（旧 `@takos/control-hosts` パッケージは削除済み、service binding も削除済み）
- `.takos/app.yml` を持つ通常のアプリとして動作します
- seed-repositories に `checked: true` で登録されており、新規ワークスペース作成時にプリチェック済みで表示されます
- official-packages に登録されており、Store に常時表示されます
- テナントとして dispatch namespace にデプロイ可能です

package の詳細な記述方法は [`.takos/app.yml`](/specs/app-manifest) を参照してください。
