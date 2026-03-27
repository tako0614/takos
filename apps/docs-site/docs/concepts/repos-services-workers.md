# Repo / Service / Worker

## Repo

Repo は deploy の source provenance です。Takos は repo-local な `.takos/app.yml` と、そこから参照される workflow artifact を使って app deployment を解決します。

### Repo の主要フィールド

| field | description |
| --- | --- |
| `name` | repository 名 |
| `visibility` | `public` / `private` |
| `default_branch` | デフォルトブランチ |
| `git_enabled` | Git 操作の有効/無効 |
| `forked_from_id` | fork 元の repo ID (任意) |

Repo は Pull Request モデルも持ち、AI review を含む code review を space 内で行えます。

## Service

Service は internal model での実行単位です。current app manifest では `spec.services` がその入口です。

### Service status

Service は次の状態を持ちます。

| status | 説明 |
| --- | --- |
| `pending` | 作成直後 |
| `building` | build 中 |
| `deployed` | deploy 完了 |
| `failed` | deploy 失敗 |
| `stopped` | 停止中 |

### Service の target

現在の public manifest では worker service が正本です。一方で internal routing / runtime model では次の target を扱います。

- **worker-backed service** — canonical な tenant artifact
- **external HTTP endpoint** — `http-url` target
- **container host 経由の runtime** — OCI 系 backend

そのため「app manifest の public contract」と「service-centric な internal model」は一致しつつも同一ではありません。

### Service の制限

Space あたり最大 100 service です。

## Worker

Worker は public deploy/unit として見える surface です。利用者から見ると `takos deploy` と `app deployment` が入口ですが、内部では app -> service -> route -> runtime の構造に分解されます。

Worker は Service の public-facing alias です。current public API family の正本は `/api/services` で、codebase には `workers` という internal/compat 名が残っています。

## App

App は deploy された application の identity です。

| field | description |
| --- | --- |
| `app_type` | `platform` / `builtin` / `custom` |
| `worker_id` | 紐づく service/worker |
| `takos_client_key` | Takos client 識別子 |

App は deploy のたびに更新され、service / route / resource / OAuth / MCP の reconcile 結果を保持します。

## Deployment

Deployment は service に対する 1 回の deploy 結果です。

### Deploy state

| state | 説明 |
| --- | --- |
| `pending` | deploy 開始前 |
| `uploading_bundle` | bundle アップロード中 |
| `creating_resources` | resource 作成中 |
| `deploying_worker` | worker deploy 中 |
| `setting_bindings` | binding 設定中 |
| `routing` | routing 設定中 |
| `completed` | deploy 完了 |
| `failed` | deploy 失敗 |
| `rolled_back` | rollback 済み |

### Routing status

| status | 説明 |
| --- | --- |
| `active` | 現在のアクティブな deployment |
| `canary` | canary traffic を受ける deployment |
| `rollback` | rollback 対象の deployment |
| `archived` | アーカイブ済み |

### Deployment provider

| provider | 説明 |
| --- | --- |
| `workers-dispatch` | Cloudflare Workers (WFP) |
| `oci` | OCI container (Docker) |
| `ecs` | AWS ECS |
| `cloud-run` | Google Cloud Run |
| `k8s` | Kubernetes |

### Canary deployment

`canary` strategy を使うと、新しい deployment にトラフィックの一部だけを流せます。`routing_weight` で割合を制御します。container-image deploy では canary は使えません。

## Custom Domain

Service に独自ドメインを紐づけられます。

| status | 説明 |
| --- | --- |
| `pending` | 作成直後 |
| `verifying` | DNS 検証中 |
| `dns_verified` | DNS 検証完了 |
| `ssl_pending` | SSL 証明書待ち |
| `ssl_failed` | SSL 発行または証明書検証に失敗 |
| `active` | 有効 |
| `failed` | 検証フロー全体が失敗 |

CNAME / TXT による DNS 検証を経て、Cloudflare custom hostname として登録されます。
`dns_verified` / `ssl_pending` / `ssl_failed` を見分けると、DNS 問題と証明書問題を切り分けやすくなります。

## Route

Route は service への入口です。app manifest では `spec.routes[]` として宣言し、deploy 時に hostname/path と結びつきます。

hostname ベースの routing は KV store (`HOSTNAME_ROUTING`) と Durable Object (`ROUTING_DO`) で管理されます。

## public と internal の境界

current docs では次を区別します。

- public deploy surface: repo/ref + `.takos/app.yml` + `app-deployments`
- lower-level/internal surface: service deployment details, provider-specific routing

old docs にあった `POST /services/:id/deployments` 中心の説明は lower-level surface として残っていても、repo-local app deploy の primary contract ではありません。
