# 環境ごとの差異

Cloudflare / セルフホスト / ローカルで同じ app.yml を使えるが、backend は同一ではない。ここでは何が揃っていて、何が違うかをまとめる。

## 揃えているもの

Takos が環境をまたいで parity の対象にしているもの:

- tenant artifact は `worker-bundle`（Workers-compatible なコードがそのまま動く）
- manifest で宣言する `queue`, `analyticsEngine`, `workflow`, `scheduled` trigger の contract
- deployment は `active`, `canary`, `rollback`, `archived` の状態を持つ
- deployment ごとの snapshot（runtime config, bindings, env vars）
- dispatch を経由して tenant runtime に到達する request contract

つまり **同じ worker-bundle contract を、どの環境でも実行する** ことを目指している。

## 機能サポートマトリクス

| 機能 | Cloudflare | セルフホスト | ローカル |
| --- | --- | --- | --- |
| Workers | ✅ 完全対応 | ✅ Node.js 互換 | ✅ Node.js 互換 |
| CF Containers | ✅ 完全対応 | ⚠️ Docker で代替 | ⚠️ Docker で代替 |
| D1 | ✅ 完全対応 | ✅ PostgreSQL | ✅ PostgreSQL |
| R2 | ✅ 完全対応 | ✅ MinIO | ✅ MinIO |
| KV | ✅ 完全対応 | ✅ Redis | ✅ Redis |
| Vectorize | ✅ 完全対応 | ⚠️ pgvector | ⚠️ pgvector（要 `PGVECTOR_ENABLED`） |
| Queue | ✅ 完全対応 | ⚠️ PostgreSQL | ⚠️ PostgreSQL |
| AI (embeddings) | ✅ 完全対応 | ⚠️ 外部 API 経由 | ⚠️ 外部 API 経由 |
| Durable Objects | ✅ 完全対応 | ❌ 未対応 | ❌ 未対応 |
| Dispatch Namespace | ✅ 完全対応 | ❌ 未対応 | ❌ 未対応 |
| Analytics Engine | ✅ 完全対応 | ⚠️ write path は contract-first | ⚠️ write path は contract-first |
| Browser Rendering | ✅ Puppeteer binding | ⚠️ browser-service container | ⚠️ browser-service container |
| Scheduled Triggers | ✅ Cron Triggers | ⚠️ ポーリングベース | ⚠️ ポーリングベース |
| Workflows | ✅ CF Workflows | ⚠️ Takos-managed runner | ⚠️ Takos-managed runner |

凡例:
- ✅ 完全対応: provider-native の実装
- ⚠️ 互換あり: 機能は動くが provider-native ではない / 制約がある
- ❌ 未対応: 現時点ではサポートなし

## ランタイム構成の違い

| コンポーネント | Cloudflare | セルフホスト / ローカル |
| --- | --- | --- |
| Control Web | CF Worker | Node.js（ローカルプラットフォーム） |
| Dispatch | CF Worker | Node.js（ローカルプラットフォーム） |
| Background Worker | CF Worker (Queue consumer) | Node.js（ポーリングベース） |
| Runtime Host | CF Container | Node.js（ローカルプラットフォーム） |
| Executor Host | CF Container | Node.js（ローカルプラットフォーム） |
| Browser Host | CF Container | Node.js（ローカルプラットフォーム） |
| DB | Cloudflare D1 (SQLite) | PostgreSQL 16+ |
| Storage | Cloudflare R2 | MinIO (S3 互換) |
| KV | Cloudflare KV | Redis 7+ |
| Vectorize | Cloudflare Vectorize | PostgreSQL + pgvector |
| Queue | Cloudflare Queues | PostgreSQL ベースのジョブキュー |
| Container 管理 | CF Containers (DO) | OCI Orchestrator + Docker |

## 機能ごとの対応状況

| 機能 | manifest | Cloudflare | ローカル |
| --- | --- | --- | --- |
| `queue` | 対応 | backend native | delivery/orchestration は backend 依存 |
| `scheduled` | 対応 | backend native | delivery は backend 依存 |
| `workflow` | 対応 | リソース管理は可 | Takos-managed runner 前提 |
| `analyticsEngine` | 対応 | backend native | write path は contract-first |
| `vectorize` | 対応 | backend native | PostgreSQL + pgvector が必要 |
| `durableObject` | 対応 | backend native | ローカルでも materialize |

manifest で受け付けることと、provider-native 実装まで完全に揃うことは別。

## container-image の制約

| 制約 | 説明 |
| --- | --- |
| Cloudflare provider は拒否 | `cloudflare` provider では container-image deploy を受け付けない |
| canary 不可 | container-image deploy では canary strategy が使えない |
| artifact kind 混在不可 | 同一 service で初回 deploy 時に確定 |
| Worker bindings 非対応 | container runtime には inject されない |
| MCP / file handlers 非対応 | v1 制約 |

## 意図的に残している差分

### ローカル control plane は Node-backed

ローカルの control plane は Node で動く。起動性と DX を優先した設計。

### ローカル tenant runtime は Workers-compatible adapter

Workers-compatible だが Cloudflare backend と byte-for-byte 同一ではない。local adapter 上で worker-bundle を materialize して実行する。

### Vectorize

- Cloudflare: `vectorize` binding をそのまま利用
- セルフホスト / ローカル: PostgreSQL + pgvector が必要（`POSTGRES_URL` + `PGVECTOR_ENABLED=true`）
- 未設定の場合は Worker 起動時にエラー

### Durable Objects

Cloudflare 環境でのみ動作する。Takos の control plane が使う DO（SessionDO、RunNotifierDO、RateLimiterDO、RoutingDO、GitPushLockDO、NotificationNotifierDO）はローカルでは代替メカニズムが使われるか、未実装。

### Dispatch Namespace

テナント Worker の論理分離は Cloudflare Dispatch Namespace で行われる。ローカル / セルフホストではテナント Worker は直接 runtime-host に dispatch される。

## ローカルでできないこと

- Cloudflare platform 固有の内部最適化
- backend ごとの performance 特性の再現
- provider-native な queue consumer / scheduler / workflow semantics の byte-for-byte 再現
- production traffic 上での最終的な実証
- Durable Objects の利用
- Dispatch Namespace によるテナント分離

ローカルは production backend の代替ではなく、product contract を検証するための backend。

## 使い分け

| 環境 | 用途 |
| --- | --- |
| ローカル | 素早い検証、smoke test |
| staging | actual provider 上での deploy / routing / rollback 検証 |
| production | 実 traffic と実 resource を扱う本番運用 |

ローカルが green でも、provider 固有の最終確認は staging / production で行う。

## サポートマトリクス

| 環境 | ステータス | 設定ファイル |
| --- | --- | --- |
| Cloudflare Workers + CF Containers | `stable` | tracked Cloudflare templates |
| Local Docker Compose | `stable` | `.env.local.example`, `compose.local.yml` |
| セルフホスト手動起動 | `supported` | `.env.self-host.example` + `dev:local:*` scripts |
| Helm / Kubernetes | `supported` | `deploy/helm/takos/` |
| Generic OCI orchestrator | `experimental` | `OCI_ORCHESTRATOR_*` 環境変数 |

## 次に読むページ

- [Cloudflare](/hosting/cloudflare) --- Cloudflare へのデプロイ
- [セルフホスト](/hosting/self-hosted) --- セルフホスト環境
- [ローカル開発](/hosting/local) --- ローカル開発環境
