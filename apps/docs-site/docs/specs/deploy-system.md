# Takos Deploy System v1.0

Revision: 2026-03-25 r3
Status: 確定仕様

目的: **シンプル**、**堅牢**、**APK/Google Play 的な配布モデル** を Cloudflare Workers 上で実現する。

関連ドキュメント:

- [Architecture: Release System](/architecture/release-system) — 概念モデルとフロー図
- [Architecture: Control Plane](/architecture/control-plane) — インフラ構成とデータフロー
- [Architecture: Tenant Runtime](/architecture/tenant-runtime) — WFP dispatch と health ラッパー
- [Architecture: Resource Governance](/architecture/resource-governance) — Plan, Quota, Metering

---

## 1. 設計目標

1. 開発者は不変の release を作り、それを promote / rollback する。
2. アプリ更新で D1/R2/KV のデータは消えない。
3. 本番反映は staged rollout を標準とする。
4. 旧版は新版本番化が確定するまで残す。
5. コントロールプレーンの真実源は DB に一本化する。
6. プロバイダが持つ deployment primitive は自前実装せず活用する。

## 2. 非目標

v1 では以下を **非対応** とする。

- リポジトリ参照 (`--repo`, `--ref`) をサーバー側で解決する deploy
- CI workflow から artifact を探索する機能
- マルチサービス graph deploy
- 独自 weighted router (KV + RoutingDO)
- recursive dependency install
- destructive DB migration
- Durable Objects migration を含む自動 rollback 保証
- OAuth / MCP / shortcuts / file handlers を core deploy path に含めること
- Workers Assets / static file hosting

## 3. 用語

### App

長寿命のアプリ識別子。`spaceId + appId` で一意。

### Environment

App のデプロイ先環境。v1 では `production` のみ。

### Release

不変の配布物。`.takos` bundle の SHA256 digest で識別される。
一度 publish された bundle bytes, manifest, artifact digest は変更不可。

### Resource

Environment に属する永続資源。v1 で対応する type は `d1`, `r2`, `kv` のみ。

### Installation

ある Release を特定 Environment 用に Cloudflare Worker version として準備した実体。

### Track

Environment に 1 つ存在する配信チャネル。v1 では `production` track のみ。
`stable` installation と `candidate` installation の 2 スロットを持つ。

### Stable

現在の本番基準版。100% のトラフィックを受ける。

### Candidate

段階配信中の新版。rollout percent に応じたトラフィックを受ける。

## 4. 基本原則

1. **App がデータの持ち主** — D1/R2/KV は release ではなく `app + environment + resource.id` に属する。
2. **Release は不変** — 一度 publish された bundle bytes, manifest, artifact digest は変更不可。
3. **Rollout は pointer 操作** — update は uninstall/install ではなく stable/candidate の切り替え。
4. **旧版先行削除は禁止** — stable は candidate の成功確定まで残す。
5. **rollback はコード切替のみ** — rollback で resources や schema は戻さない。
6. **migration は expand-only** — rollback と両立させるため、v1 では破壊的変更を禁止する。

## 5. Cloudflare へのマッピング

1 Environment = 1 Cloudflare Worker script とする。

命名規約:

```
tk-{spaceId}-{appId}-{env}
```

1 Installation = 1 Worker version。

production track の rollout は、この Worker script 上の version/deployment 機能で行う。CF API の `POST /versions` で version を作成し、`POST /deployments` で percentage-based routing を設定する。

Routes / Custom Domains は Worker script に固定で紐づき、release ごとに作り直さない。

### 5.1 Worker version retention

Cloudflare は Worker script あたり最大 10 個程度の version を保持する。それ以前の version は GC される可能性がある。

対策:

- Release bundle は R2 に永続保存する
- rollback 時に CF 側 version が失われていた場合、R2 から再 upload して新 version を作成する
- Installation レコードの `worker_version_id` を更新する

## 6. 配布単位

### 6.1 Bundle 形式

Takos bundle の拡張子は `.takos` とする。ZIP 形式。

必須ファイル:

| ファイル | 内容 |
|---------|------|
| `manifest.yaml` | アプリ定義 (セクション 7 参照) |
| `worker/index.mjs` | Worker エントリポイント |
| `checksums.txt` | 全ファイルの SHA256 ハッシュ (`{hex64} {path}` 形式、1行1ファイル) |

任意ファイル:

| パターン | 内容 |
|---------|------|
| `migrations/<resource-id>/NNNN_name.sql` | D1 マイグレーション |
| `worker/**` | Worker バンドルに含まれる追加モジュール |

### 6.2 Digest

- release identity は archive 全体の SHA256 digest とする。
- 同一 digest の再 publish は idempotent success とする。
- 別 digest で同一 `versionCode` を publish することは禁止。
- publish 時に `checksums.txt` の各エントリを検証する。不一致は reject。

### 6.3 Release 番号

`versionCode` と `versionName` を持つ。

- `versionCode`: 正の整数。App 単位で一意かつ単調増加必須。
- `versionName`: 表示用文字列。semver 風推奨だが厳密制約なし。

### 6.4 Bundle サイズ制限

- Worker エントリポイント + 依存: 圧縮後 10 MB 以下 (Cloudflare Workers paid plan の制限)
- Bundle 全体 (migrations 含む): 100 MB 以下
- publish 時にサイズ検証する。超過は reject。

## 7. Manifest 仕様

```yaml
apiVersion: takos.dev/v1
kind: App
metadata:
  appId: todo-app-001
  name: my-todo-app
spec:
  release:
    versionCode: 103
    versionName: 1.3.0

  runtime:
    entrypoint: worker/index.mjs
    compatibilityDate: 2026-03-24
    compatibilityFlags: []        # optional

  env:
    required:
      - OPENAI_API_KEY
      - SESSION_SECRET

  resources:
    - id: main
      type: d1
      binding: DB
      lifecycle: retain
      migrationsDir: migrations/main

    - id: uploads
      type: r2
      binding: UPLOADS
      lifecycle: retain

    - id: cache
      type: kv
      binding: CACHE
      lifecycle: ephemeral

  routes:
    - pathPrefix: /api
    - pathPrefix: /mcp

  rollout:
    production:
      strategy: gradual
      steps:
        - { percent: 1, pauseMinutes: 5 }
        - { percent: 5, pauseMinutes: 10 }
        - { percent: 25, pauseMinutes: 15 }
        - { percent: 50, pauseMinutes: 15 }
        - { percent: 100, pauseMinutes: 0 }
      health:
        windowMinutes: 5
        minRequestsPerVersion: 100
        maxErrorRate: 0.05
```

### 7.1 top-level 制約

- `apiVersion` MUST be `takos.dev/v1`
- `kind` MUST be `App`
- `metadata.appId` は `[a-z0-9-]{3,64}`
- `metadata.name` は 1..128 文字

### 7.2 runtime 制約

- `entrypoint` は bundle 内相対パス。必須。
- `compatibilityDate` は `YYYY-MM-DD` 必須。
- `compatibilityFlags` は文字列配列。省略可。

### 7.3 env 制約

- `required` は環境変数名配列。
- 値は manifest に含めない。
- promote 時に Environment 側の secret/value link で解決する。未設定の required env がある場合は promote を reject。

### 7.4 resources 制約

各 resource は以下を持つ。

| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `id` | string | YES | App Environment 内で不変の resource identity |
| `type` | `d1 \| r2 \| kv` | YES | リソース種別 |
| `binding` | string | YES | Worker に公開される binding 名 |
| `lifecycle` | `retain \| ephemeral` | YES | 削除時の挙動 |
| `migrationsDir` | string | NO | D1 のみ。bundle 内のマイグレーションディレクトリパス |

制約:

- `resources[].id` は Environment 内で一意
- `resources[].binding` は manifest 内で一意
- 既存 resource の `type` 変更は禁止 (deploy reject)
- `id` 変更は rename ではなく new resource 扱い
- `binding` 変更は許可する。同じ resource を別名 bind するだけとみなす
- `migrationsDir` は `type: d1` かつ `lifecycle: retain` の場合のみ有効

### 7.5 routes 制約

- v1 は **単一 Worker** のみ
- `pathPrefix` は `/` で始まる
- hostname は manifest に含めず Environment 設定に持つ

### 7.6 rollout 制約

v1 の track は `production` のみ。

- `strategy`: `immediate | gradual`
- `steps` は percent 昇順
- 最終 step は `percent: 100` 必須
- percent は 1..100
- `pauseMinutes` は 0 以上の整数

`immediate` の場合、steps と health は無視され、100% 即時反映。

省略時デフォルト:

```yaml
rollout:
  production:
    strategy: gradual
    steps:
      - { percent: 1, pauseMinutes: 5 }
      - { percent: 5, pauseMinutes: 10 }
      - { percent: 25, pauseMinutes: 15 }
      - { percent: 50, pauseMinutes: 15 }
      - { percent: 100, pauseMinutes: 0 }
    health:
      windowMinutes: 5
      minRequestsPerVersion: 100
      maxErrorRate: 0.05
```

### 7.7 health 制約

| フィールド | 型 | デフォルト | 説明 |
|-----------|---|----------|------|
| `windowMinutes` | int | 5 | 集計ウィンドウ (分) |
| `minRequestsPerVersion` | int | 100 | 判定に必要な最低リクエスト数 |
| `maxErrorRate` | float | 0.05 | candidate の絶対エラー率上限 (0.0-1.0) |

error の定義:

- uncaught exception
- platform timeout (CPU/wall-clock limit 超過)
- response status 500..599

4xx は application error ではなく client error とみなし、error rate に含めない。

## 8. Environment 設定

Environment は release 外で管理する。

### 8.1 保持項目

| フィールド | 型 | 説明 |
|-----------|---|------|
| `spaceId` | string | ワークスペース ID |
| `appId` | string | アプリ ID |
| `envName` | string | 環境名 (v1 は `production` のみ) |
| `workerScriptName` | string | CF Worker script 名 (`tk-{spaceId}-{appId}-{env}`) |
| `hostnames` | string[] (JSON) | カスタムドメイン一覧 |
| `secrets` | encrypted JSON | 暗号化された環境変数・シークレット |
| `status` | enum | `active \| suspended` |

### 8.2 Environment ライフサイクル

- 初回 promote 時に自動作成する。
- Environment 設定は release 差し替えで変化しない。
- hostnames と secrets は Environment 設定 API で個別に管理する。

### 8.3 Secrets

- API 経由でのみ設定可能。
- 暗号化して DB に保存 (AES-256-GCM, `ENCRYPTION_KEY` で暗号化)。
- Installation 作成時に復号して Worker bindings にセットする。
- 暗号文は manifest に含めない。

## 9. Control Plane データモデル

### 9.1 apps

| カラム | 型 | 制約 |
|-------|---|------|
| `id` | TEXT PK | generated |
| `space_id` | TEXT NOT NULL | |
| `app_id` | TEXT NOT NULL | `[a-z0-9-]{3,64}` |
| `name` | TEXT NOT NULL | 1..128 chars |
| `created_at` | TEXT NOT NULL | ISO8601 |

- `UNIQUE(space_id, app_id)`

### 9.2 app_environments

| カラム | 型 | 制約 |
|-------|---|------|
| `id` | TEXT PK | generated |
| `app_pk` | TEXT NOT NULL FK(apps.id) | |
| `name` | TEXT NOT NULL | `production` |
| `worker_script_name` | TEXT NOT NULL | CF Worker script 名 |
| `hostnames_json` | TEXT NOT NULL DEFAULT '[]' | JSON array |
| `secrets_encrypted` | TEXT | 暗号化 JSON |
| `status` | TEXT NOT NULL DEFAULT 'active' | `active \| suspended` |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |

- `UNIQUE(app_pk, name)`
- `UNIQUE(worker_script_name)`

### 9.3 releases

| カラム | 型 | 制約 |
|-------|---|------|
| `id` | TEXT PK | generated |
| `app_pk` | TEXT NOT NULL FK(apps.id) | |
| `bundle_digest` | TEXT NOT NULL | SHA256 hex |
| `version_code` | INTEGER NOT NULL | 正の整数、単調増加 |
| `version_name` | TEXT NOT NULL | 表示用文字列 |
| `manifest_json` | TEXT NOT NULL | manifest.yaml の JSON 変換 |
| `entrypoint` | TEXT NOT NULL | bundle 内パス |
| `compatibility_date` | TEXT NOT NULL | YYYY-MM-DD |
| `compatibility_flags_json` | TEXT NOT NULL DEFAULT '[]' | JSON array |
| `bundle_r2_key` | TEXT NOT NULL | R2 保存先キー |
| `bundle_size_bytes` | INTEGER NOT NULL | |
| `published_by` | TEXT NOT NULL | ユーザー ID |
| `created_at` | TEXT NOT NULL | |

- `UNIQUE(app_pk, bundle_digest)`
- `UNIQUE(app_pk, version_code)`

### 9.4 app_resources

| カラム | 型 | 制約 |
|-------|---|------|
| `id` | TEXT PK | generated |
| `app_environment_id` | TEXT NOT NULL FK | |
| `resource_id` | TEXT NOT NULL | manifest の `resources[].id` |
| `type` | TEXT NOT NULL | `d1 \| r2 \| kv` |
| `binding_name` | TEXT NOT NULL | |
| `provider_resource_id` | TEXT | CF リソース ID (D1 DB UUID 等) |
| `lifecycle` | TEXT NOT NULL | `retain \| ephemeral` |
| `state` | TEXT NOT NULL DEFAULT 'ready' | 下記参照 |
| `orphaned_at` | TEXT | state=orphaned 時のタイムスタンプ |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |

- `UNIQUE(app_environment_id, resource_id)`

**state 遷移:**

```
(新規) → ready
ready → detached    (retain resource が manifest から消えた)
ready → orphaned    (ephemeral resource が manifest から消えた)
orphaned → ready    (次の release で manifest に戻った)
detached → ready    (次の release で manifest に戻った)
detached → deleting (takos resource delete)
orphaned → deleting (GC 開始)
deleting → deleted  (CF 削除完了)
```

`detached` は自動削除されない。`takos resource delete` (セクション 18.11) でのみ削除可能。

### 9.5 installations

| カラム | 型 | 制約 |
|-------|---|------|
| `id` | TEXT PK | generated |
| `app_environment_id` | TEXT NOT NULL FK | |
| `release_id` | TEXT NOT NULL FK(releases.id) | |
| `worker_version_id` | TEXT | CF Worker version ID |
| `status` | TEXT NOT NULL DEFAULT 'prepared' | 下記参照 |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |

- `UNIQUE(app_environment_id, release_id)`

**status 遷移:**

```
(新規) → prepared   (Worker version upload 完了)
prepared → stable    (初回 deploy で 100% 反映)
prepared → candidate (rollout 開始)
candidate → stable   (rollout 完了、100% 昇格)
candidate → failed   (health check 違反 or manual rollback)
stable → retired     (新版が stable 昇格した)
retired → stable     (manual rollback で再昇格)
```

rollback 時: 対象 release の既存 installation が `retired` なら `retired → stable` に遷移する。CF Worker version が GC されていた場合は新しい installation を作成する (`prepared → stable`)。

### 9.6 tracks

| カラム | 型 | 制約 |
|-------|---|------|
| `id` | TEXT PK | generated |
| `app_environment_id` | TEXT NOT NULL FK | |
| `name` | TEXT NOT NULL | `production` |
| `stable_installation_id` | TEXT FK(installations.id) | |
| `candidate_installation_id` | TEXT FK(installations.id) | |
| `state` | TEXT NOT NULL DEFAULT 'idle' | 下記参照 |
| `stage_index` | INTEGER | 現在の rollout step index |
| `stage_entered_at` | TEXT | 現在 step 開始時刻 |
| `next_check_at` | TEXT | 次の reconcile 対象時刻 |
| `policy_json` | TEXT NOT NULL DEFAULT '{}' | promote 時に manifest の `rollout.production` をスナップショット保存 |
| `failure_reason` | TEXT | |
| `updated_at` | TEXT NOT NULL | |

- `UNIQUE(app_environment_id, name)`

**state 遷移:**

```
(初回) → idle
idle → rolling_out     (promote で candidate をセット)
rolling_out → paused   (手動 pause)
paused → rolling_out   (手動 resume)
rolling_out → idle     (rollout 完了、candidate → stable 昇格)
rolling_out → failed   (health check 違反)
failed → idle          (auto: candidate を failed にして stable 100% に戻す)
idle ← (manual rollback: 指定版を stable にする)
```

`rolling_out → failed → idle` は単一 reconcile cycle 内で遷移する。failed は一時状態であり、自動的に idle に戻る。failure_reason に理由を保存する。

### 9.7 operations

| カラム | 型 | 制約 |
|-------|---|------|
| `id` | TEXT PK | generated |
| `app_environment_id` | TEXT NOT NULL FK | |
| `request_id` | TEXT NOT NULL | クライアント指定の UUID v4 |
| `kind` | TEXT NOT NULL | `promote \| rollback \| pause \| resume` |
| `state` | TEXT NOT NULL | `pending \| in_progress \| completed \| failed` |
| `error_code` | TEXT | |
| `error_message` | TEXT | |
| `payload_json` | TEXT NOT NULL DEFAULT '{}' | 操作固有パラメータ |
| `result_json` | TEXT | 完了時の結果 |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |

- `UNIQUE(request_id)`

idempotency: 同一 `request_id` の再送は既存 operation の結果を返す。保持期間 24 時間。

## 10. Deploy モデル

Takos は **build** と **release promotion** を分ける。

### 10.1 CLI

```bash
# ステップ 1: ローカルビルド
takos build
# => .takos/dist/<appId>-<versionCode>.takos

# ステップ 2: Release 登録
takos publish .takos/dist/todo-app-001-103.takos
# => release digest を返す

# ステップ 3: 本番反映
takos promote --app todo-app-001 --env production --release sha256:...
```

### 10.2 takos build

`takos build` は `.takos/app.yml` と Worker ソースコードから `.takos` bundle を生成する。

入力:

- `.takos/app.yml` — manifest (セクション 7)
- Worker ソースコード — esbuild でバンドル
- `migrations/` ディレクトリ — D1 マイグレーションファイル

処理:

1. `.takos/app.yml` を読み込み、`manifest.yaml` に変換
2. Worker エントリポイントを esbuild でバンドル → `worker/index.mjs` を生成
3. `migrations/` 配下の SQL ファイルを収集
4. 全ファイルの SHA256 を計算し `checksums.txt` を生成
5. ZIP アーカイブとして `.takos/dist/<appId>-<versionCode>.takos` に出力

ビルド設定 (`.takos/app.yml` の `runtime` セクション):

- `entrypoint`: バンドル対象のソースファイルパス
- `compatibilityDate`: CF Workers compatibility date

`takos build` はローカル実行のみ。サーバーサイドビルドは v1 の範囲外。

### 10.3 互換 shorthand

```bash
takos deploy --env production
```

これはローカル CLI convenience としてのみ提供し、内部的には build → publish → promote を実行する。サーバー側は repo / ref / workflow を解決しない。

### 10.4 publish フロー

1. bundle を ZIP として読み込み
2. `checksums.txt` を検証 (各エントリの SHA256 一致確認)
3. `manifest.yaml` をパースし制約を検証 (セクション 7)
4. bundle 全体の SHA256 digest を計算
5. Worker エントリポイント + 依存のサイズを検証 (10 MB 制限)
6. 同一 digest が既存なら idempotent success を返す
7. 同一 versionCode が既存で digest が異なる場合は reject
8. versionCode が前回より大きいことを確認
9. bundle を R2 に保存 (`releases/{appId}/{versionCode}/{digest}.takos`)
10. `releases` テーブルに INSERT
11. `releaseId`, `bundleDigest`, `versionCode` を返す

## 11. Resource 管理

### 11.1 所有権

resource identity は以下で決まる。

- `spaceId + appId + envName + resource.id`

`binding` は identity ではない。同じ resource を別の binding 名で参照しても、同一リソースとして扱う。

### 11.2 初回 deploy

resource が未存在なら provider 上に作成し、`app_resources` に記録する。

作成:

- D1: Cloudflare D1 API で database を作成
- R2: Cloudflare R2 API で bucket を作成
- KV: Cloudflare KV API で namespace を作成

命名規約: `tk-{appId}-{resourceId}-{envName}`

### 11.3 update deploy

- 同じ `resource.id` が存在すれば adopt する (app_resources.state = ready を維持)
- `binding` が変わっても同じ resource を使う (binding_name を更新)
- `type` が違えば deploy を拒否する
- `lifecycle` の変更は許可する (retain → ephemeral, ephemeral → retain)

### 11.4 resource 削除

#### lifecycle = retain

- manifest から削除されても自動削除しない
- state を `detached` にする
- 明示的な `takos resource delete --app <appId> --env <env> --resource <id>` が来るまで保持する

#### lifecycle = ephemeral

- manifest から削除されたら `orphaned` にし、`orphaned_at` を記録する
- stable completion 後 7 日経過で GC 対象にする

### 11.5 Orphan GC

実装: Cron Trigger (1 日 1 回) で以下を実行:

```
SELECT * FROM app_resources
WHERE state = 'orphaned'
AND orphaned_at < datetime('now', '-7 days')
```

各リソースを CF API で削除し、state を `deleting` → `deleted` に遷移。削除失敗は retry (次回 cron で再試行)。

### 11.6 rename

`resource.id` rename の自動検出はしない。

- 旧 id は detached/orphaned
- 新 id は新規 resource

## 12. Migration 仕様

### 12.1 対象

`type = d1` かつ `lifecycle = retain` のみ対応。

`lifecycle = ephemeral` の D1 はマイグレーション非対応 (ephemeral D1 はキャッシュ用途であり、スキーマ管理の必要がない前提)。

### 12.2 配置

- `migrations/<resource-id>/NNNN_name.sql`
- `NNNN` は 4 桁以上の昇順整数
- ファイル名の lexicographic order で実行順序が決まる

### 12.3 メタテーブル

各 D1 DB に以下を作る。

```sql
CREATE TABLE IF NOT EXISTS _takos_migrations (
  filename TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

### 12.4 適用ルール

1. `_takos_migrations` テーブルを確保 (CREATE TABLE IF NOT EXISTS)
2. 既適用マイグレーションを取得 (SELECT filename, checksum ORDER BY filename)
3. bundle 内の `.sql` ファイルを filename の lexicographic order で処理:
   - filename が既存で checksum 一致 → skip
   - filename が既存で checksum 不一致 → **deploy fail** (改竄検出)
   - 未適用 → SQL を実行し、成功後 `_takos_migrations` に INSERT

### 12.5 許可 SQL

v1 は **expand-only** のみ許可する。

許可:

- `CREATE TABLE [IF NOT EXISTS]`
- `CREATE INDEX [IF NOT EXISTS]`
- `ALTER TABLE <table> ADD COLUMN`
- `CREATE VIEW [IF NOT EXISTS]`
- `INSERT` (seed data)

拒否:

- `DROP TABLE`
- `DROP COLUMN`
- `ALTER TABLE ... RENAME`
- `DELETE`, `UPDATE` を data migration として使うこと

expand-only 検証は **advisory** とする。v1 ではサーバー側での SQL AST 解析による強制は行わない。ドキュメントと lint ルールで開発者に遵守を求める。

### 12.6 実行タイミング

- candidate を traffic に乗せる **前** に apply する
- migration failure 時は Installation を作成せず、rollout を開始しない

### 12.7 migration 失敗時

migration file N で失敗した場合:

- file 1..N-1 は既に適用済み (expand-only なので安全)
- `_takos_migrations` に file 1..N-1 が記録されている
- Installation は作成されない
- 次の release で修正済みファイル N 以降を含めれば、file 1..N-1 は skip され、N から再試行される

### 12.8 rollback との関係

rollback は schema を戻さない。

したがって開発者は、旧コードが expanded schema でも動く互換性を維持しなければならない。

## 13. Promotion / Rollout 仕様

前提: セクション 16 の deploy lock を取得した状態で実行する。

### 13.1 初回 deploy

1. release と environment を検証
2. R2 から bundle を取得し、SHA256 digest を再検証する (corruption 検出)
3. required env が揃っていることを確認
4. resources を resolve / create (セクション 11)
5. migrations を apply (セクション 12)
6. Worker version を upload (CF API: `POST /versions`)
7. Installation を `prepared` で作成
8. CF deployment を 100% に設定 (CF API: `POST /deployments`)
9. Installation を `stable` にする
10. Track を `idle` にする

### 13.2 update deploy (promote)

1. stable installation を保持したまま新 release を validate
2. R2 から bundle を取得し、SHA256 digest を再検証する
3. resources を resolve (既存 adopt / 新規 create)
4. migrations を apply
5. Worker version を upload
6. new Installation を `prepared` で作成
7. Track の `candidate_installation_id` にセット
8. rollout first step の percent を CF deployment に反映
9. Track を `rolling_out` にする
10. `stage_index = 0`, `stage_entered_at = now`, `next_check_at = now + steps[0].pauseMinutes`

strategy が `immediate` の場合は step 7 で 100% に設定し、step 8 で candidate を即座に stable 昇格 → Track は `idle` に遷移。

### 13.3 Reconcile loop

Takos control plane は Cron Trigger (1 分間隔) で reconcile を行う。

対象:

```sql
SELECT * FROM tracks
WHERE state = 'rolling_out'
AND next_check_at <= datetime('now')
```

各 track について、楽観的ロックで排他する:

```sql
UPDATE tracks SET updated_at = ? WHERE id = ? AND updated_at = ?
```

affected rows = 0 なら他の reconcile worker が処理中。skip する。

処理:

1. candidate/stable の health metrics を取得 (セクション 15)
2. candidate の total_requests < minRequestsPerVersion → `next_check_at += 1m` で再スケジュール
3. candidate の error_rate > maxErrorRate → **auto rollback** (セクション 14.1)
4. 現在 stage が最終でない → 次 step に advance:
   - CF deployment の percent を更新
   - `stage_index += 1`, `stage_entered_at = now`
   - `next_check_at = now + steps[next].pauseMinutes`
   - `pauseMinutes = 0` の場合: `next_check_at = now` (次の reconcile cycle で即処理)
5. 最終 step (100%) で health 合格 → **stable 昇格**:
   - candidate installation → `stable`
   - old stable installation → `retired`
   - Track の `stable_installation_id` を更新
   - Track を `idle` にする

### 13.4 進行中 rollout への追加 promote

rollout 進行中に新しい promote が来た場合: **reject (409 Conflict)**。

レスポンスに現在の rollout state を含め、caller に abort or wait を判断させる。

## 14. Rollback 仕様

### 14.1 auto rollback

health threshold 違反時:

1. CF deployment を stable 100% に戻す
2. candidate installation を `failed` にする
3. Track の `candidate_installation_id` を NULL にする
4. Track を `failed` → `idle` に遷移 (単一 reconcile 内)
5. `failure_reason` に違反内容を保存する

### 14.2 manual rollback

```bash
takos rollback --app todo-app-001 --env production [--to-version-code 102]
```

指定版の既存 installation がある場合:

- その installation の Worker version が CF に残っていれば、deployment を 100% に設定
- Worker version が GC されていれば、R2 から bundle を取得し再 upload → 新 version 作成

指定版がない場合 (--to-version-code 省略):

- 現在の stable の一つ前の release にロールバック

manual rollback は rollout 進行中でも実行可能。candidate は `failed` に、rollout は中断。

### 14.3 rollback の限界

rollback は resources や schema を戻さない。

## 15. 観測と集計

### 15.1 データソース

v1 では request health の記録に **Worker 内の透過ラッパー** を使用する。

Control plane が Installation 作成時 (Worker version upload 前) に、Worker エントリポイントを薄いラッパーで包む。

ラッパーの処理:

```javascript
// pseudo-code: promote 時にエントリポイントを wrap
export default {
  async fetch(request, env, ctx) {
    const start = Date.now();
    try {
      const response = await originalFetch(request, env, ctx);
      ctx.waitUntil(recordHealth(env, response.status, Date.now() - start));
      return response;
    } catch (err) {
      ctx.waitUntil(recordHealth(env, 0, Date.now() - start, true));
      throw err;
    }
  }
}
```

記録するフィールド:

- `installation_id` (ラッパーにハードコード)
- `status_code`
- `is_error` (500-599, uncaught exception, timeout)
- `latency_ms`
- `timestamp`

ラッパー注入は promote 時に Control plane が bundle の entrypoint を書き換えて CF にアップロードする。開発者の Worker コードは変更不要。

### 15.2 記録先

Workers Analytics Engine の `writeDataPoint()` API を使用する。Environment 作成時に Analytics Engine dataset を作成し、Worker に binding する。

### 15.3 集計

Reconcile loop は Analytics Engine SQL API で集計クエリを実行する:

```sql
SELECT
  count() as total_requests,
  sum(if(is_error = 1, 1, 0)) as error_count
FROM health_events
WHERE installation_id = ?
AND timestamp > now() - INTERVAL ? MINUTE
```

error_rate = error_count / total_requests

### 15.4 fallback

Analytics Engine が利用できない環境 (ローカル開発、テスト) では、health check をスキップし全 step を auto-advance する。

## 16. Locking / Idempotency

### 16.1 deploy lock

同一 `app_environment_id` に対して同時に進行できる mutation operation は 1 つまで。

実装: `tracks` テーブルの `state` カラムを楽観的ロックとして使用する。

```sql
UPDATE tracks SET state = 'rolling_out', updated_at = ?
WHERE app_environment_id = ? AND state = 'idle'
```

affected rows = 0 なら 409 Conflict を返す。

対象操作:

- promote
- rollback
- resource delete

pause / resume は rollout 進行中にのみ許可する (state = 'rolling_out' or 'paused')。

### 16.2 idempotency

mutation API は `X-Request-Id` ヘッダー (UUID v4) を必須とする。

- 同一 `request_id` の再送は `operations` テーブルから既存結果を返す
- 保持期間: 24 時間 (Cron Trigger で expired operations を削除)
- partial failure 後も再試行で収束するよう設計する

## 17. Failure Handling 方針

v1 は deep compensation ではなく **reconcile first** を採用する。

### 17.1 原則

- stable を壊す前に candidate を prepare する
- 失敗しても stable が残る構造にする
- retain resource は自動削除しない
- ephemeral resource のみ GC 対象とする

### 17.2 失敗時の扱い

| 失敗箇所 | 挙動 |
|---------|------|
| publish 時の検証失敗 | reject、何も作成しない |
| resource creation 失敗 | Installation を作らない。作成済み resource は retain なら残す、ephemeral なら GC 対象 |
| migration 失敗 | Installation を作らない。適用済み migration は残る (expand-only で安全) |
| Worker version upload 失敗 | Installation を作らない |
| rollout 中の health 違反 | stable に戻し candidate を failed にする |
| CF API 一時障害 | reconcile loop が次回 retry |

## 18. Core API

全 mutation API は `X-Request-Id` ヘッダー必須。レスポンスは `application/json`。

### 18.1 Release publish

```
POST /spaces/:spaceId/apps/:appId/releases
Content-Type: application/octet-stream (or multipart/form-data)
X-Request-Id: <uuid>
```

Response 201:

```json
{
  "releaseId": "rel_...",
  "bundleDigest": "sha256:...",
  "versionCode": 103,
  "versionName": "1.3.0"
}
```

Error 409: 同一 versionCode で異なる digest
Error 413: bundle サイズ超過

### 18.2 Promote

```
POST /spaces/:spaceId/apps/:appId/environments/:env/promotions
X-Request-Id: <uuid>
Content-Type: application/json
```

```json
{
  "bundleDigest": "sha256:..."
}
```

Response 202:

```json
{
  "operationId": "op_...",
  "installationId": "inst_...",
  "rolloutState": "rolling_out",
  "currentStep": { "percent": 1, "pauseMinutes": 5 }
}
```

Error 409: 別の rollout が進行中
Error 422: required env 不足 / type 不一致

### 18.3 Rollback

```
POST /spaces/:spaceId/apps/:appId/environments/:env/rollback
X-Request-Id: <uuid>
Content-Type: application/json
```

```json
{
  "toVersionCode": 102
}
```

`toVersionCode` 省略時は直前の stable release にロールバック。

Response 200:

```json
{
  "operationId": "op_...",
  "stableInstallationId": "inst_...",
  "rolledBackFrom": { "versionCode": 103, "versionName": "1.3.0" },
  "rolledBackTo": { "versionCode": 102, "versionName": "1.2.0" }
}
```

### 18.4 Pause

```
POST /spaces/:spaceId/apps/:appId/environments/:env/pause
X-Request-Id: <uuid>
```

Response 200: `{ "state": "paused", "stageIndex": 2, "percent": 25 }`

Error 409: rollout が進行中でない

### 18.5 Resume

```
POST /spaces/:spaceId/apps/:appId/environments/:env/resume
X-Request-Id: <uuid>
```

Response 200: `{ "state": "rolling_out", "stageIndex": 2, "percent": 25 }`

Error 409: track が paused でない

### 18.6 State read

```
GET /spaces/:spaceId/apps/:appId/environments/:env
```

Response 200:

```json
{
  "app": { "appId": "todo-app-001", "name": "my-todo-app" },
  "environment": { "name": "production", "hostnames": ["todo.example.com"], "status": "active" },
  "stable": { "versionCode": 102, "versionName": "1.2.0", "digest": "sha256:..." },
  "candidate": { "versionCode": 103, "versionName": "1.3.0", "digest": "sha256:...", "percent": 5 },
  "rollout": { "state": "rolling_out", "stageIndex": 1, "nextCheckAt": "2026-03-25T12:10:00Z" },
  "resources": [
    { "id": "main", "type": "d1", "lifecycle": "retain", "state": "ready" },
    { "id": "uploads", "type": "r2", "lifecycle": "retain", "state": "ready" },
    { "id": "cache", "type": "kv", "lifecycle": "ephemeral", "state": "ready" }
  ],
  "recentHealth": {
    "stable": { "totalRequests": 5000, "errorRate": 0.001 },
    "candidate": { "totalRequests": 250, "errorRate": 0.012 }
  }
}
```

### 18.7 App 管理

App は初回 publish 時に自動作成される。明示的な作成・一覧・詳細 API も提供する。

```
POST /spaces/:spaceId/apps
Content-Type: application/json
```

```json
{ "appId": "todo-app-001", "name": "My Todo App" }
```

Response 201: `{ "id": "...", "appId": "todo-app-001", "name": "My Todo App" }`

```
GET /spaces/:spaceId/apps
```

Response 200: `{ "data": [{ "appId": "...", "name": "...", "latestVersionCode": 103 }] }`

```
GET /spaces/:spaceId/apps/:appId
```

Response 200: App 詳細 + environment 一覧 + latest release

### 18.8 Environment 設定

```
PUT /spaces/:spaceId/apps/:appId/environments/:env/hostnames
Content-Type: application/json
X-Request-Id: <uuid>
```

```json
{ "hostnames": ["todo.example.com", "todo.takos.jp"] }
```

```
PUT /spaces/:spaceId/apps/:appId/environments/:env/secrets
Content-Type: application/json
X-Request-Id: <uuid>
```

```json
{
  "secrets": {
    "OPENAI_API_KEY": "sk-...",
    "SESSION_SECRET": "..."
  }
}
```

secret の値は一度設定すると GET で読み取れない (write-only)。名前の一覧のみ取得可能。

### 18.9 Release 一覧 / 詳細

```
GET /spaces/:spaceId/apps/:appId/releases
```

Response 200:

```json
{
  "data": [
    { "releaseId": "rel_...", "versionCode": 103, "versionName": "1.3.0", "digest": "sha256:...", "createdAt": "..." },
    { "releaseId": "rel_...", "versionCode": 102, "versionName": "1.2.0", "digest": "sha256:...", "createdAt": "..." }
  ]
}
```

```
GET /spaces/:spaceId/apps/:appId/releases/:releaseId
```

Response 200: Release 詳細 (manifest, resources, installations)

### 18.10 Installation 一覧

```
GET /spaces/:spaceId/apps/:appId/environments/:env/installations
```

Response 200: installations with status, release info

### 18.11 Resource 管理

```
GET /spaces/:spaceId/apps/:appId/environments/:env/resources
```

Response 200: resource 一覧 (id, type, lifecycle, state, binding)

```
DELETE /spaces/:spaceId/apps/:appId/environments/:env/resources/:resourceId
X-Request-Id: <uuid>
```

`detached` state の retain resource のみ削除可能。`ready` state の resource を削除しようとした場合は 409 Conflict。

### 18.12 Error response format

全エラーレスポンス:

```json
{
  "error": {
    "code": "ROLLOUT_IN_PROGRESS",
    "message": "Cannot promote while rollout is in progress. Abort or wait for completion."
  }
}
```

HTTP status codes: 400 (validation), 404 (not found), 409 (conflict), 413 (too large), 422 (semantic error), 500 (internal)

## 19. 明示的に削ったもの

以下は現行案から v1 確定仕様では削除する。

1. `deploy --repo --ref` を server が解決すること
2. workflow artifact lookup
3. `replace = uninstall(old) + install(new)` モデル
4. custom hostname routing KV
5. RoutingDO alarm + pending polling
6. resource ownership を `bundleKey + binding` で持つこと
7. multi-service / MCP / shortcuts / file handlers / OAuth を core install path に入れること
8. recursive dependency install
9. automatic deletion of retain resources
10. destructive migration
11. P95 latency metrics (集計コスト対効果が低い)
12. Workers Assets / static file hosting
13. multi-environment (staging 等)

## 20. 実装上の必須不変条件

1. `releases` は immutable (UPDATE / DELETE 禁止)
2. `versionCode` は app 単位で単調増加
3. `app_resources(app_environment_id, resource_id)` は unique
4. stable は candidate successful completion まで絶対に残る
5. rollback は code pointer change only
6. retain resource は explicit delete 以外で消えない
7. production track の mutation は同時実行不可
8. rollout state の真実源は DB (`tracks` テーブル)
9. migration は forward-only (ロールバックでスキーマを戻さない)
10. bundle digest は publish 後に変更不可

## 21. 将来拡張の reserved 領域

v2 以降で検討する。

- `tracks.beta`, `tracks.internal` (multi-track)
- multi-environment (staging, preview)
- multi-service app (graph deploy)
- resource move / rename (`takos resource move`)
- destructive migration with manual approval gate
- signed bundle verification (Ed25519)
- OAuth / MCP / shortcuts / file handlers integration
- Durable Objects support
- Workers Assets / static file hosting
- P95/P99 latency-based health check
- Error rate delta (candidate vs stable 比較)

## 22. 最終判断

Takos v1 は **App-centric deploy system** として定義する。

- App が state を持つ
- Release は immutable artifact
- Installation は env-specific prepared runtime
- Rollout は stable/candidate の切り替え
- Resource はリリースではなく App Environment に属する

この形をもって v1 の確定仕様とする。
