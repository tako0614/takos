# プロジェクト構成

> このページでわかること: Takos にデプロイするプロジェクトの `.takosumi/` ディレクトリと各ファイルの役割。

## ディレクトリ構成

Takos にデプロイするプロジェクトは、ルートに `.takosumi/` ディレクトリを置きます。

```text
my-app/
├── .takosumi/
│   ├── app.yml              ← アプリの情報と必要な権限
│   ├── manifest.yml         ← デプロイするリソースの定義
│   └── workflows/
│       ├── build-api.yml    ← ビルド手順
│       └── build-web.yml
├── src/
│   └── index.ts
└── ...
```

## 2 つのマニフェスト

`.takosumi/` には 2 つのマニフェストファイルがあり、それぞれ役割が異なります。

| ファイル                 | 役割                                   | 詳細仕様 |
| ------------------------ | -------------------------------------- | -------- |
| `.takosumi.yml`      | アプリのメタデータと必要な権限の宣言   | [app.yml spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md) |
| `.takosumi.yml` | デプロイするリソース (サーバー、DB 等) の定義 | [manifest spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md) |

`manifest.yml` にはビルド中に解決される一時的なプレースホルダー (`PLACEHOLDER`, `workflowRef`) を
書けます。デプロイ時にビルドツールがこれらを実際の値に置き換え、最終的なマニフェストだけが
デプロイエンジンに渡されます。

## 各ファイルの書き方

### `manifest.yml` — デプロイするリソースの定義

「何をデプロイするか」を宣言します。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
      routes:
        - my-app.example.com/*
      env:
        AUTH_DRIVER: oidc
        OIDC_ISSUER_URL: https://accounts.example.com
        OIDC_CLIENT_ID: takos_inst_abc
        OIDC_CLIENT_SECRET: resolved-client-secret
    workflowRef:
      file: .takosumi/workflows/build-web.yml
      job: build
      artifact: web
      target: spec.artifact.hash
```

- `resources[]` にデプロイしたいリソース (Worker, DB, ドメインなど) を列挙
- `workflowRef` でビルドの出力を `spec` のフィールドに自動注入
- 環境変数は `spec.env` に記述

詳しくは [Deploy Manifest](/deploy/manifest) を参照。

### `app.yml` — アプリのメタデータと権限

インストール時に必要な権限 (ログイン、DB、ストレージなど) を宣言します。

```yaml
apiVersion: app.takosumi.dev/v1
kind: App
id: examples.my-app
name: My App
bindings:
  auth:
    type: identity.oidc@v1
    redirectPaths:
      - /auth/oidc/callback
  bootstrap:
    type: install-launch-token@v1
```

インストール時にユーザーが権限を確認・承認できるようになっています。

### `workflows/*.yml` — ビルド手順

ビルドの手順と出力を定義します。`manifest.yml` の `workflowRef` から参照されます。

```yaml
version: "0"
jobs:
  - name: build
    steps:
      - name: Install dependencies
        run: npm ci
      - name: Build
        run: npm run build
    artifact:
      name: web
```

## 制約

- `.takosumi.yml` と `.takosumi.yml` は `.takosumi/` 直下に置く
- ワークフローは `.takosumi/workflows/` 配下に置く
- `manifest.yml` は `apiVersion: "1.0"` と `kind: Manifest` が必須
- デプロイエンジンに渡る最終マニフェストに `workflowRef` やプレースホルダーは残らない

## 次のステップ

- [はじめてのアプリ](/get-started/your-first-app) — 実際にアプリを作ってデプロイする
- [Deploy 構成](/apps/) — マニフェストとアプリ設定のガイド
- [サンプル集](/examples/) — コピペで始められるサンプル
