# Takos

Takos core monorepo です。

`packages/` 配下のパッケージツリーが正本です。`apps/*` はそれらを組み合わせる thin composition layer、deploy entrypoint、app-local wrapper です。

## このリポジトリの構成

- `packages/control/*`: control-plane、host、local-platform パッケージツリー
- `packages/runtime-service`、`packages/browser-service`: サービスパッケージ（browser-service は単体で deploy 可能、runtime-service は apps/runtime ラッパー経由で使用）
- `packages/rust-agent-engine`: executor container で使用する object-first の Rust agent core
- `packages/common`、`packages/actions-engine`、`packages/cloudflare-compat`: 共有ライブラリ
- `apps/control`: Cloudflare worker composition、frontend build、deploy template
- `apps/rust-agent`: `packages/rust-agent-engine` と Takos control RPC/tool bridge を組み合わせる Rust executor container
- `apps/runtime`: runtime-service の薄い Node/container ラッパー
- `apps/cli`: public CLI
- `scripts/`: build、validation、メンテナンスツール

## 前提

- Node.js 20+
- pnpm 9+

## Quickstart

```bash
corepack pnpm install
corepack pnpm build:all
corepack pnpm test:all
```

docs プレビュー:

```bash
corepack pnpm docs:dev
```

ローカル control-plane 開発:

```bash
corepack pnpm dev:takos
```

ローカルスタック:

```bash
cp .env.local.example .env.local
corepack pnpm local:up
corepack pnpm local:smoke
# or:
# TAKOS_LOCAL_ENV_FILE=/path/to/local.env corepack pnpm local:up
```

## ドキュメント

Takos docs はリポジトリ内の `docs/` にあり、VitePress で描画されます。`README.md` は短い入口に留め、詳しいセットアップ、runtime、deploy、contributor ガイドは docs サイトに置きます。

`takos-private/` はこのリポジトリを sibling checkout として参照でき、package export のみを使います。`apps/*` のソースパスは直接参照しません。

## デプロイ設定

Cloudflare deploy template は `apps/control/` に配置されています。

- `wrangler*.toml`
- `.env.example`
- `SECRETS.md`

ローカルスタック設定は `.env.local.example` にあります。Helm / self-host パッケージングは `deploy/helm/takos/` に配置されています。

ローカル executor パスはデフォルトで Rust container service `rust-agent` を参照し、`executor-host` から `TAKOS_LOCAL_EXECUTOR_URL` 経由で到達します。

## Contributing

`CONTRIBUTING.md`、`docs/`、`SECURITY.md` に contributor expectations、product/spec docs、security reporting のガイドがあります。
