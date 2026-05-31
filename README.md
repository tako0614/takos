# takos

Takos はセルフホスト可能な AI-first chat & agent プロダクトです。AI エージェントとの会話を通じて
ソフトウェアを作成・編集でき、すべての変更は Git で追跡されます。Takosumi PaaS の上で動作します。

バンドルアプリ (`takos-docs` / `takos-slide` / `takos-excel` / `takos-computer` / `yurucommu`) は 新しい Space
作成時に自動インストールされます。

📖 ドキュメント: <https://docs.takos.jp/>

<sub>Takos product shell and local entrypoint.</sub>

## Quick Start

```sh
bun run doctor
bun run local:config
bun run local:up
```

## サービス構成

| Component       | 責務                                                                |
| --------------- | ------------------------------------------------------------------- |
| `takos-worker`  | 単一の public/control Worker、Hono API、OIDC consumer、internal RPC |
| Takos UI        | browser UI source (`web/`)                                          |
| `takos-git`     | Git hosting container (Smart HTTP、リポジトリ、refs、object store) |
| `takos-agent`   | agent execution container                                           |

ログインや課金は Takosumi Accounts (operator account plane) が担当し、 デプロイエンジンは Takosumi kernel
(`../takosumi`) が担当します。

Takos product を Takosumi に install する入口は、この source root の `.takosumi.yml` です。build command は含めず、
Takos の runtime components、Postgres、object storage、OIDC / billing listen、public gateway だけを AppSpec
として宣言します。

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
  deploy/       -> デプロイ用アーティファクト (Helm / Terraform / distribution)
  docs/         -> プロダクトドキュメント (VitePress site → docs.takos.jp)
```

## よく使うコマンド

| コマンド                           | 説明                                      |
| ---------------------------------- | ----------------------------------------- |
| `bun run doctor`                 | ツール・canonical layout・compose の診断  |
| `bun run check`                  | 軽量な自動チェック                        |
| `bun run local:up` / `down`      | ローカル compose の起動 / 停止            |
| `bun run local:logs`             | ローカルサービスのログ                    |
| `bun run local:smoke`            | ローカルサービスのヘルスチェック          |
| `bun run local:e2e`              | docker compose による E2E スモークテスト  |
| `bun run docs:dev`               | ドキュメントの開発サーバー起動            |
| `bun run docs:build` / `deploy`  | ドキュメントのビルド / デプロイ           |
| `bun run lint:docs`              | ドキュメントの lint                       |
| `bun run validate:distributions` | ディストリビューションの検証              |
| `bun run validate:service-set`   | Helm chart のサービスセット検証           |
| `bun run helm:template-smoke`    | Helm テンプレートのスモークテスト         |

## ドキュメントの場所

| 内容                  | 場所                                  |
| --------------------- | ------------------------------------- |
| Takos プロダクト docs | `docs/` (このリポジトリ内、VitePress) |
| プラットフォーム仕様  | `../docs/` (ecosystem root)           |
| Takosumi kernel docs  | `../takosumi/docs/`                   |
| Accounts / 課金 docs  | `../takosumi-cloud/docs/`             |
| Git installer docs    | `../takosumi/docs/`                   |
| 運用 runbook          | `../takos-private/docs/`              |

## 関連

- [Service Topology](https://docs.takos.jp/architecture/service-topology)
- [Local Shell Runbook](https://docs.takos.jp/get-started/local-shell)
- [Component Matrix](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/component-matrix.md)
