# Deployment model

Takos の deployment は、artifact と target を分けて考えます。

## artifact

Takos の deploy artifact は概念的に次の 2 系統です。

- worker-bundle
- container-image

worker-bundle は Cloudflare / local tenant runtime で使われ、container-image は OCI 系 backend で使われます。

deploy API (`POST /services/:id/deployments`) では両方の artifact kind を受け付けます。artifact kind は `target.artifact.kind` で指定し、省略時は `worker-bundle` です。

### artifact kind の制約

- 同一 service では artifact kind の混在を禁止します。初回 deploy が `services.workload_kind` を確定し、以後は同 kind のみ許可されます。
- container-image deploy では bundle upload / hash verify / wasm path は通しません。代わりに `target.artifact.image_ref` が必須です。
- `.takos/app.yml` は現時点では worker-bundle のみを扱います。container-image は deploy API から直接利用してください。

## provider

Takos の deployment provider は少なくとも次を持ちます。

- `cloudflare` — worker-bundle 専用
- `oci` — worker-bundle / container-image 両対応
- `ecs`, `cloud-run`, `kubernetes` — container-image 対応 (OCI orchestrator 経由)

provider は「どこに deploy するか」を表し、artifact や route contract とは別です。
container-image deploy では `cloudflare` provider は拒否されます。

## target

Takos の deployment target endpoint は次です。

- `service-ref`
- `http-url`

`service-ref` は Takos 内の service identity を指します。  
`http-url` は外部 endpoint や別 backend を指します。

tenant の canonical worker path は `service-ref` です。  
`http-url` は外部 service や OCI 系 backend のための target であり、tenant worker の正本 path ではありません。
weighted rollout では stable な `service-ref` でも deployment identity を保持し、active/canary/rollback を区別します。

## routing status

deployment には routing status があり、少なくとも次の状態を持ちます。

- `active`
- `canary`
- `rollback`
- `archived`

これにより、Takos は canary や rollback を deploy model に含めます。

container-image deploy では canary strategy は拒否されます。rollback は direct + re-deploy のみです。

## deploy state

deploy 処理の進行は段階的に表現されます。主な状態:

- `pending`
- `uploading_bundle`
- `creating_resources`
- `deploying_worker`
- `setting_bindings`
- `routing`
- `completed`
- `failed`
- `rolled_back`

## snapshot-based deploy

Takos の deployment は次を deployment ごとに snapshot として持ちます。

- runtime config
- bindings
- env vars

この設計により、rollback や local materialization 時に同じ execution contract を再現しやすくします。

container-image deploy でも env vars snapshot は保存されますが、worker bindings は container runtime には注入されません。

## provider deploy result

provider の `deploy()` は `resolvedEndpoint` を返せます。

- worker-bundle: 返さない (Cloudflare WFP が routing を解決)
- container-image: `{ kind: 'http-url', base_url: string }` を返す

container deploy の routing は、この `resolvedEndpoint` を使って `http-endpoint-set` target を生成します。

## container rollback

container-image の rollback は worker-bundle とは異なります。

- worker-bundle: routing pointer を前の artifact_ref に切り替えるだけ (Cloudflare 上に worker が残っている)
- container-image: provider.deploy を再実行して旧 image を起動し、resolvedEndpoint を更新してから routing を切り替える

local と Cloudflare の既知差分は [Architecture: 互換性と制限](/architecture/compatibility-and-limitations) を参照。
