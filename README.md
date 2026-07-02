# takos

Takos は OpenTofu-native, Takosumi-managed な first-party AI Workspace distribution です。AI エージェントとの会話を通じて
ソフトウェアを作成・編集でき、すべての変更は Git で追跡されます。app / deploy topology は Git-hosted OpenTofu Capsule
として扱い、Takosumi 専用 manifest や DSL を要求しません。Takos は chat / agent / memory / Git / Workspace /
app launcher / MCP tools を持つ product Worker で、Accounts / dashboard / Run ledger / OpenTofu runner は外部の
Takosumi control plane が管理します。

Takos product の実行実装とスクリプトは Bun を前提としており、`src/worker` / `web` /
`containers/git` / `scripts` のローカル実行は `bun` コマンドで行います。

バンドルアプリ (`takos-office` / `takos-computer` / `yurucommu`) は新しい Workspace
作成時に distribution seed として install されます。

📖 ドキュメント: <https://docs.takos.jp/>

<sub>Takos product shell and local entrypoint.</sub>

## Quick Start

```sh
bun run doctor
bun run local:config
bun run local:up
```

## サービス構成

| Component      | 責務                                                                |
| -------------- | ------------------------------------------------------------------- |
| `takos-worker` | 単一の public/control Worker、Hono API、OIDC consumer、internal RPC |
| Takos UI       | browser UI source (`web/`)                                          |
| `takos-git`    | Git hosting container (Smart HTTP、リポジトリ、refs、object store)  |
| `takos-agent`  | agent execution container                                           |

ログインや課金は Takosumi Accounts が担当し、デプロイ制御は Takosumi (`../takosumi`) の OpenTofu-native
Deploy Control API が担当します。Takos worker は OIDC client / resource server として外部 Takosumi origin を利用します。

Takos distribution の deploy topology は `deploy/opentofu` の OpenTofu Capsule です。Takosumi v1 は Git URL /
commit / module path / well-known OpenTofu outputs などの汎用 metadata から Run を作り、apply 成功後に StateVersion と
Output を記録します。

## ローカル compose

```sh
bun run local:up
```

`takos-worker`、`takos-git`、`takos-agent`、`takosumi` と、Postgres / Redis のサポートサービスが起動します。

## レイアウト

```text
takos/
  src/
    worker/    -> Takos Worker entrypoint
    routes/    -> Hono route 分割
    contracts/ -> Worker と containers の wire contract
  web/          -> browser UI
  containers/
    git/        -> Git hosting container
    agent/      -> agent execution container
  deploy/       -> デプロイ用アーティファクト (OpenTofu / distribution)
  docs/         -> プロダクトドキュメント (VitePress site → docs.takos.jp)
```

## よく使うコマンド

| コマンド                         | 説明                                     |
| -------------------------------- | ---------------------------------------- |
| `bun run doctor`                 | ツール・canonical layout・compose の診断 |
| `bun run check`                  | 軽量な自動チェック                       |
| `bun run local:up` / `down`      | ローカル compose の起動 / 停止           |
| `bun run local:logs`             | ローカルサービスのログ                   |
| `bun run local:smoke`            | ローカルサービスのヘルスチェック         |
| `bun run local:e2e`              | docker compose による E2E スモークテスト |
| `bun run docs:dev`               | ドキュメントの開発サーバー起動           |
| `bun run docs:build` / `deploy`  | ドキュメントのビルド / デプロイ          |
| `bun run lint:docs`              | ドキュメントの lint / build              |
| `bun run web:build`              | browser UI の production build          |
| `bun run validate:opentofu-secrets` | OpenTofu tfvars / secret policy 検証 |
| `bun scripts/build-release-manifest.ts` | distribution profile digest と release evidence manifest の生成 |
| `bun run release-gate`           | Takos product の local release gate      |

## ドキュメントの場所

| 内容                  | 場所                                  |
| --------------------- | ------------------------------------- |
| Takos プロダクト docs | `docs/` (このリポジトリ内、VitePress) |
| プラットフォーム仕様  | `../docs/` (ecosystem root)           |
| Takosumi docs         | `../takosumi/docs/`                   |
| Accounts / 課金 docs  | `../takosumi/docs/`                   |
| Git installer docs    | `../takosumi/docs/`                   |
| 運用 runbook          | `../takosumi/docs/operations/`        |

## 関連

- [Service Topology](https://docs.takos.jp/architecture/service-topology)
- [Local Shell Runbook](https://docs.takos.jp/get-started/local-shell)
- [Component Matrix](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/component-matrix.md)
