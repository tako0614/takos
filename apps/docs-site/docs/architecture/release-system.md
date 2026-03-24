# Release System

Takos のアプリ配布・更新の仕組み。Google Play の APK 配布モデルを Cloudflare Workers 上で実現する。

## 概念モデル

```
Developer
  │
  │ takos build → takos publish → takos promote
  │
  ▼
┌──────────────────────────────────────┐
│  Control Plane                        │
│                                       │
│  App ──┬── Environment (production)   │
│        │     ├── Track                │
│        │     │   ├── stable  ← 本番  │
│        │     │   └── candidate ← 新版│
│        │     └── Resources            │
│        │         ├── D1 (DB)          │
│        │         ├── R2 (Storage)     │
│        │         └── KV (Cache)       │
│        │                              │
│        └── Releases (immutable)       │
│             ├── v103 (sha256:abc...)  │
│             └── v102 (sha256:def...)  │
└──────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  Cloudflare Workers                   │
│                                       │
│  Worker Script: tk-{space}-{app}-prod │
│    ├── Version A (stable, 95%)        │
│    └── Version B (candidate, 5%)      │
│                                       │
│  D1 Database ──── Worker binding      │
│  R2 Bucket   ──── Worker binding      │
│  KV Namespace ─── Worker binding      │
└──────────────────────────────────────┘
```

## 基本原則

| 原則 | 説明 |
|------|------|
| App がデータの持ち主 | D1/R2/KV は Release ではなく App Environment に属する |
| Release は不変 | publish された bundle は変更不可 |
| Rollout は pointer 操作 | stable/candidate の切り替え。uninstall/install ではない |
| 旧版先行削除禁止 | stable は candidate 成功確定まで残る |
| Rollback はコード切替のみ | DB スキーマは戻さない |
| Migration は expand-only | CREATE TABLE, ADD COLUMN のみ。DROP/RENAME 禁止 |

## Deploy フロー

### 初回

```
takos build
  → .takos/dist/todo-app-001-103.takos (ZIP bundle)

takos publish todo-app-001-103.takos
  → Release 作成 (immutable, SHA256 で識別)

takos promote --app todo-app-001 --env production --release sha256:...
  → Resources 作成 (D1/R2/KV)
  → Migrations 適用
  → Worker version upload
  → 100% で反映
```

### アップデート

```
takos promote --release sha256:... (新しい Release)
  → Resources adopt (既存データ保持)
  → Migrations 差分適用 (未適用のみ実行)
  → Worker version upload
  → Staged rollout: 1% → 5% → 25% → 50% → 100%
  → Health check で異常検知したら自動で stable に戻す
```

### Rollback

```
takos rollback --app todo-app-001 --env production --to-version-code 102
  → stable pointer を旧版に切り替え
  → DB スキーマは戻さない (expand-only なので旧コードでも動く)
```

## リソースライフサイクル

```
lifecycle: retain (本番 DB 等)
  manifest にある  → ready (利用中)
  manifest から消えた → detached (保持、手動削除のみ)
  takos resource delete → deleting → deleted

lifecycle: ephemeral (キャッシュ等)
  manifest にある  → ready
  manifest から消えた → orphaned (7日後に自動 GC)
```
