# Repo / Service / Worker

## Repo

Repo は deploy の入力になる source と workflow artifact の起点です。  
Takos は repo-local な `.takos/app.yml` と workflow artifact を使って app deploy を解決します。

## Service

Service は internal model での実行単位です。service には少なくとも次の形があります。

- worker service (`workload_kind: worker-bundle`)
- container service (`workload_kind: container-image`)
- http-url target

App は複数 service を持てます。現在の `.takos/app.yml` v1alpha1 では worker service を正本にしつつ、internal routing model では外部 HTTP backend への target も扱います。

### workload_kind

service は `workload_kind` を持ちます。初回 deploy 時に確定し、以後は同じ kind のみ deploy できます。

- `worker-bundle`: Cloudflare Workers / local adapter で実行される JavaScript/WASM bundle
- `container-image`: Docker / OCI runtime で実行される long-running HTTP container

deploy API (`POST /services/:id/deployments`) では `target.artifact.kind` で artifact kind を指定します。`.takos/app.yml` は現時点では `worker-bundle` のみを扱います。

## Worker

Worker は public surface での deployable unit です。利用者からは `workers` が見えますが、内部では service / route / deployment のモデルに分解されています。

## route

route は service への入り口です。Takos では route を通じて、主に worker service に path を割り当てます。

## なぜ Worker と Service を分けるのか

- public では `workers` がわかりやすい
- internal では service graph のほうが routing / rollback / provider 差分を扱いやすい

このため Takos は、利用者向けには worker を保ちつつ、内部では service-centric に寄せています。
