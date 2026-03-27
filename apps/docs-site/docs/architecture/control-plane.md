# Control Plane

Takos の制御層。テナントのアプリ管理、リソースプロビジョニング、デプロイメント制御、使用量計測を行う。

## 構成

```
┌─────────────────────────────────────────────────────────┐
│  Control Plane (Cloudflare Worker)                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ API Routes   │  │ Cron Triggers│  │ Queue Consumer │  │
│  │              │  │              │  │               │  │
│  │ /apps        │  │ reconcile    │  │ deploy jobs   │  │
│  │ /releases    │  │ usage collect│  │               │  │
│  │ /promotions  │  │ orphan GC    │  │               │  │
│  │ /rollback    │  │ operations   │  │               │  │
│  │ /usage       │  │ cleanup      │  │               │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│  ┌──────▼─────────────────▼───────────────────▼───────┐  │
│  │              Application Services                   │  │
│  │                                                     │  │
│  │  ReleaseService      DeployService                  │  │
│  │  ResourceService     RolloutService                 │  │
│  │  MeteringService     PlanService                    │  │
│  │  MigrationService    QuotaService                   │  │
│  └──────────────────────┬─────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────────┐  │
│  │              Infrastructure                         │  │
│  │                                                     │  │
│  │  D1 (control DB)    R2 (bundle storage)             │  │
│  │  Analytics Engine    CF API (D1/R2/KV/Workers)      │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## データベース

Control plane の全状態は D1 に保存する。

### テーブル一覧

| テーブル | 用途 | 主キー |
|---------|------|--------|
| `apps` | アプリ登録 | id |
| `app_environments` | デプロイ先環境 | id |
| `releases` | 不変の配布物 | id |
| `app_resources` | テナントリソース (D1/R2/KV) | id |
| `installations` | Release の CF Worker version 実体 | id |
| `tracks` | rollout 状態管理 | id |
| `operations` | mutation 操作の idempotency | id |
| `space_plans` | テナントの課金プラン | space_id |
| `app_quotas` | App ごとの quota 設定 | app_environment_id |
| `usage_records` | 1時間ごとの使用量 | id |
| `usage_monthly` | 月次使用量集計 | id |

詳細なスキーマは [Release System](./release-system.md) と [Resource Governance](./resource-governance.md) を参照。

## Cron Triggers

| スケジュール | ハンドラ | 用途 |
|-------------|---------|------|
| `* * * * *` (毎分) | reconcileRollouts | rolling_out 状態の track を進行/停止 |
| `5 * * * *` (毎時 :05) | collectUsage | 各 App の使用量を CF API から収集 |
| `0 0 * * *` (毎日 00:00) | gcOrphanedResources | 7日超の orphaned resource を削除 |
| `0 0 * * *` (毎日 00:00) | cleanupOperations | 24時間超の operations レコードを削除 |
| `0 1 1 * *` (毎月 1日 01:00) | aggregateMonthly | 月次 usage 集計 + 古い hourly records 削除 |

## Provider Abstraction

Cloudflare 固有の操作は provider 層に閉じ込める。

```
Application Service (provider-agnostic)
  │
  ├─ ResourceService.create(type: 'd1', name: '...')
  │    └─ CloudflareResourceProvider.createD1Database(name)
  │
  ├─ DeployService.uploadVersion(script, bundle)
  │    └─ CloudflareDeployProvider.uploadWorkerVersion(...)
  │
  └─ DeployService.setTrafficSplit(stable: 95, candidate: 5)
       └─ CloudflareDeployProvider.createDeployment(percentages)
```

これにより:

- ローカル開発時は mock provider で動作
- テスト時は provider 層を差し替え可能
- 将来の provider 追加 (OCI 等) に対応可能

## Request Flow

### テナント Worker へのリクエスト

```
Client
  ↓ HTTPS
CF Edge (Routes / Custom Domains)
  ↓
Dispatch Worker (platform outbound worker)
  ├─ hostname → Worker script name 解決
  ├─ rate limit check (KV)
  ├─ dispatch to tenant Worker version
  │   ├─ stable (95%) or candidate (5%) ← CF native traffic split
  │   └─ tenant Worker が response 返却
  ├─ waitUntil: health record (Analytics Engine)
  └─ response to client
```

### Control Plane API へのリクエスト

```
Client (CLI or API)
  ↓ HTTPS
CF Edge
  ↓
Control Plane Worker
  ├─ Auth middleware (session / API key)
  ├─ Route matching (Hono)
  ├─ Application Service 呼び出し
  │   ├─ D1 操作
  │   ├─ R2 操作 (bundle upload/download)
  │   └─ CF API 呼び出し (resource provisioning)
  └─ JSON response
```

## Locking

### Mutation lock

同一 App Environment に対する同時 mutation は 1 つまで。

```sql
-- 楽観的ロック (tracks テーブル)
UPDATE tracks SET state = 'rolling_out', updated_at = ?
WHERE app_environment_id = ? AND state = 'idle'
-- affected rows = 0 → 409 Conflict
```

### Reconcile lock

Cron Trigger の並行実行を防ぐ。

```sql
-- 楽観的ロック (tracks テーブル)
UPDATE tracks SET updated_at = ?
WHERE id = ? AND updated_at = ?
-- affected rows = 0 → 別の reconcile worker が処理中、skip
```

### Publish lock

同一 App への同時 publish は DB の unique constraint で排他。

```sql
-- UNIQUE(app_pk, version_code) on releases table
-- 同一 versionCode の INSERT は constraint violation → 409
```

## Durable Objects

Control Plane は以下の Durable Object を使用します。

| DO | 用途 | 状態 |
| --- | --- | --- |
| `SessionDO` | リアルタイムセッション管理 | ✅ 稼働中 |
| `RunNotifierDO` | Agent run のイベントストリーミング (SSE/WS) | ✅ 稼働中 |
| `NotificationNotifierDO` | 汎用通知ストリーミング | ⚠️ サーバー側のみ、フロントクライアント未実装 |
| `RateLimiterDO` | レートリミット (auth 系) | ✅ 稼働中 |
| `RoutingDO` | ホスト名ルーティングキャッシュ | ✅ 稼働中 |
| `GitPushLockDO` | Git push の排他制御 | ✅ 稼働中 |
| `BrowserSessionContainer` | ブラウザコンテナ管理 (takos-computer) | ✅ 稼働中 |
| `TakosAgentExecutorContainer` | エグゼキュータコンテナ管理 (takos-computer) | ✅ 稼働中 |

### RunNotifierDO

Agent run の実行イベント (thinking, tool_call, tool_result, message, completed 等) をリアルタイムにクライアントに配信します。リングバッファで最新イベントを保持し、SSE または WebSocket でストリーミングします。

### NotificationNotifierDO

汎用的な通知配信基盤。リングバッファ実装は完了していますが、フロントエンドの WebSocket クライアントは未実装です。
