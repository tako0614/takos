# Resource Governance

テナント (Space) ごとのリソース上限管理と使用量計測の仕組み。

## 設計思想

Takos はマルチテナントプラットフォームであり、各テナントが Cloudflare Workers / D1 / R2 / KV を利用する。インフラコストはプラットフォーム運営者に一括請求されるため、テナントごとの使用量計測と上限管理を Takos 自体が行う。

```
             manifest で宣言              promote 時に enforce
Developer ─────────────────→ Control Plane ──────────────→ CF Workers
            spec.limits                    plan gate
                                           quota 注入
                                           dispatch ラッパー
```

## 2 層モデル

### Layer 1: Plan (Space レベル)

Space に 1 つ紐づく課金プラン。全 App の合計上限を定める。

| リソース | free | pro | scale |
|---------|------|-----|-------|
| Worker requests/day | 100K | 10M | unlimited |
| Worker CPU ms/request | 10 | 50 | 50 |
| D1 storage 合計 | 500 MB | 10 GB | 100 GB |
| D1 reads/day | 5M | 100M | unlimited |
| D1 writes/day | 100K | 10M | unlimited |
| R2 storage 合計 | 1 GB | 100 GB | 1 TB |
| R2 operations/day | 1M | 100M | unlimited |
| KV storage 合計 | 100 MB | 5 GB | 50 GB |
| KV reads/day | 100K | 10M | unlimited |
| KV writes/day | 100K | 1M | unlimited |
| Apps per Space | 3 | 20 | unlimited |

### Layer 2: App Limits (App レベル)

各 App が manifest の `spec.limits` で自分の使用上限を宣言する。Plan の枠内で配分。

```yaml
# .takos/app.yml
spec:
  limits:
    worker:
      maxRequestsPerDay: 500_000
      maxCpuMsPerRequest: 30
    d1:
      maxStorageBytes: 2_000_000_000
    r2:
      maxStorageBytes: 10_000_000_000
    kv:
      maxStorageBytes: 500_000_000
```

省略時: Plan の上限を App 数で均等割り。

## Enforcement

### Deploy time (promote)

```
promote 実行時:

1. manifest.limits を読み取り
2. Space の Plan 上限を取得
3. 同 Space 内の全 App の limits 合計を計算
4. 合計 + 新 App limits > Plan 上限 → reject
   エラー: "Plan limit exceeded. Current D1 usage: 8GB / 10GB.
            Requested: 5GB. Upgrade to 'scale' plan."
5. OK → app_quotas テーブルに保存
```

### Runtime (dispatch ラッパー)

Worker への全リクエストは dispatch ラッパーを経由する。

```
Request
  ↓
Dispatch Layer
  ├─ Rate limit check (KV counter per minute bucket)
  │   └─ 超過 → 429 Too Many Requests
  ├─ Forward to tenant worker
  ├─ Response
  └─ waitUntil: usage 記録 (Analytics Engine)
```

rate limit の実装:

```
KV key: rl:{app_environment_id}:{minute_bucket}
KV value: request count (integer)
KV TTL: 120s

check:
  count = KV.get(key) || 0
  daily_limit = app_quotas.worker.maxRequestsPerDay
  per_minute_limit = daily_limit / 1440  (均等配分)
  if count > per_minute_limit * 1.5:  (バースト 1.5x 許容)
    return 429
  KV.put(key, count + 1, { expirationTtl: 120 })
```

### Storage limits

Cron Trigger (1時間ごと) で各 App の storage 使用量を CF API から収集。

```
超過レベル:
  100% 未満: 正常
  100-110%:  warning (API で通知、新規 write は許可)
  110% 超:   新規 write を block (dispatch ラッパーで検知、write 系 API に 507 返却)
  30日超過:  Environment を suspend (全リクエスト 503)
```

## Metering (使用量計測)

### 収集元

| メトリクス | 収集元 | 頻度 |
|-----------|--------|------|
| Worker requests, CPU, latency | Analytics Engine (per-script) | リアルタイム |
| D1 read/write rows | CF API `/d1/database/:id/query` metrics | 1時間 |
| D1 storage | CF API `/d1/database/:id` | 1時間 |
| R2 operations | CF API `/r2/buckets/:name/usage` | 1時間 |
| R2 storage | CF API `/r2/buckets/:name` | 1時間 |
| KV reads/writes | CF API `/kv/namespaces/:id/analytics` | 1時間 |
| KV storage | CF API `/kv/namespaces/:id` | 1時間 |

### 保存先

```
usage_records テーブル (1時間バケット)
  → 90日保持、以降は月次集計に圧縮

usage_monthly テーブル (月次集計)
  → 永続保持
```

### 集計タイミング

```
Cron Trigger:
  毎時 :05 → usage_records に各 App の使用量を INSERT
  毎日 00:15 → 前日の daily summary を計算
  毎月 1日 01:00 → 前月の monthly summary を計算、90日超の hourly records を削除
```

## データモデル

### space_plans

| カラム | 型 | 説明 |
|-------|---|------|
| space_id | TEXT PK | |
| plan_name | TEXT NOT NULL | free / pro / scale |
| limits_json | TEXT NOT NULL | Plan 上限値 JSON |
| stripe_subscription_id | TEXT | Stripe 連携用 |
| current_period_start | TEXT | 課金期間開始 |
| current_period_end | TEXT | 課金期間終了 |
| updated_at | TEXT NOT NULL | |

### app_quotas

| カラム | 型 | 説明 |
|-------|---|------|
| app_environment_id | TEXT PK | |
| limits_json | TEXT NOT NULL | manifest.limits のスナップショット |
| enforced_at | TEXT NOT NULL | promote 時のタイムスタンプ |
| updated_at | TEXT NOT NULL | |

### usage_records

| カラム | 型 | 説明 |
|-------|---|------|
| id | TEXT PK | |
| app_environment_id | TEXT NOT NULL | |
| period_start | TEXT NOT NULL | バケット開始 (ISO8601) |
| period_end | TEXT NOT NULL | バケット終了 |
| worker_requests | INTEGER DEFAULT 0 | |
| worker_cpu_ms | INTEGER DEFAULT 0 | |
| d1_read_rows | INTEGER DEFAULT 0 | |
| d1_write_rows | INTEGER DEFAULT 0 | |
| d1_storage_bytes | INTEGER DEFAULT 0 | snapshot at collection time |
| r2_class_a_ops | INTEGER DEFAULT 0 | |
| r2_class_b_ops | INTEGER DEFAULT 0 | |
| r2_storage_bytes | INTEGER DEFAULT 0 | snapshot |
| kv_reads | INTEGER DEFAULT 0 | |
| kv_writes | INTEGER DEFAULT 0 | |
| kv_storage_bytes | INTEGER DEFAULT 0 | snapshot |
| created_at | TEXT NOT NULL | |

INDEX: `(app_environment_id, period_start)`

### usage_monthly

| カラム | 型 | 説明 |
|-------|---|------|
| id | TEXT PK | |
| app_environment_id | TEXT NOT NULL | |
| month | TEXT NOT NULL | YYYY-MM |
| worker_requests_total | INTEGER | 月間合計 |
| worker_cpu_ms_total | INTEGER | |
| d1_read_rows_total | INTEGER | |
| d1_write_rows_total | INTEGER | |
| d1_storage_bytes_peak | INTEGER | 月間最大 |
| r2_storage_bytes_peak | INTEGER | |
| kv_storage_bytes_peak | INTEGER | |
| created_at | TEXT NOT NULL | |

UNIQUE: `(app_environment_id, month)`

## API

### 使用量確認

```
GET /spaces/:spaceId/usage
GET /spaces/:spaceId/usage?period=2026-03
```

Response:

```json
{
  "plan": { "name": "pro", "periodEnd": "2026-04-01" },
  "current": {
    "workerRequests": 2_500_000,
    "d1StorageBytes": 3_200_000_000,
    "r2StorageBytes": 45_000_000_000
  },
  "limits": {
    "workerRequestsPerDay": 10_000_000,
    "d1StorageBytes": 10_000_000_000,
    "r2StorageBytes": 100_000_000_000
  },
  "apps": [
    {
      "appId": "todo-app-001",
      "workerRequests": 1_800_000,
      "d1StorageBytes": 2_000_000_000,
      "r2StorageBytes": 30_000_000_000
    }
  ]
}
```

### App 使用量

```
GET /spaces/:spaceId/apps/:appId/environments/:env/usage
GET /spaces/:spaceId/apps/:appId/environments/:env/usage?period=2026-03
```

### プラン変更

```
POST /spaces/:spaceId/plan
Content-Type: application/json
```

```json
{ "plan": "pro" }
```

Stripe Checkout Session を作成し URL を返す。支払い完了後に webhook で `space_plans` を更新。

### Quota 超過通知

超過時は以下に通知:

- API レスポンスヘッダー: `X-Takos-Quota-Remaining: 15%`
- State read API (18.6) の response に `quotaWarnings` フィールドを追加
- (v2) Webhook / Email 通知
