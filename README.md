# takos

Takos product shell and local entrypoint.

Takos はセルフホスト可能な AI-first chat & agent プロダクトです。AI エージェントとの会話を通じて
ソフトウェアを作成・編集でき、すべての変更は Git で追跡されます。Takosumi PaaS の上で動作します。

バンドルアプリ (`takos-docs` / `takos-slide` / `takos-excel` / `takos-computer` / `yurucommu`) は 新しい Space
作成時に自動インストールされます。

```text
takos/
  agent/  -> takos-agent (エージェント実行)
  app/    -> takos-app (ユーザー向け UI / API ゲートウェイ)
  git/    -> takos-git (Git ホスティング)
  deploy/ -> デプロイ用アーティファクト (Helm / Terraform / distribution)
  docs/   -> プロダクトドキュメント (VitePress site → docs.takos.jp)
```

## Quick Start

```sh
git submodule update --init --recursive
deno task doctor
deno task local:config
deno task local:up
```

## よく使うコマンド

| コマンド                           | 説明                                     |
| ---------------------------------- | ---------------------------------------- |
| `deno task doctor`                 | ツール・サブモジュール・compose の診断   |
| `deno task check`                  | 軽量な自動チェック                       |
| `deno task local:up` / `down`      | ローカル compose の起動 / 停止           |
| `deno task local:logs`             | ローカルサービスのログ                   |
| `deno task local:smoke`            | ローカルサービスのヘルスチェック         |
| `deno task local:e2e`              | docker compose による E2E スモークテスト |
| `deno task docs:dev`               | ドキュメントの開発サーバー起動           |
| `deno task docs:build` / `deploy`  | ドキュメントのビルド / デプロイ          |
| `deno task lint:docs`              | ドキュメントの lint                      |
| `deno task validate:distributions` | ディストリビューションの検証             |
| `deno task validate:service-set`   | Helm chart のサービスセット検証          |
| `deno task helm:template-smoke`    | Helm テンプレートのスモークテスト        |

## サービス構成

| サービス      | 責務                                                                |
| ------------- | ------------------------------------------------------------------- |
| `takos-app`   | UI、API ゲートウェイ、OIDC consumer セッション                      |
| `takos-git`   | Git ホスティング (Smart HTTP、リポジトリ、refs、オブジェクトストア) |
| `takos-agent` | エージェント実行                                                    |

ログインや課金は Takosumi Accounts (operator account plane) が担当し、 デプロイエンジンは Takosumi kernel
(`../takosumi`) が担当します。

## ローカル compose

```sh
deno task local:up
```

`takos-app`、`takos-git`、`takosumi`、`takos-agent` と、Postgres / Redis の サポートサービスが起動します。

## ドキュメントの場所

| 内容                  | 場所                                  |
| --------------------- | ------------------------------------- |
| Takos プロダクト docs | `docs/` (このリポジトリ内、VitePress) |
| プラットフォーム仕様  | `../docs/` (ecosystem root)           |
| Takosumi kernel docs  | `../takosumi/docs/`                   |
| Accounts / 課金 docs  | `../takosumi-cloud/docs/`             |
| Git installer docs    | `../takosumi-git/docs/`               |
| 運用 runbook          | `../takos-private/docs/`              |

## 関連

- [Service Topology](docs/architecture/service-topology.md)
- [Local Shell Runbook](docs/get-started/local-shell.md)
- [Component Matrix](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/component-matrix.md)
